import { escapeHtml, fetchJson, formatNumber, formatTimestamp, statusClass } from './utils.js';

const CHART_WIDTH = 760;
const CHART_HEIGHT = 320;
const PAD = { top: 22, right: 28, bottom: 48, left: 76 };

function renderLatestTable(latest) {
  const rows = latest.rows || [];
  if (!rows.length) {
    return '<p class="muted">No passing benchmark values have been ingested yet.</p>';
  }

  const body = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.build)}</td>
      <td>${formatNumber(row.vgr)}</td>
      <td><code>${escapeHtml(row.short_commit || row.commit)}</code></td>
      <td>${formatTimestamp(row.timestamp)}</td>
    </tr>
  `).join('');

  return `
    <table>
      <thead>
        <tr>
          <th>Build</th>
          <th>VGR</th>
          <th>Commit</th>
          <th>Timestamp</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function scale(value, inMin, inMax, outMin, outMax) {
  if (inMax === inMin) {
    return (outMin + outMax) / 2;
  }
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

function niceDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || 'unknown time';
  }
  return date.toISOString().slice(0, 10);
}

function renderChart(points) {
  if (!points || !points.length) {
    return '<div class="chart-empty">No data points available for this build label.</div>';
  }

  const normalized = points
    .map((point) => ({
      ...point,
      x: new Date(point.timestamp).getTime(),
      y: Number(point.vgr),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((a, b) => a.x - b.x);

  if (!normalized.length) {
    return '<div class="chart-empty">No graphable data points available for this build label.</div>';
  }

  const minX = Math.min(...normalized.map((point) => point.x));
  const maxX = Math.max(...normalized.map((point) => point.x));
  const minYRaw = Math.min(...normalized.map((point) => point.y));
  const maxYRaw = Math.max(...normalized.map((point) => point.y));
  const yPad = Math.max((maxYRaw - minYRaw) * 0.08, maxYRaw * 0.02, 1);
  const minY = Math.max(0, minYRaw - yPad);
  const maxY = maxYRaw + yPad;

  const chartLeft = PAD.left;
  const chartRight = CHART_WIDTH - PAD.right;
  const chartTop = PAD.top;
  const chartBottom = CHART_HEIGHT - PAD.bottom;

  const chartPoints = normalized.map((point) => ({
    ...point,
    sx: scale(point.x, minX, maxX, chartLeft, chartRight),
    sy: scale(point.y, minY, maxY, chartBottom, chartTop),
  }));

  const line = chartPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.sx.toFixed(2)} ${point.sy.toFixed(2)}`).join(' ');
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
    const value = minY + (maxY - minY) * fraction;
    const y = scale(value, minY, maxY, chartBottom, chartTop);
    return { value, y };
  });

  const firstDate = niceDate(normalized[0].timestamp);
  const lastDate = niceDate(normalized[normalized.length - 1].timestamp);

  const pointEls = chartPoints.map((point) => {
    const tooltip = [
      `Build: ${point.build}`,
      `VGR: ${formatNumber(point.vgr)}`,
      `Commit: ${point.short_commit || point.commit || 'unknown'}`,
      `Run: ${point.run_id || 'unknown'}`,
      `Timestamp: ${point.timestamp || 'unknown'}`,
    ].join('\n');

    return `
      <circle class="chart-point" cx="${point.sx.toFixed(2)}" cy="${point.sy.toFixed(2)}" r="4.5" tabindex="0">
        <title>${escapeHtml(tooltip)}</title>
      </circle>
    `;
  }).join('');

  const yTickEls = yTicks.map((tick) => `
    <line class="chart-grid" x1="${chartLeft}" y1="${tick.y.toFixed(2)}" x2="${chartRight}" y2="${tick.y.toFixed(2)}"></line>
    <text class="chart-label" x="${chartLeft - 10}" y="${tick.y + 4}" text-anchor="end">${formatNumber(tick.value)}</text>
  `).join('');

  return `
    <svg class="chart" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" aria-label="Benchmark VGR over time">
      ${yTickEls}
      <line class="chart-axis" x1="${chartLeft}" y1="${chartBottom}" x2="${chartRight}" y2="${chartBottom}"></line>
      <line class="chart-axis" x1="${chartLeft}" y1="${chartTop}" x2="${chartLeft}" y2="${chartBottom}"></line>
      <path class="chart-line" d="${line}"></path>
      ${pointEls}
      <text class="chart-label" x="${chartLeft}" y="${CHART_HEIGHT - 14}" text-anchor="start">${escapeHtml(firstDate)}</text>
      <text class="chart-label" x="${chartRight}" y="${CHART_HEIGHT - 14}" text-anchor="end">${escapeHtml(lastDate)}</text>
      <text class="chart-label" x="14" y="${chartTop}" text-anchor="start">VGR</text>
    </svg>
  `;
}

function pickInitialLabel(labels, latest) {
  const latestLabel = latest.rows?.[0]?.build;
  if (latestLabel && labels.includes(latestLabel)) {
    return latestLabel;
  }
  return labels[0] || '';
}

export async function initBenchmarkSection() {
  const [latest, series] = await Promise.all([
    fetchJson('data/benchmark/latest.json'),
    fetchJson('data/benchmark/series.json'),
  ]);

  const statusEl = document.getElementById('benchmark-status');
  const messageEl = document.getElementById('benchmark-message');
  const tableEl = document.getElementById('benchmark-latest-table');
  const selectEl = document.getElementById('benchmark-label-select');
  const chartEl = document.getElementById('benchmark-chart');

  const sourceRun = latest.source_run || {};
  const effectiveStatus = latest.rows?.length ? 'PASS' : 'UNKNOWN';
  statusEl.innerHTML = `<span class="${statusClass(effectiveStatus)}">${effectiveStatus}</span>`;
  messageEl.classList.toggle('warn', Boolean(latest.stale));
  messageEl.innerHTML = `
    <strong>${escapeHtml(latest.message)}</strong>
    ${sourceRun.id ? `<br>Displayed run: <code>${escapeHtml(sourceRun.id)}</code>` : ''}
    ${latest.latest_run_id ? `<br>Latest ingested run: <code>${escapeHtml(latest.latest_run_id)}</code>` : ''}
    ${latest.latest_benchmark_status ? `<br>Latest benchmark status: <strong class="${statusClass(latest.latest_benchmark_status)}">${escapeHtml(latest.latest_benchmark_status)}</strong>` : ''}
  `;

  tableEl.innerHTML = renderLatestTable(latest);

  const labels = series.labels || [];
  selectEl.innerHTML = labels.length
    ? labels.map((label) => `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`).join('')
    : '<option value="">No benchmark labels loaded</option>';
  selectEl.disabled = labels.length === 0;

  const renderSelected = () => {
    const label = selectEl.value;
    const points = series.series_by_label?.[label] || [];
    chartEl.innerHTML = renderChart(points);
  };

  const initialLabel = pickInitialLabel(labels, latest);
  if (initialLabel) {
    selectEl.value = initialLabel;
  }
  selectEl.addEventListener('change', renderSelected);
  renderSelected();
}
