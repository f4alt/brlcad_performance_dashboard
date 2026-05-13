import { escapeHtml, fetchJson, formatNumber, formatPercent, formatTimestamp, setStatus } from '../utils.js';

function chip(label, value, extraClass = '') {
  return `<span class="chip ${extraClass}"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</span>`;
}

function renderChips(summary) {
  const worst = summary.worst_regression;
  const best = summary.best_improvement;

  return [
    chip('Rows', formatNumber(summary.row_count || 0)),
    chip('Passing', formatNumber(summary.passing || 0), 'status-PASS'),
    chip('Failing', formatNumber(summary.failing || 0), (summary.failing || 0) > 0 ? 'status-FAIL' : ''),
    chip('Average delta', formatPercent(summary.average_delta_percent)),
    chip('Worst regression', worst ? `${worst.tag || 'unknown'} ${formatPercent(worst.perf_delta_percent)}` : '—'),
    chip('Best improvement', best ? `${best.tag || 'unknown'} ${formatPercent(best.perf_delta_percent)}` : '—'),
  ].join('');
}

function renderTable(latest) {
  const rows = latest.rows || [];
  if (!rows.length) {
    return '<p class="muted">No generic comparison rows are available.</p>';
  }

  const columns = latest.visible_columns || [
    'status',
    'tag',
    'compare_status',
    'comp_status_tol',
    'perf_delta_percent',
    'perf_status',
    'perf1_rays_per_sec_wall',
    'perf2_rays_per_sec_wall',
  ];

  const body = rows.map((row) => `
    <tr>
      ${columns.map((column) => {
        const value = row[column];
        const isNumeric = typeof value === 'number';
        const display = column === 'perf_delta_percent' ? formatPercent(value) : isNumeric ? formatNumber(value) : value;
        return `<td class="${isNumeric || column === 'perf_delta_percent' ? 'numeric' : ''}">${escapeHtml(display)}</td>`;
      }).join('')}
    </tr>
  `).join('');

  return `
    <table>
      <thead>
        <tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

export async function initRtcmpGenericSection() {
  const latest = await fetchJson('data/rtcmp_generic/latest.json');

  const statusEl = document.getElementById('rtcmp-generic-status');
  const messageEl = document.getElementById('rtcmp-generic-message');
  const chipsEl = document.getElementById('rtcmp-generic-chips');
  const tableEl = document.getElementById('rtcmp-generic-table');

  setStatus(statusEl, latest.status || 'UNKNOWN');

  const sourceRun = latest.source_run || null;
  messageEl.classList.toggle('warn', latest.status !== 'PASS');
  messageEl.innerHTML = sourceRun
    ? `Latest generic table from <code>${escapeHtml(sourceRun.id)}</code> · ${escapeHtml(formatTimestamp(sourceRun.timestamp))}.`
    : 'No generic comparison data has been ingested yet.';

  chipsEl.innerHTML = renderChips(latest.summary || {});
  tableEl.innerHTML = renderTable(latest);
}
