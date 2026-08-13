// @ts-check
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: 'tests/e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    // One retry: the suite gates pushes, and heavy parallel runs can starve
    // the browser enough to trip timing-sensitive interactions.
    retries: process.env.CI ? 2 : 1,
    workers: process.env.CI ? 2 : 4,
    reporter: [['list']],
    timeout: 30_000,
    use: {
        baseURL: 'http://localhost:3556',
        trace: 'retain-on-failure',
    },
    projects: [
        {
            name: 'desktop',
            grepInvert: /@touch/,
            use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 950 } },
        },
        {
            // Touch behaviors (halo selection, handle hit areas, viewer scroll
            // suppression while drawing). Runs only the specs tagged @touch.
            name: 'touch',
            grep: /@touch/,
            use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
        },
    ],
    webServer: {
        command: 'npx serve . -l 3556',
        url: 'http://localhost:3556',
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
});
