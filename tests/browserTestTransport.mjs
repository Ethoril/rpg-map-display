// @ts-check
/**
 * Helpers Playwright partagés par les suites qui font converger de vraies pages.
 *
 * Ce fichier n'est ni `*.spec.mjs` ni `*.test.mjs` : ni Playwright ni
 * `node --test` ne le collectent comme suite. Il est importé côté Node par les
 * specs, pas chargé dans la page.
 */

/**
 * Attend le vrai démarrage automatique d'une page applicative.
 * @param {import('@playwright/test').Page} page
 */
export async function waitForApp(page) {
  await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__RPG_APP__));
}

/**
 * Injecte un transport BroadcastChannel dans la vraie page, sans relais manuel
 * du test : le seul chemin entre deux pages est le canal du navigateur.
 *
 * Chaque page journalise dans `window.__RPG_TEST_WIRE__` ce qu'elle publie et
 * ce qu'elle reçoit. Cela permet d'affirmer *ce qui a réellement transité* —
 * critère U-05 « aucun UVTT complet ni base64 ne transite » — et pas seulement
 * l'état final.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} sessionId
 * @param {any} snapshot - ce que rendra `transport.snapshot()` au démarrage
 */
export async function installBrowserTransport(page, sessionId, snapshot) {
  await page.addInitScript(
    ({ injectedSessionId, injectedSnapshot }) => {
      Object.defineProperty(Element.prototype, 'requestFullscreen', {
        configurable: true,
        value: () => Promise.resolve(),
      });

      let documentHidden = false;
      /** @type {{published: any[], received: any[], gap: boolean, resyncs: number, resyncFailures: number, snapshot: any, setHidden: (hidden: boolean) => void, retenir: boolean, retenus: any[], relacher: () => void, debloquer: () => void}} */
      const wire = {
        published: [],
        received: [],
        // Le test décide si le transport prétend avoir manqué des événements, et compte les
        // resynchros réellement demandées.
        gap: false,
        resyncs: 0,
        resyncFailures: 0,
        // Remplacé par un test qui veut simuler un état que ce client a manqué ; `null` laisse
        // l'instantané injecté au démarrage.
        snapshot: null,
        // Playwright ne sait pas masquer un onglet : la visibilité est pilotée ici, sur les
        // accesseurs redéfinis juste en dessous.
        setHidden: (/** @type {boolean} */ hidden) => {
          documentHidden = hidden;
          document.dispatchEvent(new Event('visibilitychange'));
        },
        // Retenue des événements ENTRANTS (audit du 22/09, C3) : deux postes peuvent ainsi jouer
        // chacun leur coup avant d'avoir reçu celui de l'autre — une vraie course.
        retenir: false,
        retenus: [],
        relacher: () => {},
        debloquer: () => {},
      };
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => documentHidden });
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => (documentHidden ? 'hidden' : 'visible'),
      });
      /** @type {any} */ (window).__RPG_TEST_WIRE__ = wire;

      class BrowserTestTransport {
        constructor() {
          this.clientId = crypto.randomUUID();
          /** @type {Set<(event: any) => void>} */
          this.listeners = new Set();
          /** @type {BroadcastChannel|null} */
          this.channel = null;
        }

        async connect(/** @type {string} */ connectedSessionId) {
          // Connexion BLOQUÉE (audit du 22/09, C4) : comme le vrai SDK hors ligne, elle ne rend la
          // main ni en succès ni en échec, jusqu'à `wire.debloquer()`. Le drapeau vit dans
          // sessionStorage, que le test pose ; `debloquer` l'efface, pour que le rechargement qui
          // suit se connecte normalement.
          if (sessionStorage.getItem('test_connexion_bloquee') === '1') {
            await new Promise((ok) => {
              wire.debloquer = () => {
                sessionStorage.removeItem('test_connexion_bloquee');
                ok(undefined);
              };
            });
          }
          this.channel = new BroadcastChannel(`rpg-test-${connectedSessionId}`);
          const livrer = (/** @type {any} */ data) => {
            wire.received.push(data);
            // Comme le vrai transport (`_notifySubscribers`) : l'erreur d'un abonné se journalise,
            // elle n'interrompt ni les autres abonnés ni la livraison.
            for (const listener of this.listeners) {
              try {
                listener(data);
              } catch (err) {
                console.error('Erreur dans un handler de souscription :', err);
              }
            }
          };
          wire.relacher = () => {
            wire.retenir = false;
            const lot = wire.retenus.splice(0);
            for (const data of lot) livrer(data);
          };
          this.channel.addEventListener('message', (message) => {
            if (wire.retenir) wire.retenus.push(message.data);
            else livrer(message.data);
          });
        }

        async publish(/** @type {any} */ event) {
          const complet = {
            ...event,
            eventId: crypto.randomUUID(),
            clientId: this.clientId,
          };
          wire.published.push(complet);
          this.channel?.postMessage(complet);
          return { ok: true };
        }

        subscribe(/** @type {(event: any) => void} */ listener) {
          this.listeners.add(listener);
          return () => this.listeners.delete(listener);
        }

        async snapshot() {
          return structuredClone(wire.snapshot ?? injectedSnapshot);
        }

        async saveSnapshot() {}

        mayHaveMissedEvents() {
          return wire.gap === true;
        }

        async resync() {
          wire.resyncs += 1;
          // Échecs simulés (audit du 22/09, C5) : le test fixe combien de resynchros lèvent.
          if (wire.resyncFailures > 0) {
            wire.resyncFailures -= 1;
            throw new Error('resynchro impossible (simulée)');
          }
          // ⛔ `wire.gap` n'est PAS remis à faux ici : c'est le test qui décide, et il doit
          // pouvoir déclarer un trou à deux réveils consécutifs. Le vrai transport, lui,
          // recalcule sa réponse depuis l'âge de son bail à chaque appel.
        }

        isOwnEvent(/** @type {any} */ event) {
          return event?.clientId === this.clientId;
        }

        onError() {
          return () => {};
        }

        disconnect() {
          this.channel?.close();
          this.channel = null;
          this.listeners.clear();
        }
      }

      /** @type {any} */ (window).__RPG_APP_OPTIONS__ = {
        sessionId: injectedSessionId,
        transport: new BrowserTestTransport(),
        // Échéance de connexion raccourcie quand un test simule le hors ligne (C4).
        ...(sessionStorage.getItem('test_connexion_bloquee') === '1' ? { connexionDelaiMs: 300 } : {}),
      };
    },
    { injectedSessionId: sessionId, injectedSnapshot: snapshot }
  );
}
