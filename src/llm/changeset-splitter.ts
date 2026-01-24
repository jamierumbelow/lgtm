import { z } from 'zod';
import { loadPrompt, generateStructured } from './client.js';
import { FileDiff, DiffHunk, ChangeGroup, parseDiff } from '../analysis/chunker.js';

const ChangesetSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  changeType: z.enum(['feature', 'bugfix', 'refactor', 'test', 'docs', 'config', 'chore']),
  files: z.array(z.string()),
  hunkRefs: z.array(z.string()),
});

const ChangesetsResponseSchema = z.object({
  changesets: z.array(ChangesetSchema),
});

type ChangesetResponse = z.infer<typeof ChangesetSchema>;

export async function splitChangesetsWithLLM(diff: string): Promise<ChangeGroup[]> {
  const fileDiffs = parseDiff(diff);

  if (fileDiffs.length === 0) {
    return [];
  }

  const systemPrompt = loadPrompt('changeset-split/changeset-split.v1.txt');
  const userPrompt = buildUserPrompt(fileDiffs);

  const response = await generateStructured(
    systemPrompt,
    userPrompt,
    ChangesetsResponseSchema,
    { temperature: 0.1 }
  );

  return mapToChangeGroups(response.changesets, fileDiffs);
}

function buildUserPrompt(fileDiffs: FileDiff[]): string {
  const fileList = fileDiffs.map(f => `- ${f.path} (${f.status})`).join('\n');

  let diffContent = '';
  for (const file of fileDiffs) {
    diffContent += `\n=== ${file.path} ===\n`;
    file.hunks.forEach((hunk, i) => {
      diffContent += `\n[Hunk ${i}] @@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${hunk.header}\n`;
      diffContent += hunk.content + '\n';
    });
  }

  return `## Files Changed

${fileList}

## Unified Diff

${diffContent}

Please analyze this diff and split it into logical changesets.`;
}

function mapToChangeGroups(changesets: ChangesetResponse[], fileDiffs: FileDiff[]): ChangeGroup[] {
  // Build a lookup for hunks
  const hunkLookup = new Map<string, { file: string; hunk: DiffHunk }>();
  for (const file of fileDiffs) {
    file.hunks.forEach((hunk, i) => {
      hunkLookup.set(`${file.path}:${i}`, { file: file.path, hunk });
    });
  }

  // Map LLM changesets to ChangeGroup format
  return changesets.map((cs, index) => {
    const hunks: Array<{ file: string; hunk: DiffHunk }> = [];

    for (const ref of cs.hunkRefs) {
      const hunkData = hunkLookup.get(ref);
      if (hunkData) {
        hunks.push(hunkData);
      }
    }

    // Extract symbols from hunks
    const symbolsIntroduced = extractNewSymbols(hunks);
    const symbolsModified = extractModifiedSymbols(hunks);

    // Map changeType (handle 'chore' -> 'unknown')
    let changeType: ChangeGroup['changeType'] = 'unknown';
    if (cs.changeType === 'feature') changeType = 'feature';
    else if (cs.changeType === 'bugfix') changeType = 'bugfix';
    else if (cs.changeType === 'refactor') changeType = 'refactor';
    else if (cs.changeType === 'test') changeType = 'test';
    else if (cs.changeType === 'docs') changeType = 'docs';
    else if (cs.changeType === 'config') changeType = 'config';

    return {
      id: cs.id || `group-${index}`,
      title: cs.title,
      description: cs.description,
      files: cs.files,
      hunks,
      changeType,
      symbolsIntroduced,
      symbolsModified,
    };
  });
}

function extractNewSymbols(hunks: Array<{ file: string; hunk: DiffHunk }>): string[] {
  const symbols: string[] = [];

  for (const { hunk } of hunks) {
    const addedLines = hunk.content
      .split('\n')
      .filter(l => l.startsWith('+'))
      .map(l => l.slice(1));

    for (const line of addedLines) {
      // Function declarations
      const funcMatch = line.match(/(?:function|const|let|var)\s+(\w+)\s*[=(]/);
      if (funcMatch) symbols.push(funcMatch[1]);

      // Class declarations
      const classMatch = line.match(/class\s+(\w+)/);
      if (classMatch) symbols.push(classMatch[1]);

      // Type/interface declarations
      const typeMatch = line.match(/(?:type|interface)\s+(\w+)/);
      if (typeMatch) symbols.push(typeMatch[1]);

      // Python function/class
      const pyMatch = line.match(/(?:def|class)\s+(\w+)/);
      if (pyMatch) symbols.push(pyMatch[1]);
    }
  }

  return [...new Set(symbols)];
}

function extractModifiedSymbols(hunks: Array<{ file: string; hunk: DiffHunk }>): string[] {
  const symbols: string[] = [];

  for (const { hunk } of hunks) {
    if (hunk.header) {
      const funcMatch = hunk.header.match(/(?:function|def|class)\s+(\w+)/);
      if (funcMatch) symbols.push(funcMatch[1]);
    }
  }

  return [...new Set(symbols)];
}
