'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let selectedFolder  = null;
let isWatching      = false;
let activeFrame     = null;
const imageCards    = new Map(); // imageId → card element
const cardFilePaths = new Map(); // imageId → filePath (for manual send)
const cardPhones    = new Map(); // imageId → phone number (for search)
let queueCount      = 0;
let currentTab      = 'all';     // 'all' | 'sent' | 'not-sent'

// ── DOM refs ──────────────────────────────────────────────────────────────────
const folderPathText  = document.getElementById('folder-path-text');
const btnSelect       = document.getElementById('btn-select');
const btnWatch        = document.getElementById('btn-watch');
const btnStop         = document.getElementById('btn-stop');
const btnToggleLog    = document.getElementById('btn-toggle-log');
const btnRetry        = document.getElementById('btn-retry');
const btnClearLog     = document.getElementById('btn-clear-log');
const contentArea     = document.getElementById('content-area');
const queueList       = document.getElementById('queue-list');
const queueCountBadge = document.getElementById('queue-count');
const logOutput       = document.getElementById('log-output');
const dbDot           = document.getElementById('db-dot');
const dbStatusText    = document.getElementById('db-status-text');
const statPending     = document.getElementById('stat-pending');
const statProcessing  = document.getElementById('stat-processing');
const statCompleted   = document.getElementById('stat-completed');
const statFailed      = document.getElementById('stat-failed');

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTs(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour12: false });
}

function statusIcon(status) {
  const map = {
    detected:   '🔍',
    processing: '⚙️',
    uploaded:   '☁️',
    completed:  '✅',
    failed:     '❌',
    'no-match': '❓',
  };
  return map[status] || '🔲';
}

function statusLabel(status) {
  const map = {
    detected:   'Image detected — looking up user…',
    processing: 'Uploading photo to Cloudflare R2…',
    uploaded:   'Uploaded — sending WhatsApp…',
    completed:  'Done! Photo delivered via WhatsApp.',
    failed:     'Processing failed.',
    'no-match': 'No matching user found in database.',
  };
  return map[status] || status;
}

function progressPct(status) {
  const map = {
    detected:   10,
    processing: 40,
    uploaded:   75,
    completed:  100,
    failed:     100,
    'no-match': 100,
  };
  return map[status] ?? 0;
}

// ── Log ───────────────────────────────────────────────────────────────────────

function appendLog({ level, message, imageId, ts }) {
  const line = document.createElement('div');
  line.className = 'log-line';

  const tsEl  = document.createElement('span');
  tsEl.className = 'log-ts';
  tsEl.textContent = fmtTs(ts);

  const lvlEl = document.createElement('span');
  lvlEl.className = `log-lvl ${level}`;
  lvlEl.textContent = level.toUpperCase();

  const msgEl = document.createElement('span');
  msgEl.className = 'log-msg';
  msgEl.textContent = message;

  line.appendChild(tsEl);
  line.appendChild(lvlEl);
  line.appendChild(msgEl);

  if (imageId) {
    const idEl = document.createElement('span');
    idEl.className = 'log-id';
    idEl.textContent = `[${imageId}]`;
    line.appendChild(idEl);
  }

  logOutput.appendChild(line);
  logOutput.scrollTop = logOutput.scrollHeight;

  // Cap log at 500 lines
  while (logOutput.children.length > 500) {
    logOutput.removeChild(logOutput.firstChild);
  }
}

// ── Queue cards ───────────────────────────────────────────────────────────────

function removeEmptyState() {
  const es = queueList.querySelector('.empty-state');
  if (es) es.remove();
}

function upsertCard(imageId, status, extra = {}) {
  let card = imageCards.get(imageId);

  if (!card) {
    // New card
    removeEmptyState();
    card = document.createElement('div');
    card.className = `queue-card ${status}`;

    card.innerHTML = `
      <div class="card-preview" id="cp-${imageId}">
        <span class="card-preview-ph">🖼️</span>
        <span class="card-status-badge" id="ci-${imageId}">${statusIcon(status)}</span>
      </div>
      <div class="card-footer">
        <div class="card-id">${imageId}</div>
        <div class="card-user" id="cu-${imageId}"></div>
        <div class="card-step" id="cs-${imageId}">${statusLabel(status)}</div>
        <div class="progress-bar-wrap">
          <div class="progress-bar" id="cpb-${imageId}" style="width:${progressPct(status)}%"></div>
        </div>
      </div>
    `;

    // Prepend so newest is at top
    queueList.insertBefore(card, queueList.firstChild);
    imageCards.set(imageId, card);
    queueCount++;
    queueCountBadge.textContent = queueCount;
  } else {
    // Update existing
    card.className = `queue-card ${status}`;
    const badgeEl = document.getElementById(`ci-${imageId}`);
    if (badgeEl) badgeEl.textContent = statusIcon(status);
    const stepEl = document.getElementById(`cs-${imageId}`);
    if (stepEl) stepEl.textContent = statusLabel(status);
    const pb = document.getElementById(`cpb-${imageId}`);
    if (pb) pb.style.width = `${progressPct(status)}%`;
  }

  // Set preview thumbnail if provided
  if (extra.previewUrl) {
    const previewEl = document.getElementById(`cp-${imageId}`);
    if (previewEl) {
      // Keep the status badge, replace only the background image
      const badge = previewEl.querySelector('.card-status-badge');
      previewEl.innerHTML = `<img src="${extra.previewUrl}" alt="Photo preview" class="card-preview-img" />`;
      if (badge) previewEl.appendChild(badge);
    }
  }


  // Update user info if provided (from normal processing path)
  if (extra.user) {
    const userEl = document.getElementById(`cu-${imageId}`);
    if (userEl) userEl.textContent = `${extra.user.phone}`;
    if (extra.user.phone) cardPhones.set(imageId, extra.user.phone);
  }

  // Store phone from skip/completed events (restart path or manual send path)
  if (extra.phone && !cardPhones.has(imageId)) {
    cardPhones.set(imageId, extra.phone);
    const userEl = document.getElementById(`cu-${imageId}`);
    if (userEl && !userEl.textContent) userEl.textContent = extra.phone;
  }

  // Show image URL if completed
  if (extra.imageUrl) {
    const urlEl = document.getElementById(`curl-${imageId}`);
    if (urlEl) urlEl.textContent = extra.imageUrl;
  }

  // Show error
  if (extra.error) {
    const stepEl = document.getElementById(`cs-${imageId}`);
    if (stepEl) stepEl.textContent = `❌ ${extra.error}`;
  }

  // Store filePath for manual send
  if (extra.filePath) {
    cardFilePaths.set(imageId, extra.filePath);
  }

  // Make preview clickable for no-match / failed / completed cards (re-send)
  const isSendable = (status === 'no-match' || status === 'failed' || status === 'completed');
  const previewEl  = document.getElementById(`cp-${imageId}`);
  if (previewEl) {
    if (isSendable && cardFilePaths.has(imageId)) {
      if (!activeFrame) {
        previewEl.classList.remove('card-preview-clickable');
        previewEl.title = '⚠️ Please select an active frame first';
        previewEl.onclick = () => {
          alert('⚠️ Please select an active frame in the "Frames" tab first before sending!');
        };
      } else {
        previewEl.classList.add('card-preview-clickable');
        previewEl.title = '📲 Click to send manually';
        previewEl.onclick = () => openManualModal(imageId);
      }
    } else {
      previewEl.classList.remove('card-preview-clickable');
      previewEl.title = '';
      previewEl.onclick = null;
    }
  }

  // Update tab counts
  let completedCount = 0;
  for (const card of imageCards.values()) {
    if (card.classList.contains('completed')) completedCount++;
  }
  document.getElementById('tab-count-all').textContent = imageCards.size;
  document.getElementById('tab-count-sent').textContent = completedCount;
  document.getElementById('tab-count-not-sent').textContent = imageCards.size - completedCount;

  // Re-apply current tab filter (in case a card's status changed and needs to be hidden)
  applySearch();
}

function updateCardActions() {
  for (const [imageId, card] of imageCards.entries()) {
    const previewEl = document.getElementById(`cp-${imageId}`);
    if (previewEl && cardFilePaths.has(imageId)) {
      const isCompleted = card.classList.contains('completed');
      const isFailed    = card.classList.contains('failed');
      const isNoMatch   = card.classList.contains('no-match');
      const isSendable  = isCompleted || isFailed || isNoMatch;

      if (isSendable) {
        if (!activeFrame) {
          previewEl.classList.remove('card-preview-clickable');
          previewEl.title = '⚠️ Please select an active frame first';
          previewEl.onclick = () => {
            alert('⚠️ Please select an active frame in the "Frames" tab first before sending!');
          };
        } else {
          previewEl.classList.add('card-preview-clickable');
          previewEl.title = '📲 Click to send manually';
          previewEl.onclick = () => openManualModal(imageId);
        }
      }
    }
  }
}


// ── Stats refresh ─────────────────────────────────────────────────────────────

function refreshStats() {
  let pending = 0;
  let processing = 0;
  let completed = 0;
  let failed = 0;

  for (const card of imageCards.values()) {
    if (card.classList.contains('completed')) {
      completed++;
    } else if (card.classList.contains('failed')) {
      failed++;
    } else if (card.classList.contains('processing')) {
      processing++;
    } else {
      // Anything else (detected, uploaded, no-match, etc) is "pending"
      pending++;
    }
  }

  statPending.textContent    = pending;
  statProcessing.textContent = processing;
  statCompleted.textContent  = completed;
  statFailed.textContent     = failed;
}

// Poll stats every 5 s
setInterval(refreshStats, 5000);

// ── IPC listeners ─────────────────────────────────────────────────────────────

window.api.onLog((data) => appendLog(data));

window.api.onDbStatus(({ connected, error }) => {
  dbDot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
  dbStatusText.textContent = connected ? 'Connected' : (error ? 'Error' : 'Disconnected');
  if (connected) refreshStats();
});

window.api.onImageStatus(({ imageId, status, user, imageUrl, error, previewUrl, filePath, phone }) => {
  upsertCard(imageId, status, { user, imageUrl, error, previewUrl, filePath, phone });
  refreshStats();
});

// ── Manual Send Modal ─────────────────────────────────────────────────────────────

const manualModal    = document.getElementById('manual-modal');
const modalPhoneInput = document.getElementById('modal-phone');
const modalPreviewImg = document.getElementById('modal-preview-img');
const modalPhotoIdTxt = document.getElementById('modal-photo-id-text');
const modalError      = document.getElementById('modal-error');
const modalSendBtn    = document.getElementById('modal-send');

let activeManualImageId = null;

function openManualModal(imageId) {
  activeManualImageId = imageId;
  modalPhotoIdTxt.textContent = imageId;
  modalPhoneInput.value = '';

  // Show the current thumbnail in the modal
  const previewEl = document.getElementById(`cp-${imageId}`);
  const thumbImg  = previewEl?.querySelector('img');
  modalPreviewImg.src = thumbImg?.src || '';

  if (!activeFrame) {
    modalError.textContent = '⚠️ Please select an active frame in the "Frames" tab first.';
    modalError.style.display = 'block';
    modalSendBtn.disabled = true;
    modalSendBtn.textContent = '✨ Upload & Send (Disabled)';
    modalPhoneInput.disabled = true;
  } else {
    modalError.style.display = 'none';
    modalSendBtn.disabled = false;
    modalSendBtn.textContent = '✨ Upload & Send';
    modalPhoneInput.disabled = false;
  }

  manualModal.style.display = 'flex';
  if (activeFrame) {
    setTimeout(() => modalPhoneInput.focus(), 50);
  }
}

function closeManualModal() {
  manualModal.style.display = 'none';
  activeManualImageId = null;
}

document.getElementById('modal-close').addEventListener('click', closeManualModal);
document.getElementById('modal-cancel').addEventListener('click', closeManualModal);
manualModal.addEventListener('click', (e) => { if (e.target === manualModal) closeManualModal(); });

modalSendBtn.addEventListener('click', async () => {
  const phone = modalPhoneInput.value.trim();
  if (!phone) {
    modalError.textContent = '⚠️ Please enter a WhatsApp number.';
    modalError.style.display = 'block';
    return;
  }
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 7 || cleaned.length > 15) {
    modalError.textContent = '⚠️ Enter a valid number with country code (e.g. +94771234567).';
    modalError.style.display = 'block';
    return;
  }

  modalError.style.display = 'none';
  modalSendBtn.disabled = true;
  modalSendBtn.textContent = '⏳ Uploading…';

  const imageId = activeManualImageId;
  const filePath = cardFilePaths.get(imageId);

  appendLog({ level: 'info', message: `📤 Manual send: ${imageId} → ${phone}`, ts: new Date().toISOString() });

  const result = await window.api.manualSend({ filePath, phone, imageId });

  if (result.ok) {
    // Store phone so it's searchable
    cardPhones.set(imageId, phone);
    const userEl = document.getElementById(`cu-${imageId}`);
    if (userEl) userEl.textContent = phone;
    closeManualModal();
    appendLog({ level: 'info', message: `✅ Manually sent to ${phone}`, ts: new Date().toISOString() });

  } else {
    modalError.textContent = `❌ ${result.error}`;
    modalError.style.display = 'block';
    modalSendBtn.disabled = false;
    modalSendBtn.textContent = '✨ Upload & Send';
  }
});

// Allow Enter key to submit
modalPhoneInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') modalSendBtn.click();
});

// ── Button handlers ───────────────────────────────────────────────────────────

btnSelect.addEventListener('click', async () => {
  const folder = await window.api.selectFolder();
  if (!folder) return;
  selectedFolder = folder;
  folderPathText.textContent = folder;
  btnWatch.disabled = false;
  appendLog({ level: 'info', message: `Folder selected: ${folder}`, ts: new Date().toISOString() });
});

btnWatch.addEventListener('click', async () => {
  if (!selectedFolder) return;
  await window.api.startWatch(selectedFolder);
  isWatching = true;
  document.body.classList.add('watching');
  btnWatch.style.display = 'none';
  btnStop.style.display  = 'inline-flex';
  appendLog({ level: 'info', message: '👁️  Watching started', ts: new Date().toISOString() });
});

btnStop.addEventListener('click', async () => {
  await window.api.stopWatch();
  isWatching = false;
  document.body.classList.remove('watching');
  btnStop.style.display  = 'none';
  btnWatch.style.display = 'inline-flex';
  appendLog({ level: 'info', message: '🛑 Watching stopped', ts: new Date().toISOString() });
});

btnRetry.addEventListener('click', async () => {
  const result = await window.api.retryFailed();
  if (result.error) {
    appendLog({ level: 'error', message: result.error, ts: new Date().toISOString() });
  } else {
    appendLog({ level: 'info', message: `🔄 Reset ${result.count} failed records to pending`, ts: new Date().toISOString() });
    refreshStats();
  }
});

// ── Search / filter ───────────────────────────────────────────────────────────

const searchInput = document.getElementById('search-input');
const searchClear = document.getElementById('search-clear');
let noResultsEl   = null;

function applySearch(query) {
  const q = (typeof query === 'string' ? query : searchInput.value).toLowerCase().trim();
  let visibleCount = 0;

  for (const [imageId, card] of imageCards.entries()) {
    // 1. Tab filter check
    const status = Array.from(card.classList).find(c => c !== 'queue-card' && c !== 'search-hidden' && c !== 'tab-hidden');
    let tabMatch = true;
    if (currentTab === 'sent') {
      tabMatch = (status === 'completed');
    } else if (currentTab === 'not-sent') {
      tabMatch = (status !== 'completed');
    }
    card.classList.toggle('tab-hidden', !tabMatch);

    // 2. Text search check
    const phone = cardPhones.get(imageId) || '';
    const searchMatch = !q
      || imageId.toLowerCase().includes(q)
      || phone.replace(/\D/g, '').includes(q.replace(/\D/g, ''))
      || phone.toLowerCase().includes(q);
    card.classList.toggle('search-hidden', !searchMatch);

    if (tabMatch && searchMatch) visibleCount++;
  }

  // Show/hide no-results message
  if (noResultsEl) noResultsEl.remove();
  noResultsEl = null;
  if (visibleCount === 0 && imageCards.size > 0) {
    noResultsEl = document.createElement('div');
    noResultsEl.className = 'no-results';
    
    if (q) {
      noResultsEl.innerHTML = `<div class="no-results-icon">🔍</div><p>No photos matching <strong>"${q}"</strong></p>`;
    } else {
       const tabName = currentTab === 'sent' ? 'Sent' : 'Not Sent';
       noResultsEl.innerHTML = `<div class="no-results-icon">📁</div><p>No <strong>${tabName}</strong> photos yet.</p>`;
    }
    queueList.appendChild(noResultsEl);
  }
}

// Tab Switcher logic
const tabBtns = document.querySelectorAll('.tab-btn');
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    // Update active state
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Set filter and apply
    currentTab = btn.dataset.filter;
    applySearch();
  });
});

searchInput.addEventListener('input', () => {
  const q = searchInput.value;
  searchClear.style.display = q ? 'inline-flex' : 'none';
  applySearch(q);
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.style.display = 'none';
  applySearch('');
  searchInput.focus();
});

// Allow Escape key to clear search
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') searchClear.click();
});

btnClearLog.addEventListener('click', () => { logOutput.innerHTML = ''; });

btnToggleLog.addEventListener('click', () => {
  const visible = contentArea.classList.toggle('log-visible');
  btnToggleLog.textContent = visible ? '📋 Hide Log' : '📋 Log';
  btnToggleLog.style.color = visible ? 'var(--accent)' : '';
});



// ── Init ──────────────────────────────────────────────────────────────────────

(async () => {
  const dbStatus = await window.api.getDbStatus();
  if (dbStatus.connected) {
    dbDot.className  = 'status-dot connected';
    dbStatusText.textContent = 'Connected';
    refreshStats();
  }

  // Get active frame status on start
  try {
    const { activeFrame: initialActiveFrame } = await window.api.getFrames();
    activeFrame = initialActiveFrame;
  } catch (err) {
    console.warn('Failed to get initial active frame:', err);
  }

  // Restore last-used folder from config
  const saved = await window.api.getSavedFolder();
  if (saved) {
    selectedFolder = saved;
    folderPathText.textContent = saved;
    btnWatch.disabled = false;
    appendLog({ level: 'info', message: `📁 Restored folder: ${saved}`, ts: new Date().toISOString() });

    // Sync UI if the backend is already watching the folder (e.g. after a page reload)
    const isAlreadyWatching = await window.api.isWatching();
    if (isAlreadyWatching) {
      isWatching = true;
      document.body.classList.add('watching');
      btnWatch.style.display = 'none';
      btnStop.style.display  = 'inline-flex';
      appendLog({ level: 'info', message: '👁️  Resumed watching session', ts: new Date().toISOString() });
    }
  }

  updateCardActions();
  appendLog({ level: 'info', message: '🚀 WhatsApp Booth Uploader ready', ts: new Date().toISOString() });
})();

// ── Navigation & Frames ────────────────────────────────────────────────────────

const navQueue = document.getElementById('nav-queue');
const navFrames = document.getElementById('nav-frames');
const panelQueue = document.getElementById('panel-queue');
const panelFrames = document.getElementById('panel-frames');
const btnUploadFrame = document.getElementById('btn-upload-frame');
const framesList = document.getElementById('frames-list');

if (navQueue && navFrames) {
  navQueue.addEventListener('click', () => {
    navQueue.classList.add('active');
    navFrames.classList.remove('active');
    panelQueue.style.display = 'flex';
    panelFrames.style.display = 'none';
  });

  navFrames.addEventListener('click', () => {
    navFrames.classList.add('active');
    navQueue.classList.remove('active');
    panelFrames.style.display = 'flex';
    panelQueue.style.display = 'none';
    loadFrames();
  });
}

if (btnUploadFrame) {
  btnUploadFrame.addEventListener('click', async () => {
    const newFrame = await window.api.uploadFrame();
    if (newFrame) loadFrames();
  });
}

async function loadFrames() {
  if (!framesList) return;
  const { frames, activeFrame: backendActiveFrame, framesDir } = await window.api.getFrames();
  activeFrame = backendActiveFrame;
  framesList.innerHTML = '';
  
  if (frames.length === 0) {
    framesList.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-icon">🖼️</div>
        <p>No frames uploaded yet.</p>
      </div>
    `;
    updateCardActions();
    return;
  }
  
  frames.forEach(frame => {
    const isActive = frame === activeFrame;
    const card = document.createElement('div');
    card.className = `queue-card frame-card ${isActive ? 'active-frame' : ''}`;
    
    card.style.cursor = 'pointer';
    card.title = 'Click to set as active';
    
    // File URL for local image
    const fileUrl = `file://${framesDir}/${frame}`;
    
    card.innerHTML = `
      <div class="card-preview frame-preview">
        <img src="${fileUrl}" style="width:100%; height:100%; object-fit:contain; z-index:1;" />
      </div>
      <div class="card-footer" style="display:flex; justify-content:space-between; align-items:center;">
        <div class="card-id" style="text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${frame}</div>
        <button class="btn btn-ghost btn-delete-frame" style="color:var(--error); padding:4px 8px; font-size:12px;">Delete</button>
      </div>
    `;
    
    // Make entire card clickable to set active
    card.addEventListener('click', async () => {
      await window.api.setActiveFrame(isActive ? null : frame); // toggle off if already active
      loadFrames();
    });
    
    // Delete btn
    card.querySelector('.btn-delete-frame').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Delete frame ${frame}?`)) {
        await window.api.deleteFrame(frame);
        loadFrames();
      }
    });
    
    framesList.appendChild(card);
  });
  updateCardActions();
}

