import { createBleController, isWebBluetoothSupported, isNativePlatform } from './ble.js';
import * as proto from './protocol.js';
import { saveRecording, listRecordings, deleteRecording } from './db.js';
import { exportCSVNative } from './export-native.js';
import { t, getLang, setLang, tScene, tTask, tTool, tGesture, SCENE_DEFS } from './i18n.js';

const CH = 8, WAVE_LEN = 200;
const CH_HEX = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#2fae2f', '#9085e9', '#e66767'];
const CH_COLORS = ['--ch0', '--ch1', '--ch2', '--ch3', '--ch4', '--ch5', '--ch6', '--ch7'];

// selScene/selTask/selTool hold canonical ids (e.g. 'cleaning') for preset entries, or the raw
// typed string itself for user-added custom tags (which have no id/translation split — they
// display exactly as entered). Resolving to a display label always goes through tScene/tTask/tTool,
// which fall back to returning the id unchanged when it isn't a known preset.
let selSceneId = null, selTaskId = null, selToolId = null;
let isRecording = false;
let samples = 0;
let recRows = [];
let waveBuf = Array.from({ length: CH }, () => new Array(WAVE_LEN).fill(128));

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function saveJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ }
}

const LS_CUSTOM_SCENES = 'emg_custom_scenes';
const LS_CUSTOM_TASKS = 'emg_custom_tasks';
const LS_CUSTOM_TOOLS = 'emg_custom_tools';
const LS_CUSTOM_FIELDS = 'emg_custom_fields';

let customScenes = loadJSON(LS_CUSTOM_SCENES, []);
let customTasks = loadJSON(LS_CUSTOM_TASKS, {});
let customTools = loadJSON(LS_CUSTOM_TOOLS, {});
let customFields = loadJSON(LS_CUSTOM_FIELDS, []); // [{name,value}] — extra CSV columns for this and future recordings

function saveCustomTags() {
  saveJSON(LS_CUSTOM_SCENES, customScenes);
  saveJSON(LS_CUSTOM_TASKS, customTasks);
  saveJSON(LS_CUSTOM_TOOLS, customTools);
}
function saveCustomFields() { saveJSON(LS_CUSTOM_FIELDS, customFields); }

function dbgLog(msg, clear = false) {
  const el = document.getElementById('dbg-log');
  const time = new Date().toTimeString().slice(0, 8);
  if (clear) { el.textContent = msg; return; }
  el.textContent += '\n[' + time + '] ' + msg;
  el.scrollTop = el.scrollHeight;
  console.log('[BLE]', msg);
}

const ble = createBleController({ log: dbgLog });

function setStatus(msg, scanning) {
  document.getElementById('scan-status').textContent = msg;
  dbgLog(msg);
  const btn = document.getElementById('btn-scan');
  btn.disabled = !!scanning;
  btn.innerHTML = scanning ? '<span class="spin">⟳</span> ' + t('btn_scanning') : btn.textContent;
}

function showTab(name, el) {
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach((tb) => tb.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  el.classList.add('active');
  if (name === 'files') renderFiles();
  if (name === 'wave') resizeCanvas();
}
window.showTab = showTab;

function updateConnUI() {
  const dot = document.getElementById('dot');
  const txt = document.getElementById('conn-txt');
  const disc = document.getElementById('btn-disc');
  const info = document.getElementById('conn-info');
  if (ble.isConnected()) {
    dot.className = 'dot on';
    txt.textContent = ble.getDeviceName();
    disc.style.display = '';
    document.getElementById('btn-scan').textContent = t('btn_scan_rescan');
    document.getElementById('conn-name').textContent = ble.getDeviceName();
    document.getElementById('conn-addr').textContent = isNativePlatform() ? t('conn_native') : t('conn_web');
    info.classList.add('show');
  } else {
    dot.className = 'dot';
    txt.textContent = t('status_not_connected');
    disc.style.display = 'none';
    document.getElementById('btn-scan').textContent = t('btn_scan');
    info.classList.remove('show');
  }
  updateRecStatus();
}

async function scanDevice() {
  if (!isNativePlatform() && !isWebBluetoothSupported()) {
    alert(t('status_web_bt_unsupported'));
    return;
  }
  setStatus(t('status_selecting_device'), true);
  try {
    await ble.connect();
    setStatus(t('status_querying_caps'), true);
    ble.onDisconnect(() => {
      if (isRecording) stopRec();
      updateConnUI();
      setStatus(t('status_disconnected'), false);
    });
    await ble.queryDiagnostics();
    setStatus(t('status_enabling_emg'), true);
    await ble.enableEmg({ sampleRate: 500, channelMask: 0xFF, packetLen: 128, resolution: 8 });
    setStatus(t('status_ready'), false);
    updateConnUI();
  } catch (e) {
    console.error('connect/enable failed', e);
    setStatus('❌ ' + e.message, false);
    try { await ble.disconnect(); } catch (_) {}
    updateConnUI();
  }
}
window.scanDevice = scanDevice;

async function doDisconnect() {
  if (isRecording) stopRec();
  await ble.disconnect();
  updateConnUI();
  setStatus(t('status_disconnected'), false);
}
window.doDisconnect = doDisconnect;

ble.onEmgData((sampleRows) => {
  const n = sampleRows.length;
  const intervalMs = 1000 / (ble.getEmgConfig().sampleRate || 500);
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    const row = sampleRows[i];
    for (let c = 0; c < CH; c++) {
      const v = row[c] !== undefined ? row[c] : 128;
      waveBuf[c].push(v);
      waveBuf[c].shift();
    }
    if (isRecording) {
      const ts = now - (n - 1 - i) * intervalMs;
      recRows.push({ ts, row: row.slice(0, CH) });
      samples++;
    }
  }
  if (isRecording) document.getElementById('cnt').textContent = samples.toLocaleString();
  updateChCards(sampleRows[n - 1] || []);
});

ble.onGesture((g) => {
  const gid = proto.GESTURE_IDS[g.gestureId];
  const label = gid ? tGesture(gid) : (t('gesture_unknown_prefix') + g.gestureId);
  const raw = Array.from(g.raw).map((b) => b.toString(16).padStart(2, '0')).join(' ');
  document.getElementById('gest-val').textContent = label + '  [' + raw + ']';
});

// ── Scene/Task/Tool chips (presets translated via i18n.js, plus user-added custom tags) ──

function makeChip(id, label, active, onClick) {
  const div = document.createElement('div');
  div.className = 'chip' + (active ? ' active' : '');
  div.textContent = label;
  div.addEventListener('click', () => onClick(id));
  return div;
}

function makeAddChip(onClick) {
  const div = document.createElement('div');
  div.className = 'chip chip-add';
  div.textContent = t('chip_custom');
  div.addEventListener('click', onClick);
  return div;
}

function renderSceneChips() {
  const wrap = document.getElementById('scene-chips');
  wrap.innerHTML = '';
  Object.keys(SCENE_DEFS).forEach((id) => {
    const label = SCENE_DEFS[id].emoji + ' ' + tScene(id);
    wrap.appendChild(makeChip(id, label, id === selSceneId, pickScene));
  });
  customScenes.forEach((val) => {
    wrap.appendChild(makeChip(val, val, val === selSceneId, pickScene));
  });
  wrap.appendChild(makeAddChip(addCustomScene));
}

function renderTaskChips() {
  const wrap = document.getElementById('task-chips');
  wrap.innerHTML = '';
  if (!selSceneId) {
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:12px;color:var(--muted)';
    hint.textContent = t('select_scene_first');
    wrap.appendChild(hint);
    return;
  }
  const presetIds = SCENE_DEFS[selSceneId] ? SCENE_DEFS[selSceneId].tasks : [];
  presetIds.forEach((id) => {
    wrap.appendChild(makeChip(id, tTask(id), id === selTaskId, pickTask));
  });
  (customTasks[selSceneId] || []).forEach((val) => {
    wrap.appendChild(makeChip(val, val, val === selTaskId, pickTask));
  });
  wrap.appendChild(makeAddChip(addCustomTask));
}

function renderToolChips() {
  const wrap = document.getElementById('tool-chips');
  wrap.innerHTML = '';
  if (!selSceneId) {
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:12px;color:var(--muted)';
    hint.textContent = t('select_scene_first');
    wrap.appendChild(hint);
    return;
  }
  const presetIds = SCENE_DEFS[selSceneId] ? SCENE_DEFS[selSceneId].tools : [];
  presetIds.forEach((id) => {
    wrap.appendChild(makeChip(id, tTool(id), id === selToolId, pickTool));
  });
  (customTools[selSceneId] || []).forEach((val) => {
    wrap.appendChild(makeChip(val, val, val === selToolId, pickTool));
  });
  wrap.appendChild(makeAddChip(addCustomTool));
}

function pickScene(id) {
  selSceneId = id; selTaskId = null; selToolId = null;
  renderSceneChips();
  renderTaskChips();
  renderToolChips();
  updateRecStatus();
}

function pickTask(id) {
  selTaskId = id;
  renderTaskChips();
  updateRecStatus();
}

function pickTool(id) {
  selToolId = id;
  renderToolChips();
  updateRecStatus();
}

function addCustomScene() {
  const name = (prompt(t('prompt_custom_scene')) || '').trim();
  if (!name) return;
  if (!SCENE_DEFS[name] && !customScenes.includes(name)) customScenes.push(name);
  saveCustomTags();
  pickScene(name);
}

function addCustomTask() {
  if (!selSceneId) return;
  const name = (prompt(t('prompt_custom_task')) || '').trim();
  if (!name) return;
  if (!customTasks[selSceneId]) customTasks[selSceneId] = [];
  if (!customTasks[selSceneId].includes(name)) customTasks[selSceneId].push(name);
  saveCustomTags();
  pickTask(name);
}

function addCustomTool() {
  if (!selSceneId) return;
  const name = (prompt(t('prompt_custom_tool')) || '').trim();
  if (!name) return;
  if (!customTools[selSceneId]) customTools[selSceneId] = [];
  if (!customTools[selSceneId].includes(name)) customTools[selSceneId].push(name);
  saveCustomTags();
  pickTool(name);
}

function updateRecStatus() {
  const s = document.getElementById('rec-status');
  if (!ble.isConnected()) { s.textContent = t('rec_need_device'); s.className = 'rec-status'; return; }
  if (!selSceneId) { s.textContent = t('rec_need_scene'); s.className = 'rec-status'; return; }
  if (!selTaskId) { s.textContent = t('rec_need_task'); s.className = 'rec-status'; return; }
  if (!selToolId) { s.textContent = t('rec_need_tool'); s.className = 'rec-status'; return; }
  s.textContent = t('rec_ready', { task: tTask(selTaskId), tool: tTool(selToolId) });
  s.className = 'rec-status ready';
}

function toggleRec() {
  if (isRecording) { stopRec(); return; }
  if (!ble.isConnected()) { alert(t('alert_need_device')); return; }
  if (!selTaskId || !selToolId) { alert(t('alert_need_task_tool')); return; }
  startRec();
}
window.toggleRec = toggleRec;

function startRec() {
  recRows = []; samples = 0;
  isRecording = true;
  document.getElementById('cnt').textContent = '0';
  const btn = document.getElementById('btn-rec');
  btn.textContent = t('btn_stop_rec');
  btn.style.background = 'var(--rec)';
  document.getElementById('rec-pill').classList.add('show');
  document.getElementById('dot').className = 'dot rec';
}

function stopRec() {
  isRecording = false;
  const btn = document.getElementById('btn-rec');
  btn.textContent = t('btn_start_rec');
  btn.style.background = '';
  document.getElementById('rec-pill').classList.remove('show');
  document.getElementById('dot').className = 'dot' + (ble.isConnected() ? ' on' : '');
  if (recRows.length > 0) persistCSV();
}

function csvField(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

async function persistCSV() {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  // Allow CJK ideographs, hiragana/katakana (incl. the katakana long-vowel mark) in filenames
  // too, now that scene/task/tool labels can be in Japanese as well as Chinese/English.
  const safe = (s) => s.replace(/[^a-zA-Z0-9一-鿿ぁ-んァ-ヶー]/g, '_');
  const note = document.getElementById('note').value;
  const sceneLabel = selSceneId ? tScene(selSceneId) : '';
  const taskLabel = selTaskId ? tTask(selTaskId) : '';
  const toolLabel = selToolId ? tTool(selToolId) : '';
  const fields = customFields.filter((f) => f.name.trim());
  const fname = `emg_${ts}_${safe(taskLabel)}_${safe(toolLabel)}.csv`;

  const header = ['timestamp', 'time_str', 'scene', 'task', 'tool', 'note', ...fields.map((f) => f.name.trim()), ...Array.from({ length: CH }, (_, i) => 'ch' + i)]
    .map(csvField).join(',') + '\n';
  const rows = recRows.map((r) => {
    const d = new Date(r.ts);
    const tstr = d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
    return [r.ts / 1000, tstr, sceneLabel, taskLabel, toolLabel, note || '', ...fields.map((f) => f.value), ...r.row].map(csvField).join(',');
  }).join('\n');
  const csvText = header + rows;

  const record = {
    id: 'rec_' + now.getTime(),
    filename: fname,
    createdAt: now.getTime(),
    scene: sceneLabel, task: taskLabel, tool: toolLabel, note,
    sampleCount: recRows.length,
    sizeKB: Math.round((csvText.length / 1024) * 10) / 10,
    csvText,
  };
  try {
    await saveRecording(record);
  } catch (e) {
    console.error('IndexedDB save failed', e);
  }
  // Auto-download-on-stop only makes sense in a real browser (silent, no dialog). Inside the
  // Android app shell, exporting means popping the native share sheet, which would interrupt
  // a rapid back-to-back recording workflow — leave that to the explicit "下载" button instead.
  if (!isNativePlatform()) downloadCSV(fname, csvText);
  renderFiles();
}

function downloadCSV(fname, csvText) {
  const blob = new Blob([csvText], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fname; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function exportCSV(fname, csvText) {
  if (isNativePlatform()) {
    try {
      await exportCSVNative(fname, csvText);
    } catch (e) {
      console.error('native export failed', e);
      alert('导出失败: ' + e.message);
    }
  } else {
    downloadCSV(fname, csvText);
  }
}

window.renderFiles = renderFiles;

async function renderFiles() {
  const el = document.getElementById('files-list');
  let files = [];
  try { files = await listRecordings(); } catch (e) { console.error(e); }
  if (!files.length) {
    el.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = t('files_empty') + '<br><small>' + t('files_empty_hint') + '</small>';
    el.appendChild(empty);
    return;
  }
  el.innerHTML = '';
  files.forEach((f) => {
    const item = document.createElement('div');
    item.className = 'file-item';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'file-name';
    nameDiv.title = f.filename;
    nameDiv.textContent = f.filename;

    const metaDiv = document.createElement('div');
    metaDiv.className = 'file-meta';
    metaDiv.textContent = t('file_meta', { count: f.sampleCount, size: f.sizeKB });

    const dlBtn = document.createElement('button');
    dlBtn.className = 'file-dl';
    dlBtn.textContent = t('btn_download');
    dlBtn.addEventListener('click', () => exportCSV(f.filename, f.csvText));

    const delBtn = document.createElement('button');
    delBtn.className = 'file-dl';
    delBtn.style.color = 'var(--rec)'; delBtn.style.borderColor = 'var(--rec)';
    delBtn.textContent = t('btn_delete');
    delBtn.addEventListener('click', async () => { await deleteRecording(f.id); renderFiles(); });

    item.appendChild(nameDiv); item.appendChild(metaDiv); item.appendChild(dlBtn); item.appendChild(delBtn);
    el.appendChild(item);
  });
}

// ── Custom fields (arbitrary name/value pairs, become extra CSV columns) ──

function renderCustomFields() {
  const wrap = document.getElementById('custom-fields-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  customFields.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'custom-field-row';

    const nameInput = document.createElement('input');
    nameInput.className = 'field-input';
    nameInput.placeholder = t('field_name_placeholder');
    nameInput.value = f.name;
    nameInput.addEventListener('input', () => { customFields[i].name = nameInput.value; saveCustomFields(); });

    const valInput = document.createElement('input');
    valInput.className = 'field-input';
    valInput.placeholder = t('field_value_placeholder');
    valInput.value = f.value;
    valInput.addEventListener('input', () => { customFields[i].value = valInput.value; saveCustomFields(); });

    const rmBtn = document.createElement('button');
    rmBtn.className = 'field-rm';
    rmBtn.textContent = '×';
    rmBtn.addEventListener('click', () => { customFields.splice(i, 1); saveCustomFields(); renderCustomFields(); });

    row.appendChild(nameInput); row.appendChild(valInput); row.appendChild(rmBtn);
    wrap.appendChild(row);
  });
}

function addCustomFieldRow() {
  customFields.push({ name: '', value: '' });
  saveCustomFields();
  renderCustomFields();
}
window.addCustomFieldRow = addCustomFieldRow;

const canvas = document.getElementById('wave-canvas');
const ctx = canvas.getContext('2d');

function buildChCards() {
  const grid = document.getElementById('ch-grid');
  grid.innerHTML = Array.from({ length: CH }, (_, i) => `
    <div class="ch-card" style="border-left-color:var(${CH_COLORS[i]})">
      <div class="ch-color" style="background:var(${CH_COLORS[i]})"></div>
      <div class="ch-label">CH${i}</div>
      <div class="ch-val" id="cv${i}">—</div>
    </div>`).join('');
}

function updateChCards(lastRow) {
  for (let i = 0; i < CH; i++) {
    const el = document.getElementById('cv' + i);
    if (el) el.textContent = lastRow[i] !== undefined ? lastRow[i] : '—';
  }
}

function resizeCanvas() {
  canvas.width = canvas.offsetWidth * window.devicePixelRatio;
  canvas.height = canvas.offsetHeight * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

function drawWave() {
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  if (!W || !H) { requestAnimationFrame(drawWave); return; }
  ctx.clearRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(255,255,255,.04)';
  ctx.lineWidth = .5;
  for (let i = 1; i < CH; i++) {
    const y = (i / CH) * H;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  const slotH = H / CH, step = W / WAVE_LEN;
  for (let ch = 0; ch < CH; ch++) {
    const buf = waveBuf[ch];
    const midY = (ch + .5) * slotH, amp = slotH * .42;
    ctx.strokeStyle = CH_HEX[ch];
    ctx.lineWidth = 1.5;
    ctx.shadowColor = isRecording ? CH_HEX[ch] : 'transparent';
    ctx.shadowBlur = isRecording ? 2 : 0;
    ctx.beginPath();
    for (let i = 0; i < WAVE_LEN; i++) {
      const x = i * step, v = ((buf[i] - 128) / 128) * amp, y = midY - v;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = CH_HEX[ch];
    ctx.font = '10px monospace';
    ctx.fillText('CH' + ch, 3, ch * slotH + 12);
  }
  requestAnimationFrame(drawWave);
}

function initInterleaveToggle() {
  const sel = document.getElementById('interleave-mode');
  if (!sel) return;
  sel.addEventListener('change', () => ble.setInterleaved(sel.value === 'sample'));
}

async function registerServiceWorker() {
  if (isNativePlatform() || !('serviceWorker' in navigator)) return;
  try { await navigator.serviceWorker.register('./sw.js'); } catch (e) { console.warn('SW register failed', e); }
}

// ── i18n wiring ──

function applyInterleaveOptions() {
  const sel = document.getElementById('interleave-mode');
  if (!sel) return;
  sel.options[0].textContent = t('interleave_sample');
  sel.options[1].textContent = t('interleave_channel');
}

function applyStaticI18n() {
  document.title = 'EMG ' + t('header_suffix');
  document.getElementById('header-suffix').textContent = t('header_suffix');
  document.getElementById('cnt-label').textContent = t('cnt_label');
  document.getElementById('notice-title').textContent = t('notice_title');
  document.getElementById('notice-body').innerHTML = t('notice_body');
  document.getElementById('device-label').textContent = t('device_label');
  document.getElementById('debug-log-title').textContent = t('debug_log_title');
  document.getElementById('debug-log-hint').textContent = t('debug_log_hint');
  document.getElementById('section-scene').textContent = t('section_scene');
  document.getElementById('section-task').textContent = t('section_task');
  document.getElementById('section-tool').textContent = t('section_tool');
  document.getElementById('section-note').textContent = t('section_note');
  document.getElementById('note').placeholder = t('note_placeholder');
  document.getElementById('section-custom-fields').textContent = t('section_custom_fields');
  document.getElementById('btn-add-field').textContent = t('btn_add_field');
  document.getElementById('gesture-label').textContent = t('gesture_label');
  document.getElementById('interleave-label').textContent = t('interleave_label');
  applyInterleaveOptions();
  document.getElementById('files-title').textContent = t('files_title');
  document.getElementById('btn-refresh').textContent = t('btn_refresh');
  document.getElementById('nav-connect').textContent = t('nav_connect');
  document.getElementById('nav-record').textContent = t('nav_record');
  document.getElementById('nav-wave').textContent = t('nav_wave');
  document.getElementById('nav-files').textContent = t('nav_files');
  document.getElementById('btn-rec').textContent = isRecording ? t('btn_stop_rec') : t('btn_start_rec');
}

// Full re-render on language switch. The debug log panel is deliberately excluded — its
// accumulated content is developer-facing diagnostic text (see i18n.js's top comment) and
// stays in whatever language it was logged in rather than being retroactively rewritten.
function refreshUI() {
  applyStaticI18n();
  renderSceneChips();
  renderTaskChips();
  renderToolChips();
  renderCustomFields();
  updateConnUI();
  document.getElementById('scan-status').textContent = ble.isConnected() ? t('status_ready') : t('scan_hint_default');
  renderFiles();
}

function initLangSelect() {
  const sel = document.getElementById('lang-select');
  if (!sel) return;
  sel.value = getLang();
  sel.addEventListener('change', () => {
    setLang(sel.value);
    refreshUI();
  });
}

buildChCards();
resizeCanvas();
drawWave();
window.addEventListener('resize', resizeCanvas);
initLangSelect();
applyStaticI18n();
document.getElementById('dbg-log').textContent = t('debug_log_waiting');
document.getElementById('scan-status').textContent = t('scan_hint_default');
renderSceneChips();
renderTaskChips();
renderToolChips();
renderCustomFields();
updateRecStatus();
updateConnUI();
initInterleaveToggle();
registerServiceWorker();
