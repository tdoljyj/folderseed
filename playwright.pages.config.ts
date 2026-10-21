import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/pages',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174/folderseed/',
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run preview -- --port 4174 --strictPort --base=/folderseed/',
    url: 'http://127.0.0.1:4174/folderseed/',
    reuseExistingServer: false,
  },
});
