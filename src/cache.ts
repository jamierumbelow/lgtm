import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { Analysis } from "./analysis/analyzer.js";
import { PRData } from "./github/pr.js";

const CACHE_DIR = join(homedir(), ".cache", "lgtm");

interface CachedData {
  version: number;
  timestamp: string;
  prData: PRData;
  analysis: Analysis;
}

const CACHE_VERSION = 1;

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function getCacheKey(prUrl: string): string {
  // Create a hash of the PR URL for the filename
  const hash = createHash("sha256").update(prUrl).digest("hex").slice(0, 16);
  // Also include a readable portion
  const urlParts = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (urlParts) {
    const [, owner, repo, prNumber] = urlParts;
    return `${owner}-${repo}-${prNumber}-${hash}.json`;
  }
  return `${hash}.json`;
}

function getCachePath(prUrl: string): string {
  return join(CACHE_DIR, getCacheKey(prUrl));
}

export function getCached(
  prUrl: string
): { prData: PRData; analysis: Analysis } | null {
  ensureCacheDir();
  const cachePath = getCachePath(prUrl);

  if (!existsSync(cachePath)) {
    return null;
  }

  try {
    const raw = readFileSync(cachePath, "utf-8");
    const cached: CachedData = JSON.parse(raw, (key, value) => {
      // Revive Date objects
      if (
        key === "analyzedAt" ||
        key === "createdAt" ||
        key === "lastCommitDate" ||
        key === "timestamp"
      ) {
        return new Date(value);
      }
      return value;
    });

    // Check cache version
    if (cached.version !== CACHE_VERSION) {
      return null;
    }

    return {
      prData: cached.prData,
      analysis: cached.analysis,
    };
  } catch {
    // Corrupted cache, ignore
    return null;
  }
}

export function setCache(
  prUrl: string,
  prData: PRData,
  analysis: Analysis
): void {
  ensureCacheDir();
  const cachePath = getCachePath(prUrl);

  const cached: CachedData = {
    version: CACHE_VERSION,
    timestamp: new Date().toISOString(),
    prData,
    analysis,
  };

  try {
    writeFileSync(cachePath, JSON.stringify(cached, null, 2));
  } catch (error) {
    console.error(`[lgtm] Failed to write cache to ${cachePath}:`, error);
    throw error;
  }
}

export function clearCache(prUrl: string): boolean {
  const cachePath = getCachePath(prUrl);

  if (existsSync(cachePath)) {
    unlinkSync(cachePath);
    return true;
  }
  return false;
}

export function getCacheInfo(prUrl: string): {
  exists: boolean;
  path: string;
  timestamp?: Date;
} {
  const cachePath = getCachePath(prUrl);
  const exists = existsSync(cachePath);

  if (exists) {
    try {
      const raw = readFileSync(cachePath, "utf-8");
      const cached: CachedData = JSON.parse(raw);
      return {
        exists: true,
        path: cachePath,
        timestamp: new Date(cached.timestamp),
      };
    } catch {
      return { exists: true, path: cachePath };
    }
  }

  return { exists: false, path: cachePath };
}
