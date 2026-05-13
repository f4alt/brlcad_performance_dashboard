import {
  escapeHtml,
  fetchJson,
  formatNumber,
  formatPercent,
  formatTimestamp,
  runOptionLabel,
  setStatus,
} from '../utils.js';

function chip(label, value, extraClass = '') {
  return `<span class="chip ${extraClass}"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</span>`;
}

function renderChips(summary) {
  return [
    chip('Rows', formatNumber(summary.row_count || 0)),
    chip('Passing', formatNumber(summary.passing || 0), 'status-PASS'),
    chip('Failing', formatNumber(summary.failing || 0), (summary.failing || 0) > 0 ? 'status-FAIL' : ''),
    chip('Average delta', formatPercent(summary.average_delta_percent)),
  ].join('');
}

function headingLabel(column) {
  const labels = {
    status: 'Status',
    tag: 'Tag',
    compare_status: 'Compare',
    comp_status_tol: 'Tolerance',
    perf_status: 'Perf status',
    perf1_rays_per_sec_wall: 'Perf1 rays/sec',
    perf2_rays_per_sec_wall: 'Perf2 rays/sec',
    perf_delta_percent: 'Perf delta %',
  };

  return labels[column] || column;
}

function renderTable(snapshot) {
  const rows = snapshot.rows || [];
  if (!rows.length) {
    return '<p class="muted">No generic comparison rows are available.</p>';
  }

  const columns = snapshot.visible_columns || [
    'status',
    'tag',
    'compare_status',
    'comp_status_tol',
    'perf_status',
    'perf1_rays_per_sec_wall',
    'perf2_rays_per_sec_wall',
    'perf_delta_percent',
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
        <tr>${columns.map((column) => `<th class="${column === 'perf_delta_percent' ? 'numeric' : ''}">${escapeHtml(headingLabel(column))}</th>`).join('')}</tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

export async function initRtcmpGenericSection() {
  const runs = await fetchJson('data/rtcmp_generic/runs.json');

  const statusEl = document.getElementById('rtcmp-generic-status');
  const messageEl = document.getElementById('rtcmp-generic-message');
  const runSelectEl = document.getElementById('rtcmp-generic-run-select');
  const chipsEl = document.getElementById('rtcmp-generic-chips');
  const tableEl = document.getElementById('rtcmp-generic-table');

  const snapshots = runs.snapshots || [];

  runSelectEl.innerHTML = snapshots.length
    ? snapshots.map((snapshot, index) => `
        <option value="${index}">${escapeHtml(runOptionLabel(snapshot.run, snapshot.status))}</option>
      `).join('')
    : '<option value="">No generic datasets available</option>';
  runSelectEl.disabled = snapshots.length === 0;

  function selectedSnapshot() {
    return snapshots[Number(runSelectEl.value)] || snapshots[0] || null;
  }

  function render() {
    const snapshot = selectedSnapshot();

    if (!snapshot) {
      setStatus(statusEl, 'UNKNOWN');
      messageEl.textContent = 'No generic comparison data has been ingested yet.';
      chipsEl.innerHTML = renderChips({});
      tableEl.innerHTML = '<p class="muted">No generic comparison rows are available.</p>';
      return;
    }

    setStatus(statusEl, snapshot.status || 'UNKNOWN');

    messageEl.classList.toggle('warn', snapshot.status !== 'PASS');
    messageEl.innerHTML = snapshot.run
      ? `Generic table from <code>${escapeHtml(snapshot.run.id || 'unknown run')}</code> · ${escapeHtml(formatTimestamp(snapshot.run.timestamp))}.`
      : 'No generic comparison run metadata is available.';

    chipsEl.innerHTML = renderChips(snapshot.summary || {});
    tableEl.innerHTML = renderTable(snapshot);
  }

  runSelectEl.addEventListener('change', render);
  render();
}
