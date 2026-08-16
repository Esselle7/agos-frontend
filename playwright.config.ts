import { defineConfig } from '@playwright/test';

// Harness E2E. Usa il google-chrome di sistema (channel:'chrome') → niente download browser.
// Presuppone backend su :8080 e frontend su :4200 già avviati (quarkus:dev + ng serve).
// Il backend deve girare sul DB e2e, non su quello di lavoro:
//   ./mvnw quarkus:dev -Dquarkus.datasource.jdbc.url=jdbc:postgresql://localhost:5432/agosdb_e2e
export default defineConfig({
  testDir: './e2e',
  // B5: la suite scrive sul DB del backend di :8080. Il setup rifiuta di partire se quel
  // backend è agganciato al database di lavoro invece che a quello e2e.
  globalSetup: './e2e/global-setup.ts',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4200',
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', testIgnore: '**/mobile.spec.ts' },
    {
      name: 'mobile',
      testMatch: '**/mobile.spec.ts',
      use: { viewport: { width: 393, height: 851 }, hasTouch: true }, // Pixel 5 portrait
    },
  ],
});
