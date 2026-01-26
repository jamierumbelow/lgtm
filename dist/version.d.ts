export declare const VERSION: string;
export declare const IS_CANARY: boolean;
export declare const COMMIT_SHA: string | null;
export declare const BUILD_DATE: string | null;
export declare const getVersionString: () => string;
export declare const getBuildType: () => "canary" | "stable";
