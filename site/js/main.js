import { commitHref, escapeHtml, fetchJson, formatTimestamp, setStatus, sourceHref } from './utils.js';

function renderLatestUpload(latest) {
  const el = document.getElementById('latest-upload');

  if (!latest) {
    el.innerHTML = `
      <div>
        <p class="eyebrow">Latest upload</p>
        <strong>No runs yet</strong>
      </div>
      <div class="muted">Waiting for the first <code>summary.json</code> in <code>data/to_process/</code>.</div>
    `;
    return;
  }

  const commitUrl = commitHref(latest);
  const commitLabel = latest.short_commit || latest.commit || 'unknown';
  const srcHref = sourceHref(latest);

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
      <p class="eyebrow">Source</p>
      ${srcHref && srcHref !== '#'
        ? `<a href="${escapeHtml(srcHref)}" target="_blank" rel="noopener noreferrer">source run</a>`
        : '<span class="muted">—</span>'}
    </div>
  `;
}

async function initLane(name, title) {
  try {
    const module = await import(`./lanes/${name}.js`);
    if (typeof module.init !== 'function') {
      throw new Error(`lane module ${name}.js does not export init()`);
    }
    await module.init();
  } catch (error) {
    console.error(`Failed to initialize ${name}`, error);

    setStatus(document.getElementById(`${name}-status`), 'UNKNOWN');

    const messageEl = document.getElementById(`${name}-message`);
    if (messageEl) {
      messageEl.classList.add('fail');
      messageEl.textContent = `Failed to load ${title || name}: ${error.message}`;
    }
  }
}

async function loadDashboard() {
  const index = await fetchJson('data/index.json');
  renderLatestUpload(index.latest_upload || null);

  const lanes = await fetchJson('data/lanes.json');
  for (const lane of lanes) {
    await initLane(lane.name, lane.title);
  }
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
