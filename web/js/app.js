import { createBleController, isWebBluetoothSupported, isNativePlatform } from './ble.js';
import { GESTURE_LABELS } from './protocol.js';
import { saveRecording, listRecordings, deleteRecording } from './db.js';
import { exportCSVNative } from './export-native.js';

const SCENES = {
  '民宿清扫': {
    tasks: ['换布草', '整理床铺', '吸尘', '拖地', '清洁卫生间', '擦拭家具', '垃圾处理'],
    tools: ['吸尘器', '湿巾拖把', '干拖把', '床单被套', '枕套', '抹布', '清洁剂喷瓶'],
  },
  '家庭烹饪': {
    tasks: ['炒菜翻炒', '备菜切割', '洗菜', '搅拌调味', '装盘', '开关灶具'],
    tools: ['炒锅铲', '菜刀', '汤勺', '筷子', '案板', '锅把'],
  },
  '家庭清洁': {
    tasks: ['洗碗', '擦灶台', '清洁水槽', '拖地', '擦窗'],
    tools: ['洗碗刷', '海绵', '抹布', '拖把', '清洁手套'],
  },
  '洗涤整理': {
    tasks: ['手洗衣物', '晾晒', '叠衣', '拧干'],
    tools: ['衣物', '衣架', '洗衣盆'],
  },
};

const CH = 8, WAVE_LEN = 200;
const CH_HEX = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#2fae2f', '#9085e9', '#e66767'];
const CH_COLORS = ['--ch0', '--ch1', '--ch2', '--ch3', '--ch4', '--ch5', '--ch6', '--ch7'];

let selScene = null, selTask = null, selTool = null;
let isRecording = false;
let samples = 0;
let recRows = [];
let waveBuf = Array.from({ length: CH }, () => new Array(WAVE_LEN).fill(128));

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
  btn.innerHTML = scanning ? '<span class="spin">⟳</span> 连接中...' : btn.textContent;
}

function showTab(name, el) {
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
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
    document.getElementById('btn-scan').textContent = '重新扫描';
    document.getElementById('conn-name').textContent = ble.getDeviceName();
    document.getElementById('conn-addr').textContent = isNativePlatform() ? 'Android 原生蓝牙' : 'Web Bluetooth';
    info.classList.add('show');
  } else {
    dot.className = 'dot';
    txt.textContent = '未连接';
    disc.style.display = 'none';
    document.getElementById('btn-scan').textContent = '扫描 gForce 设备';
    info.classList.remove('show');
  }
  updateRecStatus();
}

async function scanDevice() {
  if (!isNativePlatform() && !isWebBluetoothSupported()) {
    alert('此浏览器不支持 Web Bluetooth。\n请使用 Android Chrome，或安装本项目打包的 Android App。');
    return;
  }
  setStatus('正在选择设备...', true);
  try {
    await ble.connect();
    setStatus('已连接，正在查询设备能力…', true);
    ble.onDisconnect(() => {
      if (isRecording) stopRec();
      updateConnUI();
      setStatus('设备已断开', false);
    });
    await ble.queryDiagnostics();
    setStatus('已连接，正在启用 EMG 数据…', true);
    await ble.enableEmg({ sampleRate: 500, channelMask: 0xFF, packetLen: 128, resolution: 8 });
    setStatus('已连接，EMG 已启用，可开始录制', false);
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
  setStatus('设备已断开', false);
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
  const label = GESTURE_LABELS[g.gestureId] || ('手势' + g.gestureId);
  const raw = Array.from(g.raw).map((b) => b.toString(16).padStart(2, '0')).join(' ');
  document.getElementById('gest-val').textContent = label + '  [' + raw + ']';
});

function pickScene(scene, el) {
  selScene = scene; selTask = null; selTool = null;
  document.querySelectorAll('#scene-chips .chip').forEach((c) => c.classList.remove('active'));
  el.classList.add('active');
  const cfg = SCENES[scene];
  document.getElementById('task-chips').innerHTML = cfg.tasks.map((t) =>
    `<div class="chip" onclick="pickChip('task','${t}',this)">${t}</div>`).join('');
  document.getElementById('tool-chips').innerHTML = cfg.tools.map((t) =>
    `<div class="chip" onclick="pickChip('tool','${t}',this)">${t}</div>`).join('');
  updateRecStatus();
}
window.pickScene = pickScene;

function pickChip(type, val, el) {
  const grp = el.parentElement;
  grp.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
  el.classList.add('active');
  if (type === 'task') selTask = val; else selTool = val;
  updateRecStatus();
}
window.pickChip = pickChip;

function updateRecStatus() {
  const s = document.getElementById('rec-status');
  if (!ble.isConnected()) { s.textContent = '请先连接设备'; s.className = 'rec-status'; return; }
  if (!selScene) { s.textContent = '请选择场景'; s.className = 'rec-status'; return; }
  if (!selTask) { s.textContent = '请选择工序'; s.className = 'rec-status'; return; }
  if (!selTool) { s.textContent = '请选择工具'; s.className = 'rec-status'; return; }
  s.textContent = `✓ 准备录制：${selTask} · ${selTool}`;
  s.className = 'rec-status ready';
}

function toggleRec() {
  if (isRecording) { stopRec(); return; }
  if (!ble.isConnected()) { alert('请先连接设备'); return; }
  if (!selTask || !selTool) { alert('请选择工序和工具'); return; }
  startRec();
}
window.toggleRec = toggleRec;

function startRec() {
  recRows = []; samples = 0;
  isRecording = true;
  document.getElementById('cnt').textContent = '0';
  const btn = document.getElementById('btn-rec');
  btn.textContent = '⏹ 停止录制';
  btn.style.background = 'var(--rec)';
  document.getElementById('rec-pill').classList.add('show');
  document.getElementById('dot').className = 'dot rec';
}

function stopRec() {
  isRecording = false;
  const btn = document.getElementById('btn-rec');
  btn.textContent = '▶ 开始录制';
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
  const safe = (s) => s.replace(/[^a-zA-Z0-9一-鿿]/g, '_');
  const note = document.getElementById('note').value;
  const fname = `emg_${ts}_${safe(selTask)}_${safe(selTool)}.csv`;

  const header = 'timestamp,time_str,scene,task,tool,note,' + Array.from({ length: CH }, (_, i) => 'ch' + i).join(',') + '\n';
  const rows = recRows.map((r) => {
    const d = new Date(r.ts);
    const tstr = d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
    return [r.ts / 1000, tstr, selScene, selTask, selTool, note || '', ...r.row].map(csvField).join(',');
  }).join('\n');
  const csvText = header + rows;

  const record = {
    id: 'rec_' + now.getTime(),
    filename: fname,
    createdAt: now.getTime(),
    scene: selScene, task: selTask, tool: selTool, note,
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
  if (!files.length) { el.innerHTML = '<div class="empty">暂无文件<br><small>录制停止后自动保存</small></div>'; return; }
  el.innerHTML = files.map((f) => `
    <div class="file-item">
      <div class="file-name" title="${f.filename}">${f.filename}</div>
      <div class="file-meta">${f.sampleCount}样本·${f.sizeKB}KB</div>
      <button class="file-dl" data-id="${f.id}" data-action="dl">下载</button>
      <button class="file-dl" data-id="${f.id}" data-action="del" style="color:var(--rec);border-color:var(--rec)">删除</button>
    </div>`).join('');
  el.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const rec = files.find((f) => f.id === btn.dataset.id);
      if (!rec) return;
      if (btn.dataset.action === 'dl') exportCSV(rec.filename, rec.csvText);
      else { await deleteRecording(rec.id); renderFiles(); }
    });
  });
}

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

buildChCards();
resizeCanvas();
drawWave();
window.addEventListener('resize', resizeCanvas);
updateRecStatus();
updateConnUI();
initInterleaveToggle();
registerServiceWorker();
