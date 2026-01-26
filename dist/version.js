// This file is modified during CI builds to contain the correct version info
// Canary builds will have isCanary: true and a commit SHA
// Stable builds will have isCanary: false
const buildInfo = {
    version: "0.1.0",
    isCanary: false,
    commitSha: null,
    buildDate: null,
};
export const VERSION = buildInfo.version;
export const IS_CANARY = buildInfo.isCanary;
export const COMMIT_SHA = buildInfo.commitSha;
export const BUILD_DATE = buildInfo.buildDate;
export const getVersionString = () => {
    if (buildInfo.isCanary && buildInfo.commitSha) {
        return `${buildInfo.version}-canary (${buildInfo.commitSha.slice(0, 7)})`;
    }
    return buildInfo.version;
};
export const getBuildType = () => {
    return buildInfo.isCanary ? "canary" : "stable";
};
