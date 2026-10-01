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
 * Nœud `session/{id}/sharedImage` simulé (C-13), par session : il tient le rôle du serveur RTDB.
 * Côté Node et non dans la page, pour la même raison qu'en vrai : il survit au F5 d'un écran, il
 * est commun à tous les écrans de la session, et il n'est écrit dans **aucun** stockage du
 * navigateur — ce qu'un test vérifie justement.
 *
 * @type {Map<string, any>}
 */
const imagesPartagees = new Map();

/** Pages qui ont déjà reçu la fonction d'accès au nœud : l'exposer deux fois lèverait. */
const pagesAvecNoeudImage = new WeakSet();

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
  if (!pagesAvecNoeudImage.has(page)) {
    pagesAvecNoeudImage.add(page);
    // Les trois opérations du vrai transport sur le nœud. `close` reprend la transaction de
    // `FirebaseTransport.closeSharedImage` : le nœud n'est effacé que s'il porte encore cet id.
    await page.exposeFunction(
      '__rpgTestSharedImage',
      (/** @type {'get'|'set'|'close'} */ op, /** @type {string} */ sid, /** @type {any} */ arg) => {
        if (op === 'set') imagesPartagees.set(sid, arg);
        if (op === 'close' && imagesPartagees.get(sid)?.id === arg) imagesPartagees.delete(sid);
        return imagesPartagees.get(sid) ?? null;
      }
    );
  }
  await page.addInitScript(
    ({ injectedSessionId, injectedSnapshot }) => {
      Object.defineProperty(Element.prototype, 'requestFullscreen', {
        configurable: true,
        value: () => Promise.resolve(),
      });

      let documentHidden = false;
      /** @type {{published: any[], received: any[], gap: boolean, resyncs: number, resyncFailures: number, snapshot: any, setHidden: (hidden: boolean) => void, retenir: boolean, retenus: any[], relacher: () => void, debloquer: () => void, savedSnapshot: string|null}} */
      const wire = {
        published: [],
        received: [],
        // Dernier instantané remis à `saveSnapshot`, sérialisé : ce que la sauvegarde aurait
        // écrit (C-13 : rien du partage d'image ne doit y figurer).
        savedSnapshot: null,
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
          /** @type {Set<(image: any) => void>} Abonnés au nœud de l'image partagée (C-13) */
          this.imageListeners = new Set();
          /** @type {BroadcastChannel|null} Signal « le nœud a changé » entre écrans */
          this.imageChannel = null;
          /** @type {string|null} */
          this.sessionId = null;
        }

        /** Relit le nœud et le remet à chaque abonné de cet écran, comme `onValue`. */
        async relireImage() {
          if (!this.sessionId) return;
          const image = await /** @type {any} */ (window).__rpgTestSharedImage('get', this.sessionId);
          for (const listener of this.imageListeners) listener(image);
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
          this.sessionId = connectedSessionId;
          // Canal distinct du flux d'événements : le nœud d'état n'est PAS un événement, et il ne
          // doit apparaître ni dans `wire.received` ni chez les abonnés de `subscribe`.
          this.imageChannel = new BroadcastChannel(`rpg-test-image-${connectedSessionId}`);
          this.imageChannel.addEventListener('message', () => {
            void this.relireImage();
          });
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

        async saveSnapshot(/** @type {any} */ instantane) {
          wire.savedSnapshot = JSON.stringify(instantane);
        }

        async shareImage(/** @type {any} */ image) {
          if (!this.sessionId) return { ok: false, error: new Error('Transport non connecté') };
          await /** @type {any} */ (window).__rpgTestSharedImage('set', this.sessionId, image);
          this.imageChannel?.postMessage('changed');
          await this.relireImage();
          return { ok: true };
        }

        async closeSharedImage(/** @type {string} */ id) {
          if (!this.sessionId) return { ok: false, error: new Error('Transport non connecté') };
          await /** @type {any} */ (window).__rpgTestSharedImage('close', this.sessionId, id);
          this.imageChannel?.postMessage('changed');
          await this.relireImage();
          return { ok: true };
        }

        subscribeSharedImage(/** @type {(image: any) => void} */ callback) {
          this.imageListeners.add(callback);
          // Comme `onValue` : la valeur courante est remise dès l'abonnement — c'est ce qui fait
          // revenir une image ouverte après un F5.
          if (this.sessionId) {
            /** @type {any} */ (window).__rpgTestSharedImage('get', this.sessionId).then((/** @type {any} */ image) => {
              if (this.imageListeners.has(callback)) callback(image);
            });
          }
          return () => this.imageListeners.delete(callback);
        }

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
          this.imageChannel?.close();
          this.imageChannel = null;
          this.imageListeners.clear();
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
