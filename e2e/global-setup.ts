import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { E2E_DB_PATH } from "../playwright.config.ts";

/**
 * Wipe and recreate the throwaway DB directory BEFORE the webServer boots, so the
 * app opens a brand-new SQLite file and runs its migrations from scratch every
 * run. Playwright invokes globalSetup before starting `webServer`.
 */
export default function globalSetup() {
  const dir = dirname(E2E_DB_PATH);
  // Remove any leftover db + WAL/SHM sidecars from a prior run.
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}
