import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { ReviewQuestion } from "../analysis/analyzer.js";

const CHANGESET_CACHE_DIR = join(homedir(), ".cache", "lgtm", "changesets");

interface CachedChangeset {
  id: string;
  timestamp: string;
  reviewQuestions: ReviewQuestion[];
}

function ensureChangesetCacheDir(): void {
  if (!existsSync(CHANGESET_CACHE_DIR)) {
    mkdirSync(CHANGESET_CACHE_DIR, { recursive: true });
  }
}

function getChangesetCachePath(id: string): string {
  return join(CHANGESET_CACHE_DIR, `${id}.json`);
}

export function getCachedChangesetQuestions(
  id: string
): ReviewQuestion[] | null {
  ensureChangesetCacheDir();
  const cachePath = getChangesetCachePath(id);

  if (!existsSync(cachePath)) {
    return null;
  }

  try {
    const raw = readFileSync(cachePath, "utf-8");
    const cached: CachedChangeset = JSON.parse(raw);
    return cached.reviewQuestions;
  } catch {
    return null;
  }
}

export function setCachedChangesetQuestions(
  id: string,
  reviewQuestions: ReviewQuestion[]
): void {
  ensureChangesetCacheDir();
  const cachePath = getChangesetCachePath(id);

  const cached: CachedChangeset = {
    id,
    timestamp: new Date().toISOString(),
    reviewQuestions,
  };

  try {
    writeFileSync(cachePath, JSON.stringify(cached, null, 2));
  } catch (error) {
    console.error(`[lgtm] Failed to write changeset cache to ${cachePath}:`, error);
  }
}
