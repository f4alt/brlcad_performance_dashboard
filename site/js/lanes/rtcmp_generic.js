import {
  checkSchemaVersion,
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

export async function init() {
  const latest = await fetchJson('data/rtcmp_generic/latest.json');
  checkSchemaVersion(latest, 'rtcmp_generic/latest.json');

  const statusEl = document.getElementById('rtcmp_generic-status');
  const messageEl = document.getElementById('rtcmp_generic-message');
  const runSelectEl = document.getElementById('rtcmp_generic-run-select');
  const chipsEl = document.getElementById('rtcmp_generic-chips');
  const tableEl = document.getElementById('rtcmp_generic-table');

  const runs = latest.runs || [];

  // Seed the cache with the latest snapshot embedded in latest.json.
  const detailCache = new Map();
  if (latest.source_run?.id) {
    detailCache.set(latest.source_run.id, {
      run: latest.source_run,
      status: latest.status,
      columns: latest.columns || [],
      visible_columns: latest.visible_columns,
      summary: latest.summary || {},
      rows: latest.rows || [],
    });
  }

  runSelectEl.innerHTML = runs.length
    ? runs.map((run) => `
        <option value="${escapeHtml(run.id)}">${escapeHtml(runOptionLabel(run, run.status))}</option>
      `).join('')
    : '<option value="">No generic datasets available</option>';
  runSelectEl.disabled = runs.length === 0;

  function selectedRun() {
    return runs.find((run) => run.id === runSelectEl.value) || runs[0] || null;
  }

  async function getSnapshot(run) {
    if (!run) {
      return null;
    }
    if (detailCache.has(run.id)) {
      return detailCache.get(run.id);
    }
    const detail = await fetchJson(`data/rtcmp_generic/runs/${run.detail}`, { cache: 'default' });
    detailCache.set(run.id, detail);
    return detail;
  }

  async function render() {
    const run = selectedRun();

    if (!run) {
      setStatus(statusEl, 'UNKNOWN');
      messageEl.classList.remove('fail');
      messageEl.textContent = 'No generic comparison data has been ingested yet.';
      chipsEl.innerHTML = renderChips({});
      tableEl.innerHTML = '<p class="muted">No generic comparison rows are available.</p>';
      return;
    }

    let snapshot;
    try {
      snapshot = await getSnapshot(run);
    } catch (error) {
      messageEl.classList.add('fail');
      messageEl.textContent = `Failed to load run ${run.id}: ${error.message}`;
      return;
    }

    setStatus(statusEl, snapshot?.status || 'UNKNOWN');
    messageEl.classList.remove('fail');
    messageEl.classList.toggle('warn', snapshot?.status !== 'PASS');
    messageEl.innerHTML = `Generic table from <code>${escapeHtml(run.id || 'unknown run')}</code> · ${escapeHtml(formatTimestamp(run.timestamp))}.`;

    chipsEl.innerHTML = renderChips(snapshot?.summary || {});
    tableEl.innerHTML = renderTable(snapshot || {});
  }

  runSelectEl.addEventListener('change', render);
  await render();
}
