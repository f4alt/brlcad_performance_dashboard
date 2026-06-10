export const fmt = (value) => (value == null || value === '' ? '—' : String(value));

export function escapeHtml(value) {
  return fmt(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function statusClass(status) {
  const normalized = fmt(status).trim().toUpperCase() || 'UNKNOWN';
  return `status-${normalized}`;
}

export function setStatus(el, status) {
  if (!el) return;
  const normalized = fmt(status).trim().toUpperCase() || 'UNKNOWN';
  el.textContent = normalized;
  el.className = `status-pill ${statusClass(normalized)}`;
}

export function formatNumber(value, options = {}) {
  if (value == null || value === '') {
    return '—';
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    return String(value);
  }

  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
  }).format(number);
}

export function formatPercent(value) {
  if (value == null || value === '') {
    return '—';
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    return String(value);
  }

  const sign = number > 0 ? '+' : '';
  return `${sign}${formatNumber(number, { maximumFractionDigits: 3 })}%`;
}

export function formatTimestamp(value) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
}

export function formatShortTimestamp(value) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export async function fetchJson(path, options = {}) {
  // Small, always-loaded files default to no-store; pass { cache: 'default' }
  // for large lazily-loaded files (trend.json, per-run detail) so the browser
  // can reuse them across views.
  const response = await fetch(path, { cache: options.cache || 'no-store' });
  if (!response.ok) {
    throw new Error(`Could not load ${path}: ${response.status}`);
  }
  return response.json();
}

const EXPECTED_SCHEMA_VERSION = 1;

export function checkSchemaVersion(payload, label, expected = EXPECTED_SCHEMA_VERSION) {
  if (payload && payload.schema_version !== expected) {
    console.warn(
      `Unexpected schema_version in ${label}: got ${payload?.schema_version}, expected ${expected}. ` +
      'The frontend and ingest contract may be out of sync.',
    );
  }
  return payload;
}

export function commitHref(run) {
  if (!run?.repository || !run?.commit) {
    return null;
  }

  return `https://github.com/${run.repository}/commit/${run.commit}`;
}

// The durable source of a run is its originating CI workflow (or the source
// commit). Uploaded packages are no longer kept in-repo.
export function sourceHref(run) {
  if (!run) {
    return '#';
  }
  if (run.workflow_url) {
    return run.workflow_url;
  }
  return commitHref(run) || '#';
}

export function runOptionLabel(run, status = null) {
  const parts = [
    formatShortTimestamp(run?.timestamp),
    run?.short_commit || run?.commit || 'unknown commit',
  ];

  if (status) {
    parts.push(status);
  }

  return parts.join(' · ');
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

const SERIES_COLORS = [
  '#1565c0',
  '#2e7d32',
  '#ef6c00',
  '#6a1b9a',
  '#00838f',
  '#ad1457',
  '#5d4037',
  '#455a64',
];

export function renderLineChart(seriesList, options = {}) {
  const width = options.width || 820;
  const height = options.height || 340;
  const pad = options.pad || { top: 24, right: 32, bottom: 50, left: 76 };
  const yLabel = options.yLabel || '';
  const emptyMessage = options.emptyMessage || 'No graphable data points available.';

  const normalizedSeries = (seriesList || [])
    .map((series, seriesIndex) => {
      const points = (series.points || [])
        .map((point) => ({
          ...point,
          x: new Date(point.timestamp).getTime(),
          y: Number(point.value),
        }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
        .sort((a, b) => a.x - b.x);

      return {
        label: series.label || `Series ${seriesIndex + 1}`,
        color: series.color || SERIES_COLORS[seriesIndex % SERIES_COLORS.length],
        points,
      };
    })
    .filter((series) => series.points.length > 0);

  if (!normalizedSeries.length) {
    return `<div class="chart-empty">${escapeHtml(emptyMessage)}</div>`;
  }

  const allPoints = normalizedSeries.flatMap((series) => series.points);
  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const minYRaw = Math.min(...allPoints.map((point) => point.y));
  const maxYRaw = Math.max(...allPoints.map((point) => point.y));
  const yPad = Math.max((maxYRaw - minYRaw) * 0.08, Math.abs(maxYRaw) * 0.02, 1);
  const minY = Math.max(0, minYRaw - yPad);
  const maxY = maxYRaw + yPad;

  const chartLeft = pad.left;
  const chartRight = width - pad.right;
  const chartTop = pad.top;
  const chartBottom = height - pad.bottom;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
    const value = minY + (maxY - minY) * fraction;
    const y = scale(value, minY, maxY, chartBottom, chartTop);
    return { value, y };
  });

  const yTickEls = yTicks.map((tick) => `
    <line class="chart-grid" x1="${chartLeft}" x2="${chartRight}" y1="${tick.y.toFixed(2)}" y2="${tick.y.toFixed(2)}"></line>
    <text class="chart-label" x="${chartLeft - 8}" y="${tick.y + 4}" text-anchor="end">${escapeHtml(formatNumber(tick.value))}</text>
  `).join('');

  const seriesEls = normalizedSeries.map((series) => {
    const chartPoints = series.points.map((point) => ({
      ...point,
      sx: scale(point.x, minX, maxX, chartLeft, chartRight),
      sy: scale(point.y, minY, maxY, chartBottom, chartTop),
    }));

    const line = chartPoints
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.sx.toFixed(2)} ${point.sy.toFixed(2)}`)
      .join(' ');

    const circles = chartPoints.map((point) => {
      const tooltip = options.tooltip ? options.tooltip(point, series.label) : [
        series.label,
        `Value: ${formatNumber(point.y)}`,
        `Commit: ${point.short_commit || point.commit || 'unknown'}`,
        `Timestamp: ${point.timestamp || 'unknown'}`,
      ].join('\n');
      const href = options.href ? options.href(point, series.label) : sourceHref(point);
      const circle = `
        <circle class="chart-point" cx="${point.sx.toFixed(2)}" cy="${point.sy.toFixed(2)}" r="4" stroke="${series.color}">
          <title>${escapeHtml(tooltip)}</title>
        </circle>
      `;

      if (!href || href === '#') {
        return circle;
      }

      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${circle}</a>`;
    }).join('');

    return `
      <path class="chart-line" d="${escapeHtml(line)}" stroke="${series.color}"></path>
      ${circles}
    `;
  }).join('');

  const firstDate = niceDate(new Date(minX).toISOString());
  const lastDate = niceDate(new Date(maxX).toISOString());
  const legend = normalizedSeries.map((series) => `
    <span class="legend-item"><span class="legend-swatch" style="color: ${series.color}"></span>${escapeHtml(series.label)}</span>
  `).join('');

  return `
    <svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(options.ariaLabel || 'Performance chart')}">
      ${yTickEls}
      <line class="chart-axis" x1="${chartLeft}" x2="${chartRight}" y1="${chartBottom}" y2="${chartBottom}"></line>
      <line class="chart-axis" x1="${chartLeft}" x2="${chartLeft}" y1="${chartTop}" y2="${chartBottom}"></line>
      ${seriesEls}
      <text class="chart-label" x="${chartLeft}" y="${height - 16}" text-anchor="start">${escapeHtml(firstDate)}</text>
      <text class="chart-label" x="${chartRight}" y="${height - 16}" text-anchor="end">${escapeHtml(lastDate)}</text>
      <text class="chart-label" x="18" y="${chartTop}" transform="rotate(-90 18 ${chartTop})">${escapeHtml(yLabel)}</text>
    </svg>
    <div class="legend">${legend}</div>
  `;
}
