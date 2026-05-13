import {
  escapeHtml,
  fetchJson,
  formatNumber,
  formatShortTimestamp,
  renderLineChart,
  setStatus,
  uploadPackageHref,
} from '../utils.js';

function pointId(point, index) {
  return [
    point.build || '',
    point.run_id || '',
    point.timestamp || '',
    point.row_key || '',
    index,
  ].join('|');
}

function flattenBenchmarkPoints(series) {
  const points = [];
  for (const label of series.labels || []) {
    for (const point of series.series_by_label?.[label] || []) {
      points.push(point);
    }
  }

  return points
    .map((point, index) => ({ ...point, point_id: pointId(point, index) }))
    .sort((a, b) => {
      const timeSort = String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
      if (timeSort !== 0) {
        return timeSort;
      }
      return String(a.row_key || a.build || '').localeCompare(String(b.row_key || b.build || ''));
    });
}

function optionLabel(point) {
  const build = point.row_key || point.build || 'unknown build';
  const timestamp = formatShortTimestamp(point.timestamp);
  return `${build} - ${timestamp}`;
}

function renderBenchmarkPointSelect(points, selectId, selectedId) {
  if (!points.length) {
    return '<select disabled><option>No benchmark data available</option></select>';
  }

  return `
    <select id="${escapeHtml(selectId)}">
      ${points.map((point) => `
        <option value="${escapeHtml(point.point_id)}" ${point.point_id === selectedId ? 'selected' : ''}>
          ${escapeHtml(optionLabel(point))}
        </option>
      `).join('')}
    </select>
  `;
}

function renderComparisonTable(points, selectedIds) {
  if (!points.length) {
    return '<p class="muted">No benchmark values have been ingested yet.</p>';
  }

  const byId = new Map(points.map((point) => [point.point_id, point]));
  const selected = selectedIds.map((id) => byId.get(id)).filter(Boolean);

  return `
    <div class="table-wrap">
      <table class="compact-table">
        <thead>
          <tr>
            <th>Build</th>
            <th class="numeric">VGR</th>
          </tr>
        </thead>
        <tbody>
          ${[0, 1].map((slot) => {
            const point = selected[slot] || points[slot] || points[0];
            return `
              <tr>
                <td>${renderBenchmarkPointSelect(points, `benchmark-point-${slot}`, point?.point_id || '')}</td>
                <td class="numeric strong-number">${formatNumber(point?.vgr)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
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
    href: (point) => uploadPackageHref(point),
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

function defaultSelectedPointIds(points, latestRows) {
  const latestKeys = new Set((latestRows || []).map((row) => `${row.run_id}|${row.row_key || row.build}`));
  const selected = [];

  for (const point of points) {
    const key = `${point.run_id}|${point.row_key || point.build}`;
    if (latestKeys.has(key)) {
      selected.push(point.point_id);
    }
    if (selected.length >= 2) {
      break;
    }
  }

  while (selected.length < 2 && points[selected.length]) {
    selected.push(points[selected.length].point_id);
  }

  return selected;
}

export async function initBenchmarkSection() {
  const [latest, series] = await Promise.all([
    fetchJson('data/benchmark/latest.json'),
    fetchJson('data/benchmark/series.json'),
  ]);

  const statusEl = document.getElementById('benchmark-status');
  const tableEl = document.getElementById('benchmark-latest-table');
  const checkboxEl = document.getElementById('benchmark-label-checkboxes');
  const chartEl = document.getElementById('benchmark-chart');

  const effectiveStatus = latest.rows?.length ? 'PASS' : 'UNKNOWN';
  setStatus(statusEl, effectiveStatus);

  const points = flattenBenchmarkPoints(series);
  let selectedPointIds = defaultSelectedPointIds(points, latest.rows || []);

  const rerenderComparison = () => {
    tableEl.innerHTML = renderComparisonTable(points, selectedPointIds);

    for (const slot of [0, 1]) {
      const select = document.getElementById(`benchmark-point-${slot}`);
      if (!select) {
        continue;
      }

      select.addEventListener('change', () => {
        selectedPointIds[slot] = select.value;
        rerenderComparison();
      });
    }
  };

  rerenderComparison();

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
