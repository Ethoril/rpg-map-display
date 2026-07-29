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

      /** @type {{published: any[], received: any[]}} */
      const wire = { published: [], received: [] };
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
          this.channel = new BroadcastChannel(`rpg-test-${connectedSessionId}`);
          this.channel.addEventListener('message', (message) => {
            wire.received.push(message.data);
            for (const listener of this.listeners) listener(message.data);
          });
        }

        publish(/** @type {any} */ event) {
          const complet = {
            ...event,
            eventId: crypto.randomUUID(),
            clientId: this.clientId,
          };
          wire.published.push(complet);
          this.channel?.postMessage(complet);
        }

        subscribe(/** @type {(event: any) => void} */ listener) {
          this.listeners.add(listener);
          return () => this.listeners.delete(listener);
        }

        async snapshot() {
          return structuredClone(injectedSnapshot);
        }

        async saveSnapshot() {}

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
      };
    },
    { injectedSessionId: sessionId, injectedSnapshot: snapshot }
  );
}
