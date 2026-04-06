import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { readJsonFile, fileExists, getRepoFileName, getMaxRepos } from './lib/utils';
import { Repository } from './lib/types';

dotenv.config();

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

function getRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 30) return `${diffDays} days ago`;
  if (diffDays < 60) return '1 month ago';
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function main() {
  const startTime = Date.now();
  console.log('Step 6: Generating HTML report...\n');

  const repos: Repository[] = readJsonFile('data/repos.json');
  const maxRepos = getMaxRepos();
  const reposToProcess = maxRepos ? repos.slice(0, maxRepos) : repos;

  console.log(`Generating report for ${reposToProcess.length} repositories (out of ${repos.length} total)`);
  if (maxRepos) {
    console.log(`MAX_REPOS is set to ${maxRepos}\n`);
  }

  const rows: string[] = [];
  let processed = 0;
  let skipped = 0;

  for (const repo of reposToProcess) {
    if (repo.isArchived) {
      console.log(`[${processed + skipped + 1}/${reposToProcess.length}] Skipping ${repo.fullName} - archived`);
      skipped++;
      continue;
    }

    console.log(`[${processed + skipped + 1}/${reposToProcess.length}] Processing ${repo.fullName}...`);

    const activityPath = `data/filtered/activity/${getRepoFileName(repo.organization, repo.name)}`;
    const usagePath = `data/filtered/usage/${getRepoFileName(repo.organization, repo.name)}`;

    const activity: any = fileExists(activityPath) ? readJsonFile(activityPath) : null;
    const usage: any = fileExists(usagePath) ? readJsonFile(usagePath) : null;

    const lastCommit = activity?.latestHumanActivity?.latestCommit;
    const latestIssueComment = activity?.latestHumanActivity?.latestIssueComment;
    const latestPRReview = activity?.latestHumanActivity?.latestPRReview;

    // Calculate metrics
    const sinceDate = new Date('2025-01-01T00:00:00Z');

    // Issues opened in 2025-2026 (by created_at)
    const issuesOpened = activity?.issues?.filter((i: any) =>
      new Date(i.created_at) >= sinceDate
    ).length || 0;

    // Issues closed in 2025-2026 (by closed_at)
    // Note: GitHub REST API doesn't distinguish "resolved" vs "closed as not planned"
    const issuesClosed = activity?.issues?.filter((i: any) =>
      i.closed_at && new Date(i.closed_at) >= sinceDate
    ).length || 0;

    // PRs opened in 2025-2026 (by created_at)
    const prsOpened = activity?.pullRequests?.filter((pr: any) =>
      new Date(pr.created_at) >= sinceDate
    ).length || 0;

    // PRs merged in 2025-2026 (by merged_at)
    const prsMerged = activity?.pullRequests?.filter((pr: any) =>
      pr.merged_at && new Date(pr.merged_at) >= sinceDate
    ).length || 0;

    // GitHub URLs
    const repoUrl = repo.url;
    const commitsUrl = `${repoUrl}/commits`;
    const issuesUrl = `${repoUrl}/issues`;
    const prsUrl = `${repoUrl}/pulls`;

    // GitHub search URLs for issues and PRs
    const issuesOpenedUrl = `${repoUrl}/issues?q=is:issue+created:>=2025-01-01`;
    const issuesClosedUrl = `${repoUrl}/issues?q=is:issue+closed:>=2025-01-01`;
    const prsOpenedUrl = `${repoUrl}/pulls?q=is:pr+created:>=2025-01-01`;
    const prsMergedUrl = `${repoUrl}/pulls?q=is:pr+merged:>=2025-01-01`;

    // GitHub search URLs for verification
    const commitsSearchUrl = lastCommit
      ? `${repoUrl}/commits?since=2025-01-01&until=2026-12-31`
      : null;

    const issueCommentsSearchUrl = latestIssueComment?.author
      ? `https://github.com/search?q=repo:${encodeURIComponent(repo.fullName)}+is:issue+commenter:${encodeURIComponent(latestIssueComment.author)}&type=issues`
      : null;

    const prReviewsSearchUrl = latestPRReview?.author
      ? `https://github.com/search?q=repo:${encodeURIComponent(repo.fullName)}+is:pr+reviewed-by:${encodeURIComponent(latestPRReview.author)}&type=pullrequests`
      : null;

    const lastCommitUrl = lastCommit?.sha ? `${repoUrl}/commit/${lastCommit.sha}` : null;
    const lastIssueCommentUrl = latestIssueComment?.htmlUrl || null;
    const lastPRReviewUrl = latestPRReview?.htmlUrl || null;

    // Latest release information
    const latestRelease = activity?.releases?.[0] || null;
    const releaseUrl = latestRelease?.html_url || null;
    const releaseName = latestRelease?.name || latestRelease?.tag_name || null;
    const releaseDate = latestRelease?.published_at || latestRelease?.created_at || null;
    const releasesUrl = `${repoUrl}/releases`;

    rows.push(`
      <tr data-repo="${escapeHtml(repo.fullName)}">
        <td>
          <div class="mark-buttons">
            <button class="mark-btn mark-btn-green" onclick="markRepo('${escapeHtml(repo.fullName)}', 'green')" title="Mark as green">✓</button>
            <button class="mark-btn mark-btn-red" onclick="markRepo('${escapeHtml(repo.fullName)}', 'red')" title="Mark as red">✗</button>
            <button class="mark-btn mark-btn-clear" onclick="markRepo('${escapeHtml(repo.fullName)}', null)" title="Clear mark">○</button>
          </div>
        </td>
        <td><a href="${repoUrl}" target="_blank">${escapeHtml(repo.name)}</a></td>
        <td>${escapeHtml(repo.organization)}</td>
        <td>${usage?.stars || 0}</td>
        <td>${usage?.forks || 0}</td>
        <td><a href="${issuesOpenedUrl}" target="_blank">${issuesOpened}</a></td>
        <td><a href="${issuesClosedUrl}" target="_blank">${issuesClosed}</a></td>
        <td><a href="${prsOpenedUrl}" target="_blank">${prsOpened}</a></td>
        <td><a href="${prsMergedUrl}" target="_blank">${prsMerged}</a></td>
        <td>
          ${lastCommit ? `
            <a href="${lastCommitUrl}" target="_blank" title="${escapeHtml(lastCommit.sha)}">${formatDate(lastCommit.date)}</a>
            <br>
            <small>by <a href="https://github.com/${encodeURIComponent(lastCommit.author)}" target="_blank"><strong>${escapeHtml(lastCommit.author)}</strong></a></small>
            <br>
            <small>${getRelativeTime(lastCommit.date)}</small>
            ${commitsSearchUrl ? `<br><a href="${commitsSearchUrl}" target="_blank" class="verify-link">🔍 Verify</a>` : ''}
          ` : 'N/A'}
        </td>
        <td>
          ${latestIssueComment ? `
            <a href="${lastIssueCommentUrl}" target="_blank">${formatDate(latestIssueComment.date)}</a>
            <br>
            <small>by <a href="https://github.com/${encodeURIComponent(latestIssueComment.author)}" target="_blank"><strong>${escapeHtml(latestIssueComment.author)}</strong></a></small>
            <br>
            <small>${getRelativeTime(latestIssueComment.date)}</small>
            ${issueCommentsSearchUrl ? `<br><a href="${issueCommentsSearchUrl}" target="_blank" class="verify-link">🔍 Verify</a>` : ''}
          ` : 'N/A'}
        </td>
        <td>
          ${latestPRReview ? `
            <a href="${lastPRReviewUrl}" target="_blank">${formatDate(latestPRReview.date)}</a>
            <br>
            <small>by <a href="https://github.com/${encodeURIComponent(latestPRReview.author)}" target="_blank"><strong>${escapeHtml(latestPRReview.author)}</strong></a></small>
            <br>
            <small>${getRelativeTime(latestPRReview.date)}</small>
            ${prReviewsSearchUrl ? `<br><a href="${prReviewsSearchUrl}" target="_blank" class="verify-link">🔍 Verify</a>` : ''}
          ` : 'N/A'}
        </td>
        <td>
          ${latestRelease ? `
            <a href="${releaseUrl}" target="_blank"><strong>${escapeHtml(releaseName)}</strong></a>
            <br>
            <small>${formatDate(releaseDate)}</small>
            <br>
            <small>${getRelativeTime(releaseDate)}</small>
            <br><a href="${releasesUrl}" target="_blank" class="verify-link">🔍 All Releases</a>
          ` : 'N/A'}
        </td>
        <td>
          <a href="${commitsUrl}" target="_blank">Commits</a> |
          <a href="${issuesUrl}" target="_blank">Issues</a> |
          <a href="${prsUrl}" target="_blank">PRs</a>
        </td>
      </tr>
    `);

    processed++;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Knative Repository Health Report</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: #24292e;
      background: #f6f8fa;
      padding: 20px;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      background: white;
      border-radius: 6px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.12);
      overflow: hidden;
    }

    header {
      background: #24292e;
      color: white;
      padding: 15px 30px;
      border-bottom: 3px solid #0366d6;
    }

    h1 {
      font-size: 20px;
      margin-bottom: 5px;
    }

    .meta {
      color: #959da5;
      font-size: 12px;
    }

    .stats {
      display: flex;
      gap: 20px;
      padding: 10px 30px;
      background: #f6f8fa;
      border-bottom: 1px solid #e1e4e8;
      flex-wrap: wrap;
    }

    .stat {
      text-align: center;
    }

    .stat-value {
      font-size: 20px;
      font-weight: bold;
      color: #0366d6;
    }

    .stat-label {
      font-size: 10px;
      color: #586069;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .table-container {
      overflow-x: auto;
      overflow-y: auto;
      max-height: calc(100vh - 200px);
      padding: 0;
      position: relative;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th {
      background: #f6f8fa;
      padding: 12px 16px;
      text-align: left;
      font-weight: 600;
      font-size: 12px;
      color: #24292e;
      border-bottom: 2px solid #e1e4e8;
      border-right: 1px solid #e1e4e8;
      position: sticky;
      top: 0;
      z-index: 10;
    }

    th:last-child {
      border-right: none;
    }

    td {
      padding: 12px 16px;
      border-bottom: 1px solid #e1e4e8;
      border-right: 1px solid #e1e4e8;
      font-size: 13px;
      vertical-align: top;
    }

    td:last-child {
      border-right: none;
    }

    tr:hover {
      background: #f6f8fa;
    }

    a {
      color: #0366d6;
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    .verify-link {
      font-size: 11px;
      color: #6a737d;
    }

    small {
      color: #586069;
      font-size: 11px;
    }

    strong {
      color: #24292e;
    }

    footer {
      padding: 10px 30px;
      text-align: center;
      color: #586069;
      font-size: 11px;
      border-top: 1px solid #e1e4e8;
      background: #f6f8fa;
    }

    .note {
      background: #d1ecf1;
      border-left: 4px solid #0c5460;
      margin: 10px 30px;
      font-size: 12px;
      color: #0c5460;
      line-height: 1.5;
    }

    .note-header {
      padding: 10px 30px;
      cursor: pointer;
      user-select: none;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .note-header:hover {
      background: #c1dce1;
    }

    .note-toggle {
      font-size: 14px;
      transition: transform 0.2s;
    }

    .note-toggle.collapsed {
      transform: rotate(-90deg);
    }

    .note-content {
      padding: 0 30px 10px 30px;
      display: none;
    }

    .note-content.expanded {
      display: block;
    }

    .note strong {
      font-size: 13px;
      display: block;
      margin-bottom: 4px;
    }

    .badge {
      display: inline-block;
      background: #28a745;
      color: white;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      margin-left: 5px;
      vertical-align: middle;
    }

    .controls {
      padding: 10px 30px;
      background: #fff;
      border-bottom: 1px solid #e1e4e8;
      display: flex;
      gap: 20px;
      align-items: center;
      flex-wrap: wrap;
    }

    .control-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .control-group label {
      font-size: 13px;
      cursor: pointer;
      user-select: none;
    }

    .control-group input[type="checkbox"] {
      cursor: pointer;
    }

    .counters {
      display: flex;
      gap: 15px;
      margin-left: auto;
      font-size: 12px;
      color: #586069;
    }

    .counter {
      padding: 4px 8px;
      background: #f6f8fa;
      border-radius: 3px;
      border: 1px solid #e1e4e8;
    }

    .counter-value {
      font-weight: bold;
      color: #24292e;
    }

    .mark-buttons {
      display: flex;
      gap: 5px;
    }

    .mark-btn {
      padding: 3px 8px;
      font-size: 11px;
      border: 1px solid #e1e4e8;
      border-radius: 3px;
      background: white;
      cursor: pointer;
      transition: all 0.2s;
    }

    .mark-btn:hover {
      background: #f6f8fa;
    }

    .mark-btn-green {
      color: #28a745;
      border-color: #28a745;
    }

    .mark-btn-green.active {
      background: #28a745;
      color: white;
    }

    .mark-btn-red {
      color: #dc3545;
      border-color: #dc3545;
    }

    .mark-btn-red.active {
      background: #dc3545;
      color: white;
    }

    .mark-btn-clear {
      color: #6a737d;
    }

    tr.marked-green {
      background: #f0fff4 !important;
    }

    tr.marked-red {
      background: #fff5f5 !important;
    }

    tr.hidden {
      display: none;
    }
  </style>
  <script>
    // Generate unique ID for this dataset (based on generation time)
    const DATASET_ID = '${new Date().toISOString()}';
    const STORAGE_KEY = 'repo-marks-' + DATASET_ID;

    function toggleNote() {
      const content = document.getElementById('note-content');
      const toggle = document.getElementById('note-toggle');

      if (content.classList.contains('expanded')) {
        content.classList.remove('expanded');
        toggle.classList.add('collapsed');
      } else {
        content.classList.add('expanded');
        toggle.classList.remove('collapsed');
      }
    }

    function loadMarks() {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    }

    function saveMarks(marks) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(marks));
    }

    function markRepo(repoName, color) {
      const marks = loadMarks();
      if (color) {
        marks[repoName] = color;
      } else {
        delete marks[repoName];
      }
      saveMarks(marks);
      applyMarks();
      applyFilters();
    }

    function applyMarks() {
      const marks = loadMarks();
      const rows = document.querySelectorAll('tbody tr');

      rows.forEach(row => {
        const repoName = row.getAttribute('data-repo');
        const mark = marks[repoName];

        // Remove existing classes
        row.classList.remove('marked-green', 'marked-red');

        // Apply mark
        if (mark === 'green') {
          row.classList.add('marked-green');
        } else if (mark === 'red') {
          row.classList.add('marked-red');
        }

        // Update buttons
        const greenBtn = row.querySelector('.mark-btn-green');
        const redBtn = row.querySelector('.mark-btn-red');

        greenBtn.classList.toggle('active', mark === 'green');
        redBtn.classList.toggle('active', mark === 'red');
      });
    }

    function applyFilters() {
      const hideRed = document.getElementById('hide-red').checked;
      const hideGreen = document.getElementById('hide-green').checked;
      const marks = loadMarks();
      const rows = document.querySelectorAll('tbody tr');

      rows.forEach(row => {
        const repoName = row.getAttribute('data-repo');
        const mark = marks[repoName];

        let shouldHide = false;
        if (hideRed && mark === 'red') shouldHide = true;
        if (hideGreen && mark === 'green') shouldHide = true;

        row.classList.toggle('hidden', shouldHide);
      });

      updateCounters();
    }

    function updateCounters() {
      const marks = loadMarks();
      const rows = document.querySelectorAll('tbody tr');

      let totalRepos = rows.length;
      let markedGreen = 0;
      let markedRed = 0;
      let unmarked = 0;
      let shown = 0;
      let hidden = 0;

      rows.forEach(row => {
        const repoName = row.getAttribute('data-repo');
        const mark = marks[repoName];
        const isHidden = row.classList.contains('hidden');

        if (mark === 'green') markedGreen++;
        else if (mark === 'red') markedRed++;
        else unmarked++;

        if (isHidden) hidden++;
        else shown++;
      });

      document.getElementById('counter-total').textContent = totalRepos;
      document.getElementById('counter-shown').textContent = shown;
      document.getElementById('counter-hidden').textContent = hidden;
      document.getElementById('counter-green').textContent = markedGreen;
      document.getElementById('counter-red').textContent = markedRed;
      document.getElementById('counter-unmarked').textContent = unmarked;
    }

    // Initialize on page load
    document.addEventListener('DOMContentLoaded', function() {
      // Set default filter states
      document.getElementById('hide-red').checked = true;
      document.getElementById('hide-green').checked = false;

      applyMarks();
      applyFilters();

      // Add event listeners
      document.getElementById('hide-red').addEventListener('change', applyFilters);
      document.getElementById('hide-green').addEventListener('change', applyFilters);
    });
  </script>
</head>
<body>
  <div class="container">
    <header>
      <h1>🔍 Knative Repository Health Report</h1>
      <div class="meta">
        Generated: ${new Date().toISOString().replace('T', ' ').split('.')[0]} UTC
        ${maxRepos ? ` | Limited to ${maxRepos} repositories` : ''}
        <br>
        🤖 Bot Filtering: ON | 📅 Time Range: 2025-2026
      </div>
    </header>

    <div class="stats">
      <div class="stat">
        <div class="stat-value">${processed}</div>
        <div class="stat-label">Active Repositories</div>
      </div>
      <div class="stat">
        <div class="stat-value">${skipped}</div>
        <div class="stat-label">Archived (Skipped)</div>
      </div>
      <div class="stat">
        <div class="stat-value">${repos.length}</div>
        <div class="stat-label">Total Repositories</div>
      </div>
    </div>

    <div class="note">
      <div class="note-header" onclick="toggleNote()">
        <span id="note-toggle" class="note-toggle collapsed">▼</span>
        <strong>ℹ️ Report Information (click to expand)</strong>
      </div>
      <div id="note-content" class="note-content">
        <strong>🤖 Bot Filtering Active</strong>
        All activity metrics (commits, issues, PRs, comments, reviews) exclude bot accounts as configured in <code>config/bots.json</code>.
        <br>
        📅 <strong>Time Range:</strong> Data is limited to 2025-2026 only (since 2025-01-01).
        <br>
        ✅ <strong>Issues Closed:</strong> Shows issues closed in 2025-2026. Note: GitHub's REST API doesn't distinguish between "resolved" and "closed as not planned" - all closed issues are counted.
        <br>
        🔍 Click "🔍 Verify" links to open GitHub search and confirm the data shown is correct.
      </div>
    </div>

    <div class="controls">
      <div class="control-group">
        <input type="checkbox" id="hide-red">
        <label for="hide-red">Hide Red</label>
      </div>
      <div class="control-group">
        <input type="checkbox" id="hide-green">
        <label for="hide-green">Hide Green</label>
      </div>
      <div class="counters">
        <span class="counter">Total: <span class="counter-value" id="counter-total">0</span></span>
        <span class="counter">Shown: <span class="counter-value" id="counter-shown">0</span></span>
        <span class="counter">Hidden: <span class="counter-value" id="counter-hidden">0</span></span>
        <span class="counter" style="color: #28a745;">Green: <span class="counter-value" id="counter-green">0</span></span>
        <span class="counter" style="color: #dc3545;">Red: <span class="counter-value" id="counter-red">0</span></span>
        <span class="counter">Unmarked: <span class="counter-value" id="counter-unmarked">0</span></span>
      </div>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Mark</th>
            <th>Repository</th>
            <th>Organization</th>
            <th>⭐ Stars</th>
            <th>🔱 Forks</th>
            <th>📋 Issues Opened<br><small>(2025-2026, no bots)</small></th>
            <th>✅ Issues Closed<br><small>(2025-2026, no bots)</small></th>
            <th>🔀 PRs Opened<br><small>(2025-2026, no bots)</small></th>
            <th>✔️ PRs Merged<br><small>(2025-2026, no bots)</small></th>
            <th>💬 Last Commit<br><small>(Humans only)</small></th>
            <th>💭 Last Issue Comment<br><small>(Humans only)</small></th>
            <th>👁️ Last PR Review<br><small>(Humans only)</small></th>
            <th>📦 Latest Release</th>
            <th>🔗 Quick Links</th>
          </tr>
        </thead>
        <tbody>
          ${rows.join('\n')}
        </tbody>
      </table>
    </div>

    <footer>
      <p>Generated by Knative Repository Status Tool</p>
      <p>Data source: GitHub API | Time range: 2025-2026</p>
    </footer>
  </div>
</body>
</html>`;

  // Write HTML files
  const outputPath = 'data/report.html';
  const docsPath = 'docs/index.html';

  fs.writeFileSync(outputPath, html, 'utf-8');

  // Copy to docs folder for GitHub Pages
  if (!fs.existsSync('docs')) {
    fs.mkdirSync('docs', { recursive: true });
  }
  fs.writeFileSync(docsPath, html, 'utf-8');

  // Create .nojekyll file to disable Jekyll processing
  fs.writeFileSync('docs/.nojekyll', '', 'utf-8');

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n✓ Generated report for ${processed} repositories`);
  console.log(`✓ Skipped: ${skipped}`);
  console.log(`✓ Saved to ${outputPath}`);
  console.log(`✓ Copied to ${docsPath} for GitHub Pages`);
  console.log(`✓ Completed in ${duration}s`);
  console.log(`\nOpen the report: open ${outputPath}`);
}

main().catch(console.error);
