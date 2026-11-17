import { defineConfig } from '@playwright/test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
export default defineConfig({ testDir: './tests/browser', workers: 1, reporter: 'list', outputDir: process.env.TRAVEL_TEST_OUTPUT || join(tmpdir(), `travel-browser-tests-${process.pid}`), use: { browserName: 'chromium', headless: true } })
