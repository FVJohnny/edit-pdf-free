import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.js';
export default defineConfig({
    ...base,
    projects: [
        {
            name: 'firefox',
            grepInvert: /@touch/,
            use: {
                ...devices['Desktop Firefox'],
                viewport: { width: 1400, height: 950 }
            }
        },
        {
            name: 'webkit',
            grepInvert: /@touch/,
            use: {
                ...devices['Desktop Safari'],
                viewport: { width: 1400, height: 950 }
            }
        },
        {
            name: 'mobile-webkit',
            testMatch: '**/mobile-browser.spec.js',
            grep: /@touch/,
            use: { ...devices['iPhone 13'] }
        }
    ]
});
