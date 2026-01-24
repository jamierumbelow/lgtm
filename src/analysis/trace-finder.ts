import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

export interface TraceMatch {
  source: 'claude-code' | 'cursor' | 'codex' | 'unknown';
  sessionId: string;
  sessionPath: string;
  confidence: number; // 0-1
  matchedFiles: string[];
  timestamp: Date;
  snippets?: string[]; // Relevant conversation snippets
}

interface FindTracesOptions {
  claudeDir?: string;
  cursorDir?: string;
}

/**
 * Search for LLM session traces that might have generated the given changes
 */
export async function findTraces(
  files: Array<{ path: string }>,
  options: FindTracesOptions
): Promise<TraceMatch[]> {
  const matches: TraceMatch[] = [];
  const filePaths = files.map(f => f.path);

  // Search Claude Code history
  const claudeDir = expandPath(options.claudeDir || '~/.claude');
  if (existsSync(claudeDir)) {
    const claudeMatches = await searchClaudeHistory(claudeDir, filePaths);
    matches.push(...claudeMatches);
  }

  // Search Cursor history
  const cursorDir = expandPath(options.cursorDir || '~/.cursor');
  if (existsSync(cursorDir)) {
    const cursorMatches = await searchCursorHistory(cursorDir, filePaths);
    matches.push(...cursorMatches);
  }

  // Sort by confidence, then by timestamp (most recent first)
  return matches.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.timestamp.getTime() - a.timestamp.getTime();
  });
}

function expandPath(path: string): string {
  if (path.startsWith('~')) {
    return join(homedir(), path.slice(1));
  }
  return resolve(path);
}

async function searchClaudeHistory(claudeDir: string, filePaths: string[]): Promise<TraceMatch[]> {
  const matches: TraceMatch[] = [];

  // Claude Code stores projects in ~/.claude/projects/
  const projectsDir = join(claudeDir, 'projects');
  if (!existsSync(projectsDir)) return matches;

  try {
    const projects = readdirSync(projectsDir);

    for (const project of projects) {
      const projectPath = join(projectsDir, project);
      const stat = statSync(projectPath);
      if (!stat.isDirectory()) continue;

      // Look for session files (JSONL format)
      const sessionFiles = findFiles(projectPath, '.jsonl');

      for (const sessionFile of sessionFiles) {
        const match = await analyzeClaudeSession(sessionFile, filePaths);
        if (match && match.confidence > 0.3) {
          matches.push(match);
        }
      }
    }
  } catch (error) {
    // Permission denied or other error
    console.error(`Warning: Could not read Claude history: ${error}`);
  }

  return matches;
}

async function analyzeClaudeSession(sessionPath: string, filePaths: string[]): Promise<TraceMatch | null> {
  try {
    const content = readFileSync(sessionPath, 'utf-8');
    const lines = content.trim().split('\n');

    let matchedFiles: string[] = [];
    let timestamp = new Date(0);
    const snippets: string[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        // Extract timestamp
        if (entry.timestamp) {
          const entryTime = new Date(entry.timestamp);
          if (entryTime > timestamp) timestamp = entryTime;
        }

        // Check for file path mentions
        const entryStr = JSON.stringify(entry);
        for (const filePath of filePaths) {
          const fileName = filePath.split('/').pop() || filePath;
          if (entryStr.includes(filePath) || entryStr.includes(fileName)) {
            if (!matchedFiles.includes(filePath)) {
              matchedFiles.push(filePath);
            }
          }
        }

        // Extract relevant conversation snippets
        if (entry.message?.content || entry.content) {
          const messageContent = entry.message?.content || entry.content;
          if (typeof messageContent === 'string' && messageContent.length < 500) {
            // Check if this message mentions any of our files
            for (const filePath of filePaths) {
              if (messageContent.includes(filePath) || messageContent.includes(filePath.split('/').pop() || '')) {
                snippets.push(messageContent.slice(0, 200));
                break;
              }
            }
          }
        }
      } catch {
        // Invalid JSON line, skip
      }
    }

    if (matchedFiles.length === 0) return null;

    // Calculate confidence based on file match ratio
    const confidence = matchedFiles.length / filePaths.length;

    return {
      source: 'claude-code',
      sessionId: sessionPath.split('/').pop()?.replace('.jsonl', '') || 'unknown',
      sessionPath,
      confidence,
      matchedFiles,
      timestamp,
      snippets: snippets.slice(0, 5), // Limit to 5 most relevant snippets
    };
  } catch {
    return null;
  }
}

async function searchCursorHistory(cursorDir: string, filePaths: string[]): Promise<TraceMatch[]> {
  const matches: TraceMatch[] = [];

  // Cursor stores history in SQLite databases
  // Common locations:
  // - ~/.cursor/User/globalStorage/state.vscdb
  // - ~/.cursor/User/workspaceStorage/*/state.vscdb

  const workspaceDir = join(cursorDir, 'User', 'workspaceStorage');
  if (!existsSync(workspaceDir)) return matches;

  try {
    const workspaces = readdirSync(workspaceDir);

    for (const workspace of workspaces) {
      const dbPath = join(workspaceDir, workspace, 'state.vscdb');
      if (existsSync(dbPath)) {
        // Note: Would need sqlite3 binding to actually read this
        // For now, we'll just note that we found a potential source
        const stat = statSync(dbPath);
        matches.push({
          source: 'cursor',
          sessionId: workspace,
          sessionPath: dbPath,
          confidence: 0.1, // Low confidence since we can't actually read it
          matchedFiles: [],
          timestamp: stat.mtime,
          snippets: ['SQLite database - analysis requires sqlite3 binding'],
        });
      }
    }
  } catch (error) {
    console.error(`Warning: Could not read Cursor history: ${error}`);
  }

  return matches;
}

function findFiles(dir: string, extension: string): string[] {
  const files: string[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...findFiles(fullPath, extension));
      } else if (entry.name.endsWith(extension)) {
        files.push(fullPath);
      }
    }
  } catch {
    // Permission denied or other error
  }

  return files;
}
