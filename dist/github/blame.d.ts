export interface FileContributor {
    email: string;
    name: string;
    commits: number;
    linesAuthored: number;
    lastCommitDate: Date;
}
export interface BlameInfo {
    path: string;
    contributors: FileContributor[];
    frequentReviewers: string[];
}
/**
 * Get contributors who have worked on a file and might have context
 */
export declare function getFileContributors(filePath: string): Promise<BlameInfo>;
/**
 * Aggregate contributors across multiple files
 */
export declare function aggregateContributors(filePaths: string[]): Promise<FileContributor[]>;
