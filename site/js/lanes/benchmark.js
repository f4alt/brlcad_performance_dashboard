import {
  checkSchemaVersion,
  fetchJson,
  formatNumber,
  renderLineChart,
  sourceHref,
} from '../utils.js';

function renderBenchmarkChart(series) {
  return renderLineChart(series.series || [], {
    yLabel: 'VGR',
    ariaLabel: 'Benchmark VGR over time',
    emptyMessage: 'No benchmark VGR data has been ingested yet.',
    tooltip: (point) => [
      `VGR: ${formatNumber(point.vgr)}`,
      `Version: ${point.build || 'unknown'}`,
      `Commit: ${point.short_commit || point.commit || 'unknown'}`,
      `Timestamp: ${point.timestamp || 'unknown'}`,
    ].join('\n'),
    href: (point) => sourceHref(point),
  });
}

export async function init() {
  const [latest, series] = await Promise.all([
    fetchJson('data/benchmark/latest.json'),
    fetchJson('data/benchmark/trend.json', { cache: 'default' }),
  ]);
  checkSchemaVersion(latest, 'benchmark/latest.json');
  checkSchemaVersion(series, 'benchmark/trend.json');

  const vgrEl = document.getElementById('benchmark-vgr');
  const chartEl = document.getElementById('benchmark-chart');

  if (vgrEl) {
    vgrEl.textContent = latest.vgr != null ? formatNumber(latest.vgr) : '—';
  }

  chartEl.innerHTML = renderBenchmarkChart(series);
}
