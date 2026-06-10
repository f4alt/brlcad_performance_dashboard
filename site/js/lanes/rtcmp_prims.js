import {
  checkSchemaVersion,
  escapeHtml,
  fetchJson,
  formatNumber,
  formatTimestamp,
  renderLineChart,
  runOptionLabel,
  setStatus,
  sourceHref,
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
    href: (point) => sourceHref(point),
  });
}

export async function init() {
  const [latest, series] = await Promise.all([
    fetchJson('data/rtcmp_prims/latest.json'),
    fetchJson('data/rtcmp_prims/trend.json', { cache: 'default' }),
  ]);
  checkSchemaVersion(latest, 'rtcmp_prims/latest.json');
  checkSchemaVersion(series, 'rtcmp_prims/trend.json');

  const statusEl = document.getElementById('rtcmp_prims-status');
  const messageEl = document.getElementById('rtcmp_prims-message');
  const runSelectEl = document.getElementById('rtcmp_prims-run-select');
  const countEl = document.getElementById('rtcmp_prims-count');
  const tableEl = document.getElementById('rtcmp_prims-table');
  const overlayEl = document.getElementById('rtcmp_prims-overlay');
  const closeEl = document.getElementById('rtcmp_prims-overlay-close');
  const chartTitleEl = document.getElementById('rtcmp_prims-chart-title');
  const chartEl = document.getElementById('rtcmp_prims-chart');

  const runs = latest.runs || [];

  // Per-run detail is fetched on demand; seed the cache with the latest snapshot
  // (already embedded in latest.json) so the default view needs no extra request.
  const detailCache = new Map();
  if (latest.source_run?.id) {
    detailCache.set(latest.source_run.id, {
      run: latest.source_run,
      status: latest.status,
      summary: latest.summary || {},
      rows: latest.rows || [],
    });
  }

  runSelectEl.innerHTML = runs.length
    ? runs.map((run) => `
        <option value="${escapeHtml(run.id)}">${escapeHtml(runOptionLabel(run, run.status))}</option>
      `).join('')
    : '<option value="">No primitive datasets available</option>';
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
    const detail = await fetchJson(`data/rtcmp_prims/runs/${run.detail}`, { cache: 'default' });
    detailCache.set(run.id, detail);
    return detail;
  }

  function closeOverlay() {
    overlayEl.hidden = true;
  }

  function openPrimitiveOverlay(prim) {
    chartTitleEl.textContent = `${prim} rays/sec over time`;
    chartEl.innerHTML = renderPrimitiveChart(series, prim);
    overlayEl.hidden = false;
  }

  async function render() {
    closeOverlay();
    const run = selectedRun();

    if (!run) {
      setStatus(statusEl, 'UNKNOWN');
      messageEl.textContent = 'No primitive performance data has been ingested yet.';
      countEl.textContent = '';
      tableEl.innerHTML = '<p class="muted">No primitive rows available.</p>';
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

    const rows = snapshot?.rows || [];
    const summary = snapshot?.summary || {};

    setStatus(statusEl, snapshot?.status || 'UNKNOWN');
    messageEl.classList.remove('fail');
    messageEl.classList.toggle('warn', snapshot?.status !== 'PASS');
    messageEl.innerHTML = `
      Showing ${formatNumber(summary.passing || 0)} passing and ${formatNumber(summary.failing || 0)} failing primitive rows from
      <code>${escapeHtml(run.id || 'unknown run')}</code> · ${escapeHtml(formatTimestamp(run.timestamp))}.
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

  await render();
}
