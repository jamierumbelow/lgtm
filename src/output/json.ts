import { Analysis } from '../analysis/analyzer.js';

export function renderJSON(analysis: Analysis): string {
  return JSON.stringify(analysis, null, 2);
}
