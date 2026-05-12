import { initBenchmarkSection } from './benchmark.js';
import { escapeHtml, fetchJson, fmt, formatTimestamp, statusClass } from './utils.js';

function renderLatestRun(latest) {
  const el = document.getElementById('latest-run');
  const globalStatus = document.getElementById('global-status');

  if (!latest) {
    globalStatus.textContent = 'No runs';
    el.innerHTML = '<h2>Latest run</h2><p>Waiting for the first <code>summary.json</code> package.</p>';
    return;
  }

  globalStatus.innerHTML = `<span class="${statusClass(latest.status)}">${escapeHtml(latest.status)}</span>`;

  const lanes = Object.entries(latest.lanes || {})
    .map(([name, status]) => `<li><code>${escapeHtml(name)}</code>: <strong class="${statusClass(status)}">${escapeHtml(status)}</strong></li>`)
    .join('');

  el.innerHTML = `
    <h2>Latest run</h2>
    <p><strong class="${statusClass(latest.status)}">${escapeHtml(latest.status)}</strong> — <code>${escapeHtml(latest.id)}</code></p>
    <p>Timestamp: <code>${formatTimestamp(latest.timestamp)}</code></p>
    <p>Commit: <code>${escapeHtml(latest.short_commit || latest.commit)}</code></p>
    <p>Summary: <code>${escapeHtml(latest.path)}</code></p>
    <ul>${lanes}</ul>
  `;
}

function renderRunsTable(runs) {
  const rows = runs.slice(-25).reverse().map((run) => `
    <tr>
      <td><code>${escapeHtml(run.id)}</code></td>
      <td>${formatTimestamp(run.timestamp)}</td>
      <td><strong class="${statusClass(run.status)}">${escapeHtml(run.status)}</strong></td>
      <td><code>${escapeHtml(run.short_commit || run.commit)}</code></td>
    </tr>
  `).join('');

  document.getElementById('runs-table').innerHTML = rows
    ? `<table><thead><tr><th>Run</th><th>Timestamp</th><th>Status</th><th>Commit</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p>No runs indexed yet.</p>';
}

async function loadDashboard() {
  const index = await fetchJson('data/index.json');
  const runs = index.runs || [];
  const latest = runs[runs.length - 1];

  renderLatestRun(latest);
  renderRunsTable(runs);
  await initBenchmarkSection();
}

loadDashboard().catch((error) => {
  document.getElementById('global-status').textContent = 'Load failed';
  document.getElementById('latest-run').innerHTML = `<h2>Dashboard load failed</h2><p>${escapeHtml(error.message)}</p>`;
  document.getElementById('runs-table').innerHTML = `<p>${escapeHtml(fmt(error.message))}</p>`;
  console.error(error);
});
