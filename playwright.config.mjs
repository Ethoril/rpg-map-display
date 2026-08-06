// @ts-check
import { defineConfig, devices } from '@playwright/test';

// Deux familles de tests, deux exécuteurs, aucune ambiguïté :
//   tests/*.test.mjs → node:test   (logique pure, aucun navigateur)   `pnpm run test:unit`
//   tests/*.spec.mjs → Playwright  (navigateur, vrai Canvas, vrai DOM) `pnpm run test:e2e`
//
// Avant cette séparation, `pnpm test` lançait Playwright sur des fichiers node:test :
// il n'y trouvait aucun test Playwright et sortait en 1, tout en exécutant au passage
// une partie des tests unitaires par simple effet de bord de la collecte. Sortie verte,
// commande en échec, et aucun des critères Playwright du lot réellement vérifié.

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  // ⚠ **En local, un seul worker.** `fullyParallel: false` ne sérialise que les tests d'un même
  // fichier : Playwright lance quand même autant de workers que la moitié des cœurs, donc six
  // navigateurs de front sur cette machine à douze cœurs — et chaque test de convergence en ouvre
  // deux pages. Le 6 août 2026, cela a saturé la machine du mainteneur **deux fois**, jusqu'à faire
  // planter sa session : d'abord des tests qui échouaient sur des fichiers différents à chaque
  // exécution — diagnostic perdu à chercher l'erreur dans le code —, puis l'éditeur et le jeu qui
  // tombent. La machine du mainteneur est un poste de travail où tourne autre chose ; le runner
  // GitHub ne l'est pas.
  //
  // ⛔ Ne pas « accélérer » en remontant ce nombre en local. Le gain est de quelques dizaines de
  // secondes ; le coût est une session perdue, et des rouges qui n'ont rien à voir avec le code.
  // La CI garde le défaut, où le parallélisme est gratuit.
  workers: process.env.CI ? undefined : 1,
  forbidOnly: !!process.env.CI,
  // En CI, le rapporteur `github` en plus de `list`. Ce n'est pas un agrément d'affichage :
  // sur ce dépôt, les **journaux** de run répondent 403 en lecture anonyme et les **artefacts**
  // 401, donc un échec e2e ne se lisait nulle part — l'annotation de la porte disait « Process
  // completed with exit code 1 » et rien d'autre, ce qui a coûté un aller-retour complet pour
  // savoir quel test avait rougi. Le rapporteur `github` écrit des commandes `::error` avec
  // fichier, ligne et message, qui remontent par
  // `GET /repos/{owner}/{repo}/check-runs/{id}/annotations` — le seul canal accessible.
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    // Chromium seul : c'est le moteur de la tablette de jeu comme du Mac du MJ.
    //
    // `tests/manuel/` est exclu de ce projet, donc de `pnpm run test:e2e`, donc de la porte de
    // vérification. Ce n'est pas un fourre-tout : un test n'y va qu'avec sa raison écrite en
    // tête de fichier et une ligne dans la liste des vérifications manuelles d'`ETAT.md`.
    // Aujourd'hui un seul y figure — le glisser réel du désarmement des outils MJ, rouge sur le
    // runner GitHub et vert partout ailleurs, cause inconnue après quatre diagnostics.
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: '**/manuel/**',
    },
    // Lancé explicitement par `pnpm run test:manuel`, jamais par la porte.
    {
      name: 'manuel',
      use: { ...devices['Desktop Chrome'] },
      testMatch: '**/manuel/**/*.spec.mjs',
    },
  ],
  webServer: {
    command: `node scripts/serve.mjs --port ${PORT}`,
    url: `${BASE_URL}/index.html`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
  },
});
