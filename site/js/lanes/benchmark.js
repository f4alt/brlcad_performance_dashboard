import {
  escapeHtml,
  fetchJson,
  formatNumber,
  formatPercent,
  formatShortTimestamp,
  formatTimestamp,
  renderLineChart,
  runOptionLabel,
  setStatus,
  uploadSummaryHref,
} from '../utils.js';

function rowsByKey(rows) {
  const map = new Map();
  for (const row of rows || []) {
    map.set(row.row_key || row.build, row);
  }
  return map;
}

function renderComparisonTable(latestRows, selectedSnapshot) {
  if (!latestRows?.length) {
    return '<p class="muted">No passing benchmark values have been ingested yet.</p>';
  }

  const selectedRows = rowsByKey(selectedSnapshot?.rows || []);
  const body = latestRows.map((row) => {
    const selected = selectedRows.get(row.row_key || row.build);
    const latestValue = Number(row.vgr);
    const selectedValue = selected?.vgr == null ? null : Number(selected.vgr);
    const delta = selectedValue != null && Number.isFinite(selectedValue) && selectedValue !== 0
      ? ((latestValue - selectedValue) / selectedValue) * 100
      : null;

    return `
      <tr>
        <td>${escapeHtml(row.row_key || row.build)}</td>
        <td class="numeric">${formatNumber(row.vgr)}</td>
        <td class="numeric">${selected ? formatNumber(selected.vgr) : '—'}</td>
        <td class="numeric">${formatPercent(delta)}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Build</th>
            <th class="numeric">Latest VGR</th>
            <th class="numeric">Selected VGR</th>
            <th class="numeric">Delta</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function renderLabelCheckboxes(labels, selectedLabels) {
  if (!labels.length) {
    return '<p class="muted">No benchmark build labels loaded.</p>';
  }

  return labels.map((label) => `
    <label class="checkbox-label">
      <input type="checkbox" value="${escapeHtml(label)}" ${selectedLabels.has(label) ? 'checked' : ''}>
      <span>${escapeHtml(label)}</span>
    </label>
  `).join('');
}

function selectedCheckboxValues(container) {
  return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map((input) => input.value);
}

function renderBenchmarkChart(series, labels) {
  const seriesList = labels.map((label) => ({
    label,
    points: (series.series_by_label?.[label] || []).map((point) => ({
      ...point,
      value: point.vgr,
    })),
  }));

  return renderLineChart(seriesList, {
    yLabel: 'VGR',
    ariaLabel: 'Benchmark VGR over time',
    emptyMessage: 'Select at least one build label with graphable VGR data.',
    tooltip: (point) => [
      `Build: ${point.build}`,
      `VGR: ${formatNumber(point.vgr)}`,
      `Commit: ${point.short_commit || point.commit || 'unknown'}`,
      `Timestamp: ${point.timestamp || 'unknown'}`,
    ].join('\n'),
    href: (point) => point.summary_path || '#',
  });
}

function defaultSelectedLabels(labels, latestRows) {
  const latestLabels = new Set((latestRows || []).map((row) => row.build).filter(Boolean));
  const selected = new Set(labels.filter((label) => latestLabels.has(label)));

  if (selected.size === 0 && labels[0]) {
    selected.add(labels[0]);
  }

  return selected;
}

export async function initBenchmarkSection() {
  const [latest, series] = await Promise.all([
    fetchJson('data/benchmark/latest.json'),
    fetchJson('data/benchmark/series.json'),
  ]);

  const statusEl = document.getElementById('benchmark-status');
  const messageEl = document.getElementById('benchmark-message');
  const tableEl = document.getElementById('benchmark-latest-table');
  const compareSelectEl = document.getElementById('benchmark-compare-select');
  const checkboxEl = document.getElementById('benchmark-label-checkboxes');
  const chartEl = document.getElementById('benchmark-chart');

  const effectiveStatus = latest.rows?.length ? 'PASS' : 'UNKNOWN';
  setStatus(statusEl, effectiveStatus);

  const sourceRun = latest.source_run || null;
  const sourceLink = sourceRun ? `<a href="${escapeHtml(uploadSummaryHref(sourceRun))}" target="_blank" rel="noopener noreferrer"><code>${escapeHtml(sourceRun.id)}</code></a>` : '—';

  messageEl.classList.toggle('warn', Boolean(latest.stale));
  messageEl.innerHTML = `
    ${escapeHtml(latest.message || 'Benchmark data loaded.')}
    ${sourceRun ? `<br>Displayed run: ${sourceLink} · ${escapeHtml(formatTimestamp(sourceRun.timestamp))}` : ''}
    ${latest.latest_benchmark_status ? `<br>Latest benchmark status: <strong class="${escapeHtml(`status-${latest.latest_benchmark_status}`)}">${escapeHtml(latest.latest_benchmark_status)}</strong>` : ''}
  `;

  const comparisonRuns = latest.comparison_runs || [];
  compareSelectEl.innerHTML = comparisonRuns.length
    ? comparisonRuns.map((snapshot, index) => `
        <option value="${index}">${escapeHtml(runOptionLabel(snapshot.run, snapshot.status))}</option>
      `).join('')
    : '<option value="">No passing runs available</option>';
  compareSelectEl.disabled = comparisonRuns.length === 0;

  const renderComparison = () => {
    const selectedSnapshot = comparisonRuns[Number(compareSelectEl.value)] || comparisonRuns[0] || null;
    tableEl.innerHTML = renderComparisonTable(latest.rows || [], selectedSnapshot);
  };

  compareSelectEl.addEventListener('change', renderComparison);
  renderComparison();

  const labels = series.labels || [];
  const selectedLabels = defaultSelectedLabels(labels, latest.rows || []);
  checkboxEl.innerHTML = renderLabelCheckboxes(labels, selectedLabels);

  const renderSelectedChart = () => {
    const selected = selectedCheckboxValues(checkboxEl);
    chartEl.innerHTML = renderBenchmarkChart(series, selected);
  };

  checkboxEl.addEventListener('change', renderSelectedChart);
  renderSelectedChart();
}
