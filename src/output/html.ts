import { Analysis } from '../analysis/analyzer.js';

export function renderHTML(analysis: Analysis): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PR Review: ${escapeHtml(analysis.title || 'Untitled')}</title>
  <style>
    :root {
      --bg: #0d1117;
      --bg-secondary: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --green: #3fb950;
      --red: #f85149;
      --yellow: #d29922;
    }
    
    * {
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 0;
      line-height: 1.6;
    }
    
    .container {
      display: flex;
      min-height: 100vh;
    }
    
    .sidebar {
      width: 280px;
      background: var(--bg-secondary);
      border-right: 1px solid var(--border);
      padding: 20px;
      position: fixed;
      height: 100vh;
      overflow-y: auto;
    }
    
    .main {
      margin-left: 280px;
      flex: 1;
      padding: 40px;
      max-width: 900px;
    }
    
    h1, h2, h3 {
      color: var(--text);
      border-bottom: 1px solid var(--border);
      padding-bottom: 8px;
    }
    
    h1 { font-size: 1.8em; }
    h2 { font-size: 1.4em; margin-top: 2em; }
    h3 { font-size: 1.1em; border: none; }
    
    .nav-section {
      margin-bottom: 24px;
    }
    
    .nav-title {
      font-size: 12px;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 8px;
      font-weight: 600;
    }
    
    .nav-link {
      display: block;
      color: var(--text-muted);
      text-decoration: none;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      margin: 2px 0;
    }
    
    .nav-link:hover {
      background: var(--border);
      color: var(--text);
    }
    
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
    
    .change-group {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      margin: 16px 0;
    }
    
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
    .change-type.unknown { background: #30363d; color: #8b949e; }
    
    .file-list {
      margin: 12px 0;
    }
    
    .file-item {
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 13px;
      color: var(--text-muted);
      padding: 4px 0;
    }
    
    .question-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin: 16px 0;
      overflow: hidden;
    }
    
    .question-header {
      padding: 16px 20px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .question-header:hover {
      background: var(--border);
    }
    
    .question-content {
      padding: 0 20px 20px;
      border-top: 1px solid var(--border);
    }
    
    .question-content pre {
      background: var(--bg);
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
      font-size: 13px;
    }
    
    .contributor-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    
    .contributor-table th,
    .contributor-table td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    
    .contributor-table th {
      color: var(--text-muted);
      font-weight: 500;
    }
    
    .trace-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      margin: 16px 0;
    }
    
    .confidence-bar {
      height: 4px;
      background: var(--border);
      border-radius: 2px;
      overflow: hidden;
      margin-top: 8px;
    }
    
    .confidence-fill {
      height: 100%;
      background: var(--accent);
    }
    
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
    
    .footer {
      margin-top: 60px;
      padding-top: 20px;
      border-top: 1px solid var(--border);
      color: var(--text-muted);
      font-size: 14px;
      text-align: center;
    }
    
    .footer a {
      color: var(--accent);
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <nav class="sidebar">
      <div class="nav-section">
        <div class="nav-title">Overview</div>
        <a href="#stats" class="nav-link">Statistics</a>
        ${analysis.description ? '<a href="#description" class="nav-link">Description</a>' : ''}
      </div>
      
      <div class="nav-section">
        <div class="nav-title">Changes (${analysis.changeGroups.length})</div>
        ${analysis.changeGroups.map((g, i) => `
          <a href="#group-${i}" class="nav-link">${escapeHtml(g.title)}</a>
        `).join('')}
      </div>
      
      <div class="nav-section">
        <div class="nav-title">Review Questions</div>
        ${analysis.questions.map((q, i) => `
          <a href="#question-${i}" class="nav-link">${escapeHtml(q.question.slice(0, 40))}...</a>
        `).join('')}
      </div>
      
      <div class="nav-section">
        <div class="nav-title">Context</div>
        <a href="#reviewers" class="nav-link">Suggested Reviewers</a>
        <a href="#contributors" class="nav-link">Contributors</a>
        ${analysis.traces?.length ? '<a href="#traces" class="nav-link">LLM Traces</a>' : ''}
      </div>
    </nav>
    
    <main class="main">
      <h1>${escapeHtml(analysis.title || `${analysis.baseBranch} ← ${analysis.headBranch}`)}</h1>
      
      <p style="color: var(--text-muted)">
        ${analysis.author ? `By <strong>${escapeHtml(analysis.author)}</strong> · ` : ''}
        Analyzed ${analysis.analyzedAt.toLocaleDateString()}
        ${analysis.prUrl ? ` · <a href="${escapeHtml(analysis.prUrl)}" style="color: var(--accent)">View on GitHub</a>` : ''}
      </p>
      
      <section id="stats">
        <div class="stats">
          <div class="stat">
            <div class="stat-value">${analysis.filesChanged}</div>
            <div class="stat-label">Files</div>
          </div>
          <div class="stat">
            <div class="stat-value green">+${analysis.additions}</div>
            <div class="stat-label">Additions</div>
          </div>
          <div class="stat">
            <div class="stat-value red">-${analysis.deletions}</div>
            <div class="stat-label">Deletions</div>
          </div>
          <div class="stat">
            <div class="stat-value">${analysis.changeGroups.length}</div>
            <div class="stat-label">Change Groups</div>
          </div>
        </div>
      </section>
      
      ${analysis.description ? `
        <section id="description">
          <h2>Description</h2>
          <p>${escapeHtml(analysis.description)}</p>
        </section>
      ` : ''}
      
      <section id="changes">
        <h2>Changes</h2>
        ${analysis.changeGroups.map((group, i) => `
          <div class="change-group" id="group-${i}">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <h3 style="margin: 0; border: none;">${escapeHtml(group.title)}</h3>
              <span class="change-type ${group.changeType}">${group.changeType}</span>
            </div>
            
            ${group.description ? `<p>${escapeHtml(group.description)}</p>` : ''}
            
            <div class="file-list">
              ${group.files.map(f => `<div class="file-item">${escapeHtml(f)}</div>`).join('')}
            </div>
            
            ${group.symbolsIntroduced?.length ? `
              <div style="margin-top: 12px;">
                <strong style="font-size: 12px; color: var(--text-muted);">NEW SYMBOLS</strong>
                <div class="symbols">
                  ${group.symbolsIntroduced.map(s => `<span class="symbol">${escapeHtml(s)}</span>`).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        `).join('')}
      </section>
      
      <section id="questions">
        <h2>Review Questions</h2>
        ${analysis.questions.map((q, i) => `
          <div class="question-card" id="question-${i}">
            <div class="question-header">
              <span>${escapeHtml(q.question)}</span>
            </div>
            <div class="question-content">
              ${q.answer ? `<p>${escapeHtml(q.answer)}</p>` : ''}
              ${q.context ? `<pre>${escapeHtml(q.context)}</pre>` : '<p style="color: var(--text-muted);">Analysis pending...</p>'}
            </div>
          </div>
        `).join('')}
      </section>
      
      <section id="reviewers">
        <h2>Suggested Reviewers</h2>
        ${analysis.suggestedReviewers.length ? `
          <ul>
            ${analysis.suggestedReviewers.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
          </ul>
        ` : '<p style="color: var(--text-muted);">No suggestions available</p>'}
      </section>
      
      <section id="contributors">
        <h2>File Contributors</h2>
        ${analysis.contributors.length ? `
          <table class="contributor-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Lines</th>
                <th>Commits</th>
                <th>Last Active</th>
              </tr>
            </thead>
            <tbody>
              ${analysis.contributors.slice(0, 10).map(c => `
                <tr>
                  <td>${escapeHtml(c.name)}</td>
                  <td>${c.linesAuthored}</td>
                  <td>${c.commits}</td>
                  <td>${c.lastCommitDate.toLocaleDateString()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<p style="color: var(--text-muted);">No contributor data available</p>'}
      </section>
      
      ${analysis.traces?.length ? `
        <section id="traces">
          <h2>LLM Session Traces</h2>
          <p style="color: var(--text-muted);">The following AI coding sessions may have contributed to this PR:</p>
          ${analysis.traces.map(t => `
            <div class="trace-card">
              <div style="display: flex; justify-content: space-between;">
                <strong>${escapeHtml(t.source)} - ${escapeHtml(t.sessionId)}</strong>
                <span style="color: var(--text-muted);">${t.timestamp.toLocaleDateString()}</span>
              </div>
              <div style="margin-top: 8px;">
                <span style="color: var(--text-muted);">Confidence:</span> ${(t.confidence * 100).toFixed(0)}%
                <div class="confidence-bar">
                  <div class="confidence-fill" style="width: ${t.confidence * 100}%"></div>
                </div>
              </div>
              <div style="margin-top: 8px;">
                <span style="color: var(--text-muted);">Matched files:</span> ${t.matchedFiles.length}
              </div>
              <div style="margin-top: 8px;">
                <code style="font-size: 11px; word-break: break-all;">${escapeHtml(t.sessionPath)}</code>
              </div>
            </div>
          `).join('')}
        </section>
      ` : ''}
      
      <footer class="footer">
        Generated by <a href="https://github.com/your-username/lgtm">lgtm</a> — because "lgtm" should mean something
      </footer>
    </main>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
