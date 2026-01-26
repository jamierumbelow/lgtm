export interface TraceMatch {
    source: 'claude-code' | 'cursor' | 'codex' | 'unknown';
    sessionId: string;
    sessionPath: string;
    confidence: number;
    matchedFiles: string[];
    timestamp: Date;
    snippets?: string[];
}
interface FindTracesOptions {
    claudeDir?: string;
    cursorDir?: string;
}
/**
 * Search for LLM session traces that might have generated the given changes
 */
export declare function findTraces(files: Array<{
    path: string;
}>, options: FindTracesOptions): Promise<TraceMatch[]>;
export {};
