import {
  escapeHtml,
  fetchJson,
  formatNumber,
  formatTimestamp,
  renderLineChart,
  runOptionLabel,
  setStatus,
} from '../utils.js';

function renderLeaderboardRows(rows) {
  if (!rows.length) {
    return '<p class="muted">No primitive performance rows are available.</p>';
  }

  const body = rows.map((row) => `
    <tr class="clickable-row" data-prim="${escapeHtml(row.prim)}">
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
  const overlayEl = document.getElementById('rtcmp-prims-overlay');
  const closeEl = document.getElementById('rtcmp-prims-overlay-close');
  const chartTitleEl = document.getElementById('rtcmp-prims-chart-title');
  const chartEl = document.getElementById('rtcmp-prims-chart');

  const snapshots = runs.snapshots || [];

  runSelectEl.innerHTML = snapshots.length
    ? snapshots.map((snapshot, index) => `
        <option value="${index}">${escapeHtml(runOptionLabel(snapshot.run, snapshot.status))}</option>
      `).join('')
    : '<option value="">No primitive datasets available</option>';
  runSelectEl.disabled = snapshots.length === 0;

  function selectedSnapshot() {
    return snapshots[Number(runSelectEl.value)] || snapshots[0] || null;
  }

  function closeOverlay() {
    overlayEl.hidden = true;
  }

  function openPrimitiveOverlay(prim) {
    chartTitleEl.textContent = `${prim} rays/sec over time`;
    chartEl.innerHTML = renderPrimitiveChart(series, prim);
    overlayEl.hidden = false;
  }

  function render() {
    const snapshot = selectedSnapshot();
    closeOverlay();

    if (!snapshot) {
      setStatus(statusEl, 'UNKNOWN');
      messageEl.textContent = 'No primitive performance data has been ingested yet.';
      countEl.textContent = '';
      tableEl.innerHTML = '<p class="muted">No primitive rows available.</p>';
      return;
    }

    const rows = snapshot.rows || [];

    setStatus(statusEl, snapshot.status || 'UNKNOWN');
    const summary = snapshot.summary || {};
    messageEl.classList.toggle('warn', snapshot.status !== 'PASS');
    messageEl.innerHTML = `
      Showing ${formatNumber(summary.passing || 0)} passing and ${formatNumber(summary.failing || 0)} failing primitive rows from
      <code>${escapeHtml(snapshot.run?.id || 'unknown run')}</code> · ${escapeHtml(formatTimestamp(snapshot.run?.timestamp))}.
    `;

    countEl.textContent = `${rows.length} primitives. Scroll to inspect the full leaderboard.`;
    tableEl.innerHTML = renderLeaderboardRows(rows);
  }

  runSelectEl.addEventListener('change', render);

  closeEl.addEventListener('click', closeOverlay);

  overlayEl.addEventListener('click', (event) => {
    if (event.target === overlayEl) {
      closeOverlay();
    }
  });

  tableEl.addEventListener('click', (event) => {
    const row = event.target.closest('tr[data-prim]');
    if (!row) {
      return;
    }

    openPrimitiveOverlay(row.dataset.prim);
  });

  render();
}
