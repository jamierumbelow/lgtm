export interface PRFile {
    path: string;
    additions: number;
    deletions: number;
    status: 'added' | 'modified' | 'removed' | 'renamed';
    previousPath?: string;
}
export interface PRData {
    url?: string;
    title?: string;
    body?: string;
    author?: string;
    baseBranch: string;
    headBranch: string;
    files: PRFile[];
    diff: string;
    createdAt?: Date;
}
interface CLIOptions {
    base?: string;
    head?: string;
}
/**
 * Fetch PR data from GitHub using the gh CLI, or generate from local branches
 */
export declare function getPRData(prUrl: string | undefined, options: CLIOptions): Promise<PRData>;
export {};
