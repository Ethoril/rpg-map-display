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
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    // Chromium seul : c'est le moteur de la tablette de jeu comme du Mac du MJ.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `node scripts/serve.mjs --port ${PORT}`,
    url: `${BASE_URL}/index.html`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
  },
});
