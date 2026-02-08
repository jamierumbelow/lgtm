/**
 * Persistent user preferences stored in ~/.config/lgtm/preferences.json.
 * Separate from the secrets (keychain) and cache (~/.cache/lgtm/).
 *
 * NOTE: This module must NOT import from config.ts to avoid circular deps.
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CONFIG_DIR = join(homedir(), ".config", "lgtm");
const PREFS_PATH = join(CONFIG_DIR, "preferences.json");

interface Preferences {
  defaultModel?: string;
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function readPrefs(): Preferences {
  if (!existsSync(PREFS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(PREFS_PATH, "utf-8")) as Preferences;
  } catch {
    return {};
  }
}

function writePrefs(prefs: Preferences): void {
  ensureConfigDir();
  writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2) + "\n");
}

/** Get the raw stored default model string, or undefined if not set */
export function getRawUserDefaultModel(): string | undefined {
  const prefs = readPrefs();
  return prefs.defaultModel ?? undefined;
}

/** Set the user's default model (stored as a plain string) */
export function setRawUserDefaultModel(model: string): void {
  const prefs = readPrefs();
  prefs.defaultModel = model;
  writePrefs(prefs);
}

/** Clear the user's default model (revert to built-in default) */
export function clearUserDefaultModel(): void {
  const prefs = readPrefs();
  delete prefs.defaultModel;
  writePrefs(prefs);
}
