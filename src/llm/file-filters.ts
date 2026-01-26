import { posix as pathPosix } from "path";

const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "poetry.lock",
  "Pipfile.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "go.sum",
  "composer.lock",
]);

const GENERATED_DIR_MARKERS = [
  "/dist/",
  "/build/",
  "/coverage/",
  "/out/",
  "/generated/",
  "/.next/",
  "/.nuxt/",
  "/.svelte-kit/",
  "/.turbo/",
  "/.cache/",
  "/vendor/",
  "/node_modules/",
];

const GENERATED_FILE_PATTERNS = [
  ".min.js",
  ".min.css",
  ".map",
  ".bundle.js",
  ".generated.",
  ".gen.",
  ".pb.go",
  ".designer.cs",
];

export function isLockfilePath(filePath: string): boolean {
  const base = pathPosix.basename(filePath);
  return LOCKFILE_NAMES.has(base);
}

export function isGeneratedPath(filePath: string): boolean {
  const normalized = `/${filePath.replace(/\\/g, "/")}`.toLowerCase();
  if (GENERATED_DIR_MARKERS.some((marker) => normalized.includes(marker))) {
    return true;
  }
  const base = pathPosix.basename(normalized);
  return GENERATED_FILE_PATTERNS.some((pattern) => base.includes(pattern));
}

export function isLLMExcludedFile(filePath: string): boolean {
  return isLockfilePath(filePath) || isGeneratedPath(filePath);
}
