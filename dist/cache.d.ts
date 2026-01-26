import { Analysis } from './analysis/analyzer.js';
import { PRData } from './github/pr.js';
export declare function getCached(prUrl: string): {
    prData: PRData;
    analysis: Analysis;
} | null;
export declare function setCache(prUrl: string, prData: PRData, analysis: Analysis): void;
export declare function clearCache(prUrl: string): boolean;
export declare function getCacheInfo(prUrl: string): {
    exists: boolean;
    path: string;
    timestamp?: Date;
};
