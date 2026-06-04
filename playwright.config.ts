import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";

/**
 * E2E config for the "eat" app.
 *
 * Boots the real Remix server on PORT 8102 against a FRESH throwaway SQLite DB
 * (DB_PATH under /tmp, deleted+recreated per run via globalSetup) with a fixed
 * SESSION_SECRET so signed session cookies stay valid for the whole run.
 *
 * The suite drives three concurrent users in separate browser contexts (adult A,
 * kid K, adult B) — the genuinely multi-user part — so we keep a single worker:
 * the test owns the shared household state end to end and must not race a copy of
 * itself. No sleeps anywhere; we wait on URLs / DOM / network instead.
 */

const PORT = 8102;
export const BASE_URL = `http://localhost:${PORT}`;
export const E2E_DB_PATH = "/tmp/eat-e2e/eat-e2e.db";

// Wipe + recreate the throwaway DB dir at config-load time — this runs before the
// webServer boots regardless of globalSetup ordering, so the app always opens a
// brand-new SQLite file and re-runs its migrations from scratch. globalSetup also
// does this defensively.
rmSync(dirname(E2E_DB_PATH), { recursive: true, force: true });
mkdirSync(dirname(E2E_DB_PATH), { recursive: true });

export default defineConfig({
  testDir: ".",
  testMatch: ["e2e.spec.ts", "e2e/*.spec.ts"],
  globalSetup: fileURLToPath(new URL("./e2e/global-setup.ts", import.meta.url)),
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  webServer: {
    // `npm run serve` builds CSS then runs the server under tsx. A fresh DB +
    // fixed secret make the run deterministic and isolated from the dev DB.
    command: "npm run serve",
    url: `${BASE_URL}/health`,
    timeout: 60_000,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      DB_PATH: E2E_DB_PATH,
      SESSION_SECRET: "e2etest",
      NODE_ENV: "production",
    },
  },
});
