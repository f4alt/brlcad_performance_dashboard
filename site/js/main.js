import { initBenchmarkSection } from './lanes/benchmark.js';
import { initRtcmpGenericSection } from './lanes/rtcmp_generic.js';
import { initRtcmpPrimsSection } from './lanes/rtcmp_prims.js';
import { commitHref, escapeHtml, fetchJson, formatTimestamp, setStatus, uploadSummaryHref } from './utils.js';

function renderLatestUpload(latest) {
  const el = document.getElementById('latest-upload');

  if (!latest) {
    el.innerHTML = `
      <div>
        <p class="eyebrow">Latest upload</p>
        <strong>No uploads yet</strong>
      </div>
      <div class="muted">Waiting for the first <code>summary.json</code> package.</div>
    `;
    return;
  }

  const commitUrl = commitHref(latest);
  const commitLabel = latest.short_commit || latest.commit || 'unknown';
  const dataHref = uploadSummaryHref(latest);

  el.innerHTML = `
    <div>
      <p class="eyebrow">Latest upload</p>
      <strong>${escapeHtml(formatTimestamp(latest.timestamp))}</strong>
    </div>
    <div>
      <p class="eyebrow">Commit</p>
      ${commitUrl
        ? `<a href="${escapeHtml(commitUrl)}" target="_blank" rel="noopener noreferrer"><code>${escapeHtml(commitLabel)}</code></a>`
        : `<code>${escapeHtml(commitLabel)}</code>`}
    </div>
    <div>
      <p class="eyebrow">Overall status</p>
      <span class="status-pill ${escapeHtml(`status-${latest.status || 'UNKNOWN'}`)}">${escapeHtml(latest.status || 'UNKNOWN')}</span>
    </div>
    <div>
      <p class="eyebrow">Data</p>
      <a href="${escapeHtml(dataHref)}" target="_blank" rel="noopener noreferrer">upload package</a>
    </div>
  `;
}

async function initLane(name, initFn) {
  try {
    await initFn();
  } catch (error) {
    console.error(`Failed to initialize ${name}`, error);

    const statusEl = document.getElementById(`${name}-status`);
    const messageEl = document.getElementById(`${name}-message`);

    setStatus(statusEl, 'UNKNOWN');
    if (messageEl) {
      messageEl.classList.add('fail');
      messageEl.textContent = `Failed to load ${name}: ${error.message}`;
    }
  }
}

async function loadDashboard() {
  const index = await fetchJson('data/index.json');
  renderLatestUpload(index.latest_upload || null);

  await initLane('benchmark', initBenchmarkSection);
  await initLane('rtcmp-prims', initRtcmpPrimsSection);
  await initLane('rtcmp-generic', initRtcmpGenericSection);
}

loadDashboard().catch((error) => {
  console.error(error);
  document.getElementById('latest-upload').innerHTML = `
    <div>
      <p class="eyebrow">Dashboard load failed</p>
      <strong>${escapeHtml(error.message)}</strong>
    </div>
  `;
});
