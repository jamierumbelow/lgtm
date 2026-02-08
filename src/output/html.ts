import { Analysis, ReviewQuestion } from "../analysis/analyzer.js";
import { ChangeGroup, ReviewSuggestion } from "../analysis/chunker.js";
import { marked } from "marked";

export function renderHTML(analysis: Analysis): string {
  const summarySlide = renderSummarySlide(analysis);
  const reviewSlides = renderReviewSlides(analysis);
  const totalSlides = analysis.changeGroups.length + 1; // +1 for summary slide

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PR Review: ${escapeHtml(analysis.title || "Untitled")}</title>
  <style>
    :root {
      --bg: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #1c2128;
      --border: #30363d;
      --text: #e6edf3;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --green: #3fb950;
      --green-bg: rgba(63, 185, 80, 0.15);
      --red: #f85149;
      --red-bg: rgba(248, 81, 73, 0.15);
      --yellow: #d29922;
      --purple: #a371f7;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
    }

    h1, h2, h3 {
      color: var(--text);
      border-bottom: 1px solid var(--border);
      padding-bottom: 8px;
    }

    h1 { font-size: 1.8em; }
    h2 { font-size: 1.4em; margin-top: 2em; }
    h3 { font-size: 1.1em; border: none; }

    .stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin: 24px 0;
    }

    .stat {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      text-align: center;
    }

    .stat-value {
      font-size: 24px;
      font-weight: 600;
    }

    .stat-label {
      font-size: 12px;
      color: var(--text-muted);
      text-transform: uppercase;
    }

    .stat-value.green { color: var(--green); }
    .stat-value.red { color: var(--red); }

    .change-type {
      display: inline-block;
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 12px;
      text-transform: uppercase;
      font-weight: 600;
    }

    .change-type.feature { background: #1f6feb33; color: #58a6ff; }
    .change-type.refactor { background: #a371f733; color: #a371f7; }
    .change-type.bugfix { background: #f8514933; color: #f85149; }
    .change-type.test { background: #3fb95033; color: #3fb950; }
    .change-type.config { background: #d2992233; color: #d29922; }
    .change-type.docs { background: #8b949e33; color: #8b949e; }
    .change-type.types { background: #79c0ff33; color: #79c0ff; }
    .change-type.unknown { background: #30363d; color: #8b949e; }

    code {
      font-family: 'SF Mono', Consolas, monospace;
      background: var(--bg);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 13px;
    }

    .symbols {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 8px 0;
    }

    .symbol {
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 12px;
      background: var(--bg);
      padding: 4px 8px;
      border-radius: 4px;
      color: var(--accent);
    }

    /* Review Mode */
    #review-mode {
      display: block;
      height: 100vh;
      overflow: hidden;
    }

    .slides-container {
      position: relative;
      height: 100vh;
      width: 100vw;
    }

    .slide {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: none;
      opacity: 0;
      transition: opacity 0.2s ease;
    }

    .slide.active {
      display: flex;
      opacity: 1;
    }

    .diff-panel {
      flex: 1;
      overflow: auto;
      padding: 24px;
      padding-top: 80px;
      border-right: 1px solid var(--border);
    }

    .meta-panel {
      width: 400px;
      overflow: auto;
      padding: 24px;
      padding-top: 80px;
      background: var(--bg-secondary);
    }

    .diff-file { margin-bottom: 24px; }

    .diff-file-header {
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 13px;
      padding: 12px 16px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border);
      border-radius: 8px 8px 0 0;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .diff-file-name {
      flex: 1;
    }

    .diff-mode-toggle {
      display: flex;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
    }

    .diff-mode-btn {
      padding: 4px 8px;
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      transition: all 0.15s;
    }

    .diff-mode-btn:hover {
      color: var(--text);
      background: var(--bg-tertiary);
    }

    .diff-mode-btn.active {
      background: var(--accent);
      color: #fff;
    }

    .diff-mode-btn + .diff-mode-btn {
      border-left: 1px solid var(--border);
    }

    .diff-file-header .status {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
      font-weight: 600;
    }

    .status.added { background: var(--green-bg); color: var(--green); }
    .status.modified { background: rgba(88, 166, 255, 0.15); color: var(--accent); }
    .status.removed { background: var(--red-bg); color: var(--red); }
    .status.renamed { background: rgba(163, 113, 247, 0.15); color: var(--purple); }

    .diff-content {
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 13px;
      line-height: 1.5;
      background: var(--bg-tertiary);
      border: 1px solid var(--border);
      border-top: none;
      border-radius: 0 0 8px 8px;
      overflow-x: auto;
    }

    .diff-content-side-by-side .diff-row {
      display: grid;
      grid-template-columns: 50px 1fr 50px 1fr;
      min-height: 22px;
    }

    .diff-content-side-by-side .diff-row .line-number {
      width: auto;
      padding: 0 8px;
      text-align: right;
      color: var(--text-muted);
      user-select: none;
      border-right: 1px solid var(--border);
    }

    .diff-content-side-by-side .diff-row .line-number.new {
      border-left: 1px solid var(--border);
    }

    .diff-content-side-by-side .diff-row .line-content {
      padding: 0 16px;
      white-space: pre;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .diff-content-side-by-side .diff-row .line-content.new {
      border-left: 1px solid var(--border);
    }

    .diff-content-side-by-side .diff-row.addition .line-content.new {
      background: var(--green-bg);
    }

    .diff-content-side-by-side .diff-row.deletion .line-content.old {
      background: var(--red-bg);
    }

    .diff-content-side-by-side .diff-hunk-header {
      padding: 4px 16px;
      background: rgba(88, 166, 255, 0.1);
      color: var(--text-muted);
      font-style: italic;
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
    }

    body[data-diff-mode="side-by-side"] .diff-content-integrated {
      display: none;
    }

    body[data-diff-mode="integrated"] .diff-content-side-by-side {
      display: none;
    }

    .diff-line {
      display: flex;
      min-height: 22px;
    }

    .diff-line.addition { background: var(--green-bg); }
    .diff-line.deletion { background: var(--red-bg); }

    .diff-line.hunk-header {
      background: rgba(88, 166, 255, 0.1);
      color: var(--text-muted);
      font-style: italic;
    }

    .line-number {
      width: 50px;
      padding: 0 8px;
      text-align: right;
      color: var(--text-muted);
      user-select: none;
      flex-shrink: 0;
      border-right: 1px solid var(--border);
    }

    .line-content {
      padding: 0 16px;
      white-space: pre;
      flex: 1;
    }

    .line-content .addition-marker { color: var(--green); }
    .line-content .deletion-marker { color: var(--red); }

    .meta-header { margin-bottom: 24px; }

    .meta-title {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 8px;
      line-height: 1.3;
    }

    .meta-section { margin-bottom: 24px; }

    .meta-section-title {
      font-size: 11px;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 8px;
      font-weight: 600;
      letter-spacing: 0.5px;
    }

    .meta-file-list { list-style: none; }

    .meta-file-list li {
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 12px;
      padding: 6px 0;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border);
    }

    .meta-file-list li:last-child { border-bottom: none; }

    .review-question-card {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 12px;
      overflow: hidden;
    }

    .review-question-text {
      padding: 12px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .review-question-text:hover { background: var(--bg-tertiary); }

    .review-question-text .chevron {
      transition: transform 0.2s;
      color: var(--text-muted);
    }

    .review-question-card.expanded .chevron {
      transform: rotate(180deg);
    }

    .review-question-answer {
      display: none;
      padding: 12px;
      border-top: 1px solid var(--border);
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.6;
    }

    .review-question-card.expanded .review-question-answer {
      display: block;
    }

    .review-question-answer p {
      margin-bottom: 8px;
    }

    .review-question-answer p:last-child {
      margin-bottom: 0;
    }

    .review-question-answer ul,
    .review-question-answer ol {
      margin: 8px 0;
      padding-left: 20px;
    }

    .review-question-answer li {
      margin-bottom: 4px;
    }

    .review-question-answer code {
      background: var(--bg-tertiary);
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 12px;
    }

    .review-question-answer pre {
      background: var(--bg-tertiary);
      padding: 8px;
      border-radius: 4px;
      overflow-x: auto;
      margin: 8px 0;
    }

    .review-question-answer pre code {
      background: none;
      padding: 0;
    }

    .navigation {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 16px;
      background: var(--bg-secondary);
      padding: 12px 24px;
      border-radius: 12px;
      border: 1px solid var(--border);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      z-index: 100;
    }

    .nav-btn {
      background: var(--bg-tertiary);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
    }

    .nav-btn:hover:not(:disabled) { background: var(--border); }

    .nav-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .nav-counter {
      font-size: 14px;
      color: var(--text-muted);
      min-width: 80px;
      text-align: center;
    }

    .nav-counter .current {
      color: var(--text);
      font-weight: 600;
    }

    .keyboard-hint {
      font-size: 11px;
      color: var(--text-muted);
      margin-left: 16px;
      padding-left: 16px;
      border-left: 1px solid var(--border);
    }

    .kbd {
      display: inline-block;
      padding: 2px 6px;
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 10px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      margin: 0 2px;
    }

    .progress-bar {
      position: fixed;
      top: 0;
      left: 0;
      height: 3px;
      background: var(--accent);
      transition: width 0.2s ease;
      z-index: 1001;
    }

    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 16px;
    }

    /* Summary Slide */
    .slide.summary.active {
      align-items: center;
      justify-content: center;
    }

    .summary-slide {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      padding: 80px 40px 120px;
      overflow-y: auto;
    }

    .summary-content {
      max-width: 700px;
      width: 100%;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .summary-header {
      text-align: center;
      margin-bottom: 40px;
      width: 100%;
    }

    .summary-title {
      font-size: 32px;
      font-weight: 600;
      margin-bottom: 16px;
      line-height: 1.3;
    }

    .summary-author {
      font-size: 16px;
      color: var(--text-muted);
    }

    .summary-author strong {
      color: var(--text);
    }

    .summary-description {
      margin-bottom: 40px;
      width: 100%;
    }

    .summary-description-content {
      font-size: 15px;
      line-height: 1.7;
      color: var(--text);
      background: var(--bg-secondary);
      padding: 24px;
      border-radius: 12px;
      border: 1px solid var(--border);
      max-height: 300px;
      overflow-y: auto;
    }

    .summary-description-content p {
      margin-bottom: 12px;
    }

    .summary-description-content p:last-child {
      margin-bottom: 0;
    }

    .summary-description-content h1,
    .summary-description-content h2,
    .summary-description-content h3 {
      border: none;
      margin-top: 20px;
      margin-bottom: 10px;
      font-size: 1.1em;
    }

    .summary-description-content h1:first-child,
    .summary-description-content h2:first-child,
    .summary-description-content h3:first-child {
      margin-top: 0;
    }

    .summary-description-content ul,
    .summary-description-content ol {
      margin: 12px 0;
      padding-left: 24px;
    }

    .summary-description-content li {
      margin-bottom: 6px;
    }

    .summary-description-content code {
      background: var(--bg);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 13px;
    }

    .summary-description-content pre {
      background: var(--bg);
      padding: 12px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 12px 0;
    }

    .summary-description-content pre code {
      background: none;
      padding: 0;
    }

    .summary-description-content a {
      color: var(--accent);
    }

    .summary-description-content blockquote {
      border-left: 3px solid var(--border);
      padding-left: 16px;
      margin: 12px 0;
      color: var(--text-muted);
    }

    .summary-stats {
      display: flex;
      justify-content: center;
      gap: 40px;
    }

    .summary-stat {
      text-align: center;
    }

    .summary-stat-value {
      font-size: 32px;
      font-weight: 600;
    }

    .summary-stat-value.green { color: var(--green); }
    .summary-stat-value.red { color: var(--red); }

    .summary-stat-label {
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 4px;
    }

    .summary-hint {
      margin-top: 40px;
      font-size: 14px;
      color: var(--text-muted);
      text-align: center;
    }

    /* Generation Metadata Panel */
    .generation-meta {
      position: fixed;
      bottom: 16px;
      left: 16px;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 11px;
      color: var(--text-muted);
      z-index: 100;
      display: flex;
      gap: 16px;
      opacity: 0.7;
      transition: opacity 0.15s;
    }

    .generation-meta:hover {
      opacity: 1;
    }

    .generation-meta-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .generation-meta-value {
      color: var(--text);
      font-weight: 500;
      font-family: 'SF Mono', Consolas, monospace;
    }

    /* Risk Level Badges */
    .risk-badge {
      display: inline-block;
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 12px;
      text-transform: uppercase;
      font-weight: 600;
      letter-spacing: 0.3px;
    }

    .risk-badge.low { background: #3fb95022; color: #3fb950; }
    .risk-badge.medium { background: #d2992233; color: #d29922; }
    .risk-badge.high { background: #f8514933; color: #f85149; }
    .risk-badge.critical { background: #f85149; color: #fff; }

    /* Verdict */
    .verdict {
      font-size: 15px;
      line-height: 1.6;
      color: var(--text);
      padding: 12px 16px;
      background: var(--bg);
      border-left: 3px solid var(--accent);
      border-radius: 0 8px 8px 0;
      margin-bottom: 16px;
    }

    .verdict.risk-high {
      border-left-color: var(--red);
    }

    .verdict.risk-critical {
      border-left-color: var(--red);
      background: var(--red-bg);
    }

    .verdict.risk-low {
      border-left-color: var(--green);
    }

    /* Suggestions */
    .suggestion-card {
      display: flex;
      gap: 10px;
      padding: 10px 12px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      margin-bottom: 8px;
      font-size: 13px;
      line-height: 1.5;
    }

    .suggestion-severity {
      flex-shrink: 0;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      padding: 2px 6px;
      border-radius: 4px;
      height: fit-content;
      margin-top: 2px;
    }

    .suggestion-severity.nit { background: #8b949e22; color: #8b949e; }
    .suggestion-severity.suggestion { background: #58a6ff22; color: #58a6ff; }
    .suggestion-severity.important { background: #d2992233; color: #d29922; }
    .suggestion-severity.critical { background: #f85149; color: #fff; }

    .suggestion-text {
      color: var(--text-muted);
    }

    .suggestion-file {
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 11px;
      color: var(--accent);
      margin-top: 4px;
    }

    /* Executive Summary */
    .executive-summary {
      width: 100%;
      margin-bottom: 40px;
    }

    .executive-summary-content {
      font-size: 15px;
      line-height: 1.7;
      color: var(--text);
      background: var(--bg-secondary);
      padding: 24px;
      border-radius: 12px;
      border: 1px solid var(--border);
    }

    .executive-summary-content p {
      margin-bottom: 12px;
    }

    .executive-summary-content p:last-child {
      margin-bottom: 0;
    }

    .review-guidance {
      width: 100%;
      margin-bottom: 40px;
    }

    .review-guidance-content {
      font-size: 14px;
      line-height: 1.7;
      color: var(--text-muted);
      padding: 16px 20px;
      background: var(--bg-secondary);
      border-left: 3px solid var(--accent);
      border-radius: 0 12px 12px 0;
    }

    .review-guidance-content p {
      margin-bottom: 8px;
    }

    .review-guidance-content p:last-child {
      margin-bottom: 0;
    }

    .review-guidance-content strong {
      color: var(--text);
    }

    /* Changeset list on summary */
    .changeset-list {
      width: 100%;
      margin-bottom: 40px;
    }

    .changeset-list-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 0;
      border-bottom: 1px solid var(--border);
      font-size: 14px;
    }

    .changeset-list-item:last-child {
      border-bottom: none;
    }

    .changeset-list-title {
      flex: 1;
      color: var(--text);
    }

    .changeset-list-verdict {
      font-size: 12px;
      color: var(--text-muted);
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  </style>
</head>
<body>
  <!-- Review Mode -->
  <div id="review-mode">
    <div class="progress-bar" id="progress"></div>
    <div class="slides-container" id="slides">
      ${summarySlide}
      ${reviewSlides}
    </div>
    <nav class="navigation">
      <button class="nav-btn" id="prev-btn" onclick="prevSlide()">
        <span>←</span> Previous
      </button>
      <div class="nav-counter">
        <span class="current" id="current-slide">1</span> / <span id="total-slides">${totalSlides}</span>
      </div>
      <button class="nav-btn" id="next-btn" onclick="nextSlide()">
        Next <span>→</span>
      </button>
      <div class="keyboard-hint">
        <kbd>←</kbd> <kbd>→</kbd> or <kbd>j</kbd> <kbd>k</kbd> to navigate
      </div>
    </nav>
  </div>

  <script>
    let currentSlide = 0;
    const totalSlides = ${totalSlides};
    const diffModeKey = 'lgtm-diff-mode';

    function setDiffMode(mode) {
      const resolvedMode = mode === 'integrated' ? 'integrated' : 'side-by-side';
      document.body.dataset.diffMode = resolvedMode;
      localStorage.setItem(diffModeKey, resolvedMode);

      document.querySelectorAll('.diff-mode-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mode === resolvedMode);
      });
    }

    function showSlide(index) {
      if (index < 0 || index >= totalSlides) return;

      const slides = document.querySelectorAll('.slide');
      slides.forEach((slide, i) => {
        slide.classList.toggle('active', i === index);
      });

      currentSlide = index;
      document.getElementById('current-slide').textContent = index + 1;
      document.getElementById('prev-btn').disabled = index === 0;
      document.getElementById('next-btn').disabled = index === totalSlides - 1;
      document.getElementById('progress').style.width = ((index + 1) / totalSlides * 100) + '%';
    }

    function nextSlide() {
      showSlide(currentSlide + 1);
    }

    function prevSlide() {
      showSlide(currentSlide - 1);
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'j' || e.key === 'l') {
        nextSlide();
      } else if (e.key === 'ArrowLeft' || e.key === 'k' || e.key === 'h') {
        prevSlide();
      }
    });

    function toggleQuestion(el) {
      el.closest('.review-question-card').classList.toggle('expanded');
    }

    // Initialize - start in review mode on summary slide
    setDiffMode(localStorage.getItem(diffModeKey) || 'side-by-side');
    showSlide(0);
  </script>

  ${renderGenerationMeta(analysis)}
</body>
</html>`;
}

function renderSummarySlide(analysis: Analysis): string {
  const summaryHtml = analysis.summary
    ? marked.parse(analysis.summary)
    : "";
  const guidanceHtml = analysis.reviewGuidance
    ? marked.parse(analysis.reviewGuidance)
    : "";

  return `
    <div class="slide summary active" data-index="0">
      <div class="summary-slide">
        <div class="summary-content">
          <div class="summary-header">
            <h1 class="summary-title">${escapeHtml(
              analysis.title ||
                `${analysis.baseBranch} ← ${analysis.headBranch}`
            )}</h1>
            <div class="summary-author">
              ${
                analysis.author
                  ? `By <strong>${escapeHtml(analysis.author)}</strong>`
                  : ""
              }
              ${
                analysis.prUrl
                  ? ` · <a href="${escapeHtml(
                      analysis.prUrl
                    )}" style="color: var(--accent)">View on GitHub</a>`
                  : ""
              }
            </div>
          </div>

          <div class="summary-stats">
            <div class="summary-stat">
              <div class="summary-stat-value">${analysis.filesChanged}</div>
              <div class="summary-stat-label">Files Changed</div>
            </div>
            <div class="summary-stat">
              <div class="summary-stat-value green">+${analysis.additions}</div>
              <div class="summary-stat-label">Additions</div>
            </div>
            <div class="summary-stat">
              <div class="summary-stat-value red">-${analysis.deletions}</div>
              <div class="summary-stat-label">Deletions</div>
            </div>
            <div class="summary-stat">
              <div class="summary-stat-value">${
                analysis.changeGroups.length
              }</div>
              <div class="summary-stat-label">Changesets</div>
            </div>
          </div>

          ${
            analysis.summary
              ? `
            <div class="executive-summary">
              <div class="meta-section-title">Summary</div>
              <div class="executive-summary-content">
                ${summaryHtml}
              </div>
            </div>
          `
              : ""
          }

          ${
            analysis.reviewGuidance
              ? `
            <div class="review-guidance">
              <div class="meta-section-title">Review Guidance</div>
              <div class="review-guidance-content">
                ${guidanceHtml}
              </div>
            </div>
          `
              : ""
          }

          ${renderChangesetList(analysis)}

          <div class="summary-hint">
            Press <kbd>→</kbd> or <kbd>j</kbd> to start reviewing
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderChangesetList(analysis: Analysis): string {
  if (analysis.changeGroups.length === 0) return "";

  const items = analysis.changeGroups
    .map(
      (group, i) => `
      <div class="changeset-list-item">
        <span class="change-type ${group.changeType}">${group.changeType}</span>
        ${
          group.riskLevel
            ? `<span class="risk-badge ${group.riskLevel}">${group.riskLevel}</span>`
            : ""
        }
        <span class="changeset-list-title">${escapeHtml(group.title)}</span>
        ${
          group.verdict
            ? `<span class="changeset-list-verdict" title="${escapeHtml(
                group.verdict
              )}">${escapeHtml(group.verdict)}</span>`
            : ""
        }
      </div>
    `
    )
    .join("");

  return `
    <div class="changeset-list">
      <div class="meta-section-title">Changesets</div>
      ${items}
    </div>
  `;
}

function renderReviewSlides(analysis: Analysis): string {
  return analysis.changeGroups
    .map(
      (group, index) => renderSlide(group, index + 1, analysis) // +1 because summary is at index 0
    )
    .join("\n");
}

function renderSlide(
  group: ChangeGroup,
  index: number,
  analysis: Analysis
): string {
  const diffContent = renderDiff(group);
  const relevantQuestions = getRelevantQuestions(group, analysis);

  return `
    <div class="slide" data-index="${index}">
      <div class="diff-panel">
        ${diffContent}
      </div>
      <div class="meta-panel">
        <div class="meta-header">
          <div class="meta-title">${escapeHtml(group.title)}</div>
          <div style="display: flex; gap: 6px; align-items: center; margin-top: 4px;">
            <span class="change-type ${group.changeType}">${group.changeType}</span>
            ${
              group.riskLevel
                ? `<span class="risk-badge ${group.riskLevel}">${group.riskLevel} risk</span>`
                : ""
            }
          </div>
        </div>

        ${
          group.verdict
            ? `
          <div class="meta-section">
            <div class="verdict${group.riskLevel ? ` risk-${group.riskLevel}` : ""}">
              ${escapeHtml(group.verdict)}
            </div>
          </div>
        `
            : ""
        }

        ${
          group.description
            ? `
          <div class="meta-section">
            <div class="meta-section-title">Description</div>
            <p style="font-size: 14px; line-height: 1.6; color: var(--text-muted);">${escapeHtml(
              group.description
            )}</p>
          </div>
        `
            : ""
        }

        ${renderSuggestions(group.suggestions)}

        <div class="meta-section">
          <div class="meta-section-title">Files (${group.files.length})</div>
          <ul class="meta-file-list">
            ${group.files.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}
          </ul>
        </div>

        ${
          group.symbolsIntroduced?.length
            ? `
          <div class="meta-section">
            <div class="meta-section-title">New Symbols</div>
            <div class="symbols">
              ${group.symbolsIntroduced
                .map((s) => `<span class="symbol">${escapeHtml(s)}</span>`)
                .join("")}
            </div>
          </div>
        `
            : ""
        }

        ${
          group.symbolsModified?.length
            ? `
          <div class="meta-section">
            <div class="meta-section-title">Modified Symbols</div>
            <div class="symbols">
              ${group.symbolsModified
                .map((s) => `<span class="symbol">${escapeHtml(s)}</span>`)
                .join("")}
            </div>
          </div>
        `
            : ""
        }

        ${
          relevantQuestions.length
            ? `
          <div class="meta-section">
            <div class="meta-section-title">Review Questions</div>
            ${relevantQuestions
              .map(
                (q) => `
              <div class="review-question-card">
                <div class="review-question-text" onclick="toggleQuestion(this)">
                  <span>${escapeHtml(q.question)}</span>
                  <span class="chevron">▼</span>
                </div>
                <div class="review-question-answer">
                  ${
                    q.answer
                      ? marked.parse(q.answer)
                      : q.context
                      ? `<pre style="white-space: pre-wrap; font-size: 12px;">${escapeHtml(
                          q.context
                        )}</pre>`
                      : "<em>Analysis pending...</em>"
                  }
                </div>
              </div>
            `
              )
              .join("")}
          </div>
        `
            : ""
        }
      </div>
    </div>
  `;
}

function renderSuggestions(suggestions?: ReviewSuggestion[]): string {
  if (!suggestions || suggestions.length === 0) return "";

  // Sort by severity: critical > important > suggestion > nit
  const severityOrder: Record<string, number> = {
    critical: 0,
    important: 1,
    suggestion: 2,
    nit: 3,
  };

  const sorted = [...suggestions].sort(
    (a, b) =>
      (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4)
  );

  return `
    <div class="meta-section">
      <div class="meta-section-title">Suggestions</div>
      ${sorted
        .map(
          (s) => `
        <div class="suggestion-card">
          <span class="suggestion-severity ${s.severity}">${s.severity}</span>
          <div>
            <div class="suggestion-text">${escapeHtml(s.text)}</div>
            ${
              s.file
                ? `<div class="suggestion-file">${escapeHtml(s.file)}</div>`
                : ""
            }
          </div>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

function renderDiff(group: ChangeGroup): string {
  const fileGroups = new Map<string, typeof group.hunks>();

  for (const { file, hunk } of group.hunks) {
    if (!fileGroups.has(file)) fileGroups.set(file, []);
    fileGroups.get(file)!.push({ file, hunk });
  }

  let html = "";

  for (const [file, hunks] of fileGroups) {
    const status = getFileStatus(file, hunks);

    html += `
      <div class="diff-file">
        <div class="diff-file-header">
          <span class="status ${status}">${status}</span>
          <span class="diff-file-name">${escapeHtml(file)}</span>
          <div class="diff-mode-toggle">
            <button class="diff-mode-btn" data-mode="side-by-side" onclick="setDiffMode('side-by-side')">
              Side-by-side
            </button>
            <button class="diff-mode-btn" data-mode="integrated" onclick="setDiffMode('integrated')">
              Integrated
            </button>
          </div>
        </div>
        <div class="diff-content diff-content-side-by-side">
          ${renderSideBySideDiff(hunks)}
        </div>
        <div class="diff-content diff-content-integrated">
          ${renderIntegratedDiff(hunks)}
        </div>
      </div>
    `;
  }

  return html || '<div class="empty-state">No diff content available</div>';
}

function renderIntegratedDiff(
  hunks: Array<{ file: string; hunk: any }>
): string {
  let html = "";

  for (const { hunk } of hunks) {
    html += `
        <div class="diff-line hunk-header">
          <span class="line-number"></span>
          <span class="line-content">@@ -${hunk.oldStart},${hunk.oldLines} +${
      hunk.newStart
    },${hunk.newLines} @@ ${escapeHtml(hunk.header)}</span>
        </div>
      `;

    const lines = hunk.content.split("\n");
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;

    for (const line of lines) {
      if (!line) continue;

      const firstChar = line[0];
      const content = line.slice(1);
      let lineClass = "";
      let lineNum = "";
      let marker = "";

      if (firstChar === "+") {
        lineClass = "addition";
        lineNum = String(newLine++);
        marker = '<span class="addition-marker">+</span>';
      } else if (firstChar === "-") {
        lineClass = "deletion";
        lineNum = String(oldLine++);
        marker = '<span class="deletion-marker">-</span>';
      } else {
        lineNum = String(oldLine++);
        newLine++;
        marker = " ";
      }

      html += `
          <div class="diff-line ${lineClass}">
            <span class="line-number">${lineNum}</span>
            <span class="line-content">${marker}${escapeHtml(content)}</span>
          </div>
        `;
    }
  }

  return html || '<div class="empty-state">No diff content available</div>';
}

function renderSideBySideDiff(
  hunks: Array<{ file: string; hunk: any }>
): string {
  let html = "";

  for (const { hunk } of hunks) {
    html += `
        <div class="diff-hunk-header">@@ -${hunk.oldStart},${hunk.oldLines} +${
      hunk.newStart
    },${hunk.newLines} @@ ${escapeHtml(hunk.header)}</div>
      `;

    const lines = hunk.content.split("\n");
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;

    for (const line of lines) {
      if (!line) continue;

      const firstChar = line[0];
      const content = line.slice(1);
      let lineClass = "";
      let oldLineNum = "";
      let newLineNum = "";
      let oldMarker = "";
      let newMarker = "";
      let oldContent = "";
      let newContent = "";

      if (firstChar === "+") {
        lineClass = "addition";
        newLineNum = String(newLine++);
        newMarker = '<span class="addition-marker">+</span>';
        newContent = content;
      } else if (firstChar === "-") {
        lineClass = "deletion";
        oldLineNum = String(oldLine++);
        oldMarker = '<span class="deletion-marker">-</span>';
        oldContent = content;
      } else {
        oldLineNum = String(oldLine++);
        newLineNum = String(newLine++);
        oldMarker = " ";
        newMarker = " ";
        oldContent = content;
        newContent = content;
      }

      html += `
          <div class="diff-row ${lineClass}">
            <span class="line-number old">${oldLineNum}</span>
            <span class="line-content old">${oldMarker}${escapeHtml(
        oldContent
      )}</span>
            <span class="line-number new">${newLineNum}</span>
            <span class="line-content new">${newMarker}${escapeHtml(
        newContent
      )}</span>
          </div>
        `;
    }
  }

  return html || '<div class="empty-state">No diff content available</div>';
}

function getFileStatus(
  file: string,
  hunks: Array<{ file: string; hunk: any }>
): string {
  const content = hunks.map((h) => h.hunk.content).join("\n");
  const additions = (content.match(/^\+/gm) || []).length;
  const deletions = (content.match(/^-/gm) || []).length;

  if (deletions === 0) return "added";
  if (additions === 0) return "removed";
  return "modified";
}

function getRelevantQuestions(
  group: ChangeGroup,
  analysis: Analysis
): ReviewQuestion[] {
  // Use changeset-level questions stored on the group, not the global analysis questions
  const questions = group.reviewQuestions ?? [];

  // Structural change types (types, docs, config) don't have runtime behavior
  // so questions about failure modes and error handling don't apply
  const structuralTypes = ["types", "docs", "config"];
  const isStructural = structuralTypes.includes(group.changeType);

  if (group.changeType === "test") {
    return questions.filter((q) => ["input-domain"].includes(q.id));
  }

  if (isStructural) {
    // For structural changes, focus on design and compatibility questions
    return questions
      .filter((q) =>
        ["abstractions", "duplication", "compatibility"].includes(q.id)
      )
      .slice(0, 3);
  }

  // For functional changes (feature, bugfix, refactor, unknown)
  const relevant = ["failure-modes", "input-domain", "error-handling"];

  if (group.symbolsIntroduced?.length) {
    relevant.push("abstractions");
  }

  return questions.filter((q) => relevant.includes(q.id)).slice(0, 4);
}

function renderGenerationMeta(analysis: Analysis): string {
  const hasMetadata =
    analysis.generationTimeMs || analysis.tokenCount || analysis.costUsd;
  if (!hasMetadata) return "";

  const formatTime = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatTokens = (count: number): string => {
    if (count < 1000) return String(count);
    return `${(count / 1000).toFixed(1)}k`;
  };

  const formatCost = (usd: number): string => {
    if (usd < 0.01) return `$${(usd * 100).toFixed(2)}¢`;
    return `$${usd.toFixed(2)}`;
  };

  return `
    <div class="generation-meta">
      ${
        analysis.generationTimeMs
          ? `
        <div class="generation-meta-item">
          <span>⏱</span>
          <span class="generation-meta-value">${formatTime(
            analysis.generationTimeMs
          )}</span>
        </div>
      `
          : ""
      }
      ${
        analysis.tokenCount
          ? `
        <div class="generation-meta-item">
          <span>◈</span>
          <span class="generation-meta-value">${formatTokens(
            analysis.tokenCount
          )}</span>
          <span>tokens</span>
        </div>
      `
          : ""
      }
      ${
        analysis.costUsd
          ? `
        <div class="generation-meta-item">
          <span>$</span>
          <span class="generation-meta-value">${formatCost(
            analysis.costUsd
          )}</span>
        </div>
      `
          : ""
      }
    </div>
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
