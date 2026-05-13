import {
  escapeHtml,
  fetchJson,
  formatNumber,
  formatTimestamp,
  renderLineChart,
  runOptionLabel,
  setStatus,
} from '../utils.js';

const DEFAULT_VISIBLE_ROWS = 15;

function renderLeaderboardRows(rows, selectedPrim, expanded) {
  const visibleRows = expanded ? rows : rows.slice(0, DEFAULT_VISIBLE_ROWS);

  if (!visibleRows.length) {
    return '<p class="muted">No primitive performance rows are available.</p>';
  }

  const body = visibleRows.map((row) => `
    <tr class="clickable-row ${row.prim === selectedPrim ? 'selected-row' : ''}" data-prim="${escapeHtml(row.prim)}">
      <td>${escapeHtml(row.prim)}</td>
      <td class="numeric">${formatNumber(row.rays_per_sec)}</td>
    </tr>
  `).join('');

  return `
    <table>
      <thead>
        <tr>
          <th>Primitive</th>
          <th class="numeric">Rays/sec</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function renderPrimitiveChart(series, prim) {
  if (!prim) {
    return '<div class="chart-empty">Select a primitive to view history.</div>';
  }

  const points = (series.series_by_primitive?.[prim] || [])
    .filter((point) => point.rays_per_sec != null)
    .map((point) => ({ ...point, value: point.rays_per_sec }));

  return renderLineChart([
    { label: prim, points },
  ], {
    yLabel: 'Rays/sec',
    ariaLabel: `${prim} rays per second over time`,
    emptyMessage: `No graphable rays/sec data is available for ${prim}.`,
    tooltip: (point) => [
      `Primitive: ${point.prim}`,
      `Rays/sec: ${formatNumber(point.rays_per_sec)}`,
      `Commit: ${point.short_commit || point.commit || 'unknown'}`,
      `Timestamp: ${point.timestamp || 'unknown'}`,
      `Status: ${point.status || 'unknown'}`,
    ].join('\n'),
    href: (point) => point.summary_path || '#',
  });
}

export async function initRtcmpPrimsSection() {
  const [runs, series] = await Promise.all([
    fetchJson('data/rtcmp_prims/runs.json'),
    fetchJson('data/rtcmp_prims/series.json'),
  ]);

  const statusEl = document.getElementById('rtcmp-prims-status');
  const messageEl = document.getElementById('rtcmp-prims-message');
  const runSelectEl = document.getElementById('rtcmp-prims-run-select');
  const countEl = document.getElementById('rtcmp-prims-count');
  const tableEl = document.getElementById('rtcmp-prims-table');
  const toggleEl = document.getElementById('rtcmp-prims-toggle');
  const chartTitleEl = document.getElementById('rtcmp-prims-chart-title');
  const chartEl = document.getElementById('rtcmp-prims-chart');

  const snapshots = runs.snapshots || [];
  let expanded = false;
  let selectedPrim = '';

  runSelectEl.innerHTML = snapshots.length
    ? snapshots.map((snapshot, index) => `
        <option value="${index}">${escapeHtml(runOptionLabel(snapshot.run, snapshot.status))}</option>
      `).join('')
    : '<option value="">No primitive datasets available</option>';
  runSelectEl.disabled = snapshots.length === 0;

  function selectedSnapshot() {
    return snapshots[Number(runSelectEl.value)] || snapshots[0] || null;
  }

  function render() {
    const snapshot = selectedSnapshot();

    if (!snapshot) {
      setStatus(statusEl, 'UNKNOWN');
      messageEl.textContent = 'No primitive performance data has been ingested yet.';
      tableEl.innerHTML = '<p class="muted">No primitive rows available.</p>';
      chartEl.innerHTML = renderPrimitiveChart(series, selectedPrim);
      toggleEl.hidden = true;
      return;
    }

    const rows = snapshot.rows || [];
    if (!selectedPrim && rows.length) {
      selectedPrim = rows.find((row) => row.rays_per_sec != null)?.prim || rows[0].prim;
    }

    setStatus(statusEl, snapshot.status || 'UNKNOWN');
    const summary = snapshot.summary || {};
    messageEl.classList.toggle('warn', snapshot.status !== 'PASS');
    messageEl.innerHTML = `
      Showing ${formatNumber(summary.passing || 0)} passing and ${formatNumber(summary.failing || 0)} failing primitive rows from
      <code>${escapeHtml(snapshot.run?.id || 'unknown run')}</code> · ${escapeHtml(formatTimestamp(snapshot.run?.timestamp))}.
    `;

    countEl.textContent = expanded
      ? `Showing all ${rows.length} primitives.`
      : `Showing top ${Math.min(DEFAULT_VISIBLE_ROWS, rows.length)} of ${rows.length} primitives.`;

    tableEl.classList.toggle('collapsed', !expanded);
    tableEl.innerHTML = renderLeaderboardRows(rows, selectedPrim, expanded);
    toggleEl.hidden = rows.length <= DEFAULT_VISIBLE_ROWS;
    toggleEl.textContent = expanded ? 'Collapse' : 'Show all';

    chartTitleEl.textContent = selectedPrim ? `${selectedPrim} rays/sec over time` : 'Primitive trend';
    chartEl.innerHTML = renderPrimitiveChart(series, selectedPrim);
  }

  runSelectEl.addEventListener('change', () => {
    const rows = selectedSnapshot()?.rows || [];
    if (!rows.some((row) => row.prim === selectedPrim)) {
      selectedPrim = rows.find((row) => row.rays_per_sec != null)?.prim || rows[0]?.prim || '';
    }
    render();
  });

  toggleEl.addEventListener('click', () => {
    expanded = !expanded;
    render();
  });

  tableEl.addEventListener('click', (event) => {
    const row = event.target.closest('tr[data-prim]');
    if (!row) {
      return;
    }

    selectedPrim = row.dataset.prim;
    render();
  });

  render();
}
