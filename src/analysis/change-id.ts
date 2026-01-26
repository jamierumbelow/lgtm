import { createHash } from "crypto";

export interface ChangeGroupSignature {
  files: string[];
  hunks: Array<{
    file: string;
    hunk: {
      oldStart: number;
      oldLines: number;
      newStart: number;
      newLines: number;
      header: string;
    };
  }>;
}

export function createStableChangeGroupId(
  signature: ChangeGroupSignature
): string {
  const files = [...signature.files].sort();
  const hunks = signature.hunks
    .map(
      ({ file, hunk }) =>
        `${file}:${hunk.oldStart},${hunk.oldLines}:${hunk.newStart},${hunk.newLines}:${hunk.header}`
    )
    .sort();
  const payload = JSON.stringify({ files, hunks });
  const hash = createHash("sha256").update(payload).digest("hex").slice(0, 12);
  return `group-${hash}`;
}
