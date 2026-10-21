import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'palette.spec.ts',
  outputDir: '../../artifacts/apple-preview/results',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 60000,
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4173', viewport: { width: 1440, height: 1080 }, colorScheme: 'light', reducedMotion: 'reduce' },
  webServer: { command: 'npm run preview -- --port 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
});
