import {
  checkSchemaVersion,
  escapeHtml,
  fetchJson,
  formatNumber,
  formatTimestamp,
  renderLineChart,
  runOptionLabel,
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
    ].join('\n'),
    href: (point) => sourceHref(point),
  });
}

export async function init() {
  const [latest, series] = await Promise.all([
    fetchJson('data/primitives/latest.json'),
    fetchJson('data/primitives/trend.json', { cache: 'default' }),
  ]);
  checkSchemaVersion(latest, 'primitives/latest.json');
  checkSchemaVersion(series, 'primitives/trend.json');

  const messageEl = document.getElementById('primitives-message');
  const runSelectEl = document.getElementById('primitives-run-select');
  const countEl = document.getElementById('primitives-count');
  const tableEl = document.getElementById('primitives-table');
  const overlayEl = document.getElementById('primitives-overlay');
  const closeEl = document.getElementById('primitives-overlay-close');
  const chartTitleEl = document.getElementById('primitives-chart-title');
  const chartEl = document.getElementById('primitives-chart');

  const runs = latest.runs || [];

  // Per-run detail is fetched on demand; seed the cache with the latest snapshot
  // (already embedded in latest.json) so the default view needs no extra request.
  const detailCache = new Map();
  if (latest.source_run?.id) {
    detailCache.set(latest.source_run.id, {
      run: latest.source_run,
      summary: latest.summary || {},
      rows: latest.rows || [],
    });
  }

  runSelectEl.innerHTML = runs.length
    ? runs.map((run) => `
        <option value="${escapeHtml(run.id)}">${escapeHtml(runOptionLabel(run))}</option>
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
    const detail = await fetchJson(`data/primitives/runs/${run.detail}`, { cache: 'default' });
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

    messageEl.classList.remove('fail');
    messageEl.innerHTML = `
      Showing ${formatNumber(rows.length)} primitive rows from
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
