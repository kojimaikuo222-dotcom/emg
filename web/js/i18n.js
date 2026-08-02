// Trilingual (zh/ja/en) UI text. Two kinds of content:
//  - UI: static interface strings (buttons, section titles, status messages), looked up by t().
//  - *_DEFS: canonical id -> {zh,ja,en} label for the preset scene/task/tool/gesture vocabulary,
//    looked up by tScene()/tTask()/tTool()/tGesture(). User-added custom tags have no id-based
//    translation — they're plain strings displayed exactly as typed, in whichever language the
//    user entered them.
// The debug log panel (BLE connection/protocol diagnostics) is intentionally left in Chinese —
// it's a developer/troubleshooting surface, not part of the customer-facing demo UI this exists
// to support.

export const LANGS = ['zh', 'ja', 'en'];
const STORAGE_KEY = 'emg_lang';

function detectDefaultLang() {
  const nav = (navigator.language || 'zh').toLowerCase();
  if (nav.startsWith('ja')) return 'ja';
  if (nav.startsWith('zh')) return 'zh';
  if (nav.startsWith('en')) return 'en';
  return 'zh';
}

// A "?lang=ja" link is handy for sending a customer/prospect a demo pre-set to their
// language (e.g. for a sales visit) without them touching the switcher themselves.
function detectUrlLang() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    return LANGS.includes(q) ? q : null;
  } catch (e) { return null; }
}

let currentLang = detectUrlLang()
  || (LANGS.includes(localStorage.getItem(STORAGE_KEY)) ? localStorage.getItem(STORAGE_KEY) : null)
  || detectDefaultLang();

export function getLang() { return currentLang; }

export function setLang(lang) {
  if (!LANGS.includes(lang)) return;
  currentLang = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
}

const UI = {
  header_suffix: { zh: '采集', ja: '収集', en: 'Capture' },
  cnt_label: { zh: '采样', ja: 'サンプル', en: 'Samples' },

  notice_title: { zh: '使用须知', ja: '使用上の注意', en: 'Usage Notes' },
  notice_body: {
    zh: 'Android App 内使用原生蓝牙；浏览器内需 Android Chrome（56+）且已开启手机蓝牙。<br>gForcePro+ 开机后绿灯每2秒闪一次即可扫描连接。',
    ja: 'Android アプリ内ではネイティブ Bluetooth を使用します。ブラウザでは Android Chrome（56+）が必要で、Bluetooth をオンにしてください。<br>gForcePro+ は電源を入れて緑ランプが2秒ごとに点滅すればスキャン・接続できます。',
    en: 'The Android App uses native Bluetooth; the browser needs Android Chrome (56+) with Bluetooth turned on.<br>gForcePro+ is ready to scan once its green LED blinks every 2 seconds after power-on.',
  },
  device_label: { zh: '设备', ja: 'デバイス', en: 'Device' },
  scan_hint_default: { zh: '点击下方按钮连接', ja: '下のボタンをタップして接続', en: 'Tap the button below to connect' },
  btn_scan: { zh: '扫描 gForce 设备', ja: 'gForce デバイスをスキャン', en: 'Scan gForce Device' },
  btn_scan_rescan: { zh: '重新扫描', ja: '再スキャン', en: 'Rescan' },
  btn_scanning: { zh: '连接中...', ja: '接続中...', en: 'Connecting...' },
  btn_disconnect: { zh: '断开', ja: '切断', en: 'Disconnect' },
  debug_log_title: { zh: '调试日志', ja: 'デバッグログ', en: 'Debug Log' },
  debug_log_hint: { zh: '（连接问题时展开看）', ja: '（接続に問題がある場合に展開）', en: '(Expand if connection issues)' },
  debug_log_waiting: { zh: '等待操作…', ja: '操作待ち…', en: 'Waiting…' },
  conn_native: { zh: 'Android 原生蓝牙', ja: 'Android ネイティブ Bluetooth', en: 'Android Native Bluetooth' },
  conn_web: { zh: 'Web Bluetooth', ja: 'Web Bluetooth', en: 'Web Bluetooth' },

  status_not_connected: { zh: '未连接', ja: '未接続', en: 'Not Connected' },
  status_web_bt_unsupported: {
    zh: '此浏览器不支持 Web Bluetooth。\n请使用 Android Chrome，或安装本项目打包的 Android App。',
    ja: 'このブラウザは Web Bluetooth に対応していません。\nAndroid Chrome を使用するか、本アプリの Android 版をインストールしてください。',
    en: "This browser doesn't support Web Bluetooth.\nPlease use Android Chrome, or install this app's Android build.",
  },
  status_selecting_device: { zh: '正在选择设备...', ja: 'デバイスを選択中...', en: 'Selecting device...' },
  status_querying_caps: { zh: '已连接，正在查询设备能力…', ja: '接続済み、デバイス機能を確認中…', en: 'Connected, querying device capabilities…' },
  status_enabling_emg: { zh: '已连接，正在启用 EMG 数据…', ja: '接続済み、EMGデータを有効化中…', en: 'Connected, enabling EMG data…' },
  status_ready: { zh: '已连接，EMG 已启用，可开始录制', ja: '接続済み、EMG有効、記録開始できます', en: 'Connected, EMG enabled, ready to record' },
  status_disconnected: { zh: '设备已断开', ja: 'デバイス切断済み', en: 'Device disconnected' },

  section_scene: { zh: '场景', ja: 'シーン', en: 'Scene' },
  section_task: { zh: '工序', ja: '工程', en: 'Task' },
  section_tool: { zh: '工具', ja: '道具', en: 'Tool' },
  section_note: { zh: '备注（可选）', ja: 'メモ（任意）', en: 'Note (optional)' },
  note_placeholder: { zh: '如：左手、疲劳状态…', ja: '例：左手、疲労状態…', en: 'e.g. left hand, fatigue…' },
  select_scene_first: { zh: '请先选择场景', ja: '先にシーンを選択してください', en: 'Please select a scene first' },

  section_custom_fields: { zh: '自定义字段', ja: 'カスタムフィールド', en: 'Custom Fields' },
  btn_add_field: { zh: '+ 添加字段', ja: '+ フィールド追加', en: '+ Add Field' },
  field_name_placeholder: { zh: '字段名', ja: 'フィールド名', en: 'Field name' },
  field_value_placeholder: { zh: '值', ja: '値', en: 'Value' },

  chip_custom: { zh: '+ 自定义', ja: '+ カスタム', en: '+ Custom' },
  prompt_custom_scene: { zh: '输入自定义场景名称', ja: 'カスタムシーン名を入力', en: 'Enter custom scene name' },
  prompt_custom_task: { zh: '输入自定义工序名称', ja: 'カスタム工程名を入力', en: 'Enter custom task name' },
  prompt_custom_tool: { zh: '输入自定义工具名称', ja: 'カスタム道具名を入力', en: 'Enter custom tool name' },

  btn_start_rec: { zh: '▶ 开始录制', ja: '▶ 記録開始', en: '▶ Start Recording' },
  btn_stop_rec: { zh: '⏹ 停止录制', ja: '⏹ 記録停止', en: '⏹ Stop Recording' },
  rec_need_device: { zh: '请先连接设备', ja: '先にデバイスを接続してください', en: 'Please connect a device first' },
  rec_need_scene: { zh: '请选择场景', ja: 'シーンを選択してください', en: 'Please select a scene' },
  rec_need_task: { zh: '请选择工序', ja: '工程を選択してください', en: 'Please select a task' },
  rec_need_tool: { zh: '请选择工具', ja: '道具を選択してください', en: 'Please select a tool' },
  rec_ready: { zh: '✓ 准备录制：{task} · {tool}', ja: '✓ 記録準備完了：{task}・{tool}', en: '✓ Ready to record: {task} · {tool}' },
  alert_need_device: { zh: '请先连接设备', ja: '先にデバイスを接続してください', en: 'Please connect a device first' },
  alert_need_task_tool: { zh: '请选择工序和工具', ja: '工程と道具を選択してください', en: 'Please select a task and tool' },

  gesture_label: { zh: '识别手势', ja: 'ジェスチャー認識', en: 'Gesture' },
  interleave_label: { zh: '采样交织方式', ja: 'サンプル配列方式', en: 'Sample Interleaving' },
  interleave_sample: { zh: '按采样点交织（默认）', ja: 'サンプル単位で交互配置（デフォルト）', en: 'Interleaved by sample (default)' },
  interleave_channel: { zh: '按通道分块', ja: 'チャンネルごとにブロック化', en: 'Grouped by channel' },

  files_title: { zh: '已保存 CSV', ja: '保存済み CSV', en: 'Saved CSV' },
  btn_refresh: { zh: '刷新', ja: '更新', en: 'Refresh' },
  files_empty: { zh: '暂无文件', ja: 'ファイルなし', en: 'No files' },
  files_empty_hint: { zh: '录制停止后自动保存', ja: '記録停止後に自動保存', en: 'Auto-saved when recording stops' },
  btn_download: { zh: '下载', ja: 'ダウンロード', en: 'Download' },
  btn_delete: { zh: '删除', ja: '削除', en: 'Delete' },
  file_meta: { zh: '{count}样本·{size}KB', ja: '{count}サンプル・{size}KB', en: '{count} samples · {size}KB' },

  nav_connect: { zh: '连接', ja: '接続', en: 'Connect' },
  nav_record: { zh: '标注录制', ja: 'ラベル記録', en: 'Label & Record' },
  nav_wave: { zh: '波形', ja: '波形', en: 'Waveform' },
  nav_files: { zh: '文件', ja: 'ファイル', en: 'Files' },

  gesture_unknown_prefix: { zh: '手势', ja: 'ジェスチャー', en: 'Gesture' },
};

export function t(key, vars) {
  const entry = UI[key];
  if (!entry) return key;
  let s = entry[currentLang] || entry.zh || key;
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}

export const SCENE_DEFS = {
  homestay: {
    emoji: '🏨', zh: '民宿清扫', ja: '民泊清掃', en: 'Homestay Cleaning',
    tasks: ['change_linen', 'make_bed', 'vacuum', 'mop', 'clean_bathroom', 'wipe_furniture', 'trash'],
    tools: ['vacuum_cleaner', 'wet_mop', 'dry_mop', 'sheet', 'pillowcase', 'cloth', 'spray_bottle'],
  },
  cooking: {
    emoji: '🍳', zh: '家庭烹饪', ja: '家庭料理', en: 'Home Cooking',
    tasks: ['stir_fry', 'chop', 'wash_veg', 'stir_season', 'plate', 'stove_knob'],
    tools: ['spatula', 'knife', 'ladle', 'chopsticks', 'cutting_board', 'pan_handle'],
  },
  cleaning: {
    emoji: '🧹', zh: '家庭清洁', ja: '家庭清掃', en: 'Home Cleaning',
    tasks: ['wash_dishes', 'wipe_stove', 'clean_sink', 'mop', 'wipe_window'],
    tools: ['dish_brush', 'sponge', 'cloth', 'mop_tool', 'gloves'],
  },
  laundry: {
    emoji: '🧺', zh: '洗涤整理', ja: '洗濯・整理', en: 'Laundry',
    tasks: ['hand_wash', 'dry', 'fold', 'wring'],
    tools: ['clothes', 'hanger', 'wash_basin'],
  },
};

export const TASK_DEFS = {
  change_linen: { zh: '换布草', ja: 'リネン交換', en: 'Change Linens' },
  make_bed: { zh: '整理床铺', ja: 'ベッドメイキング', en: 'Make Bed' },
  vacuum: { zh: '吸尘', ja: '掃除機がけ', en: 'Vacuum' },
  mop: { zh: '拖地', ja: 'モップがけ', en: 'Mop Floor' },
  clean_bathroom: { zh: '清洁卫生间', ja: '浴室掃除', en: 'Clean Bathroom' },
  wipe_furniture: { zh: '擦拭家具', ja: '家具拭き', en: 'Wipe Furniture' },
  trash: { zh: '垃圾处理', ja: 'ゴミ処理', en: 'Trash Handling' },
  stir_fry: { zh: '炒菜翻炒', ja: '炒め物', en: 'Stir Fry' },
  chop: { zh: '备菜切割', ja: '食材カット', en: 'Chop Ingredients' },
  wash_veg: { zh: '洗菜', ja: '野菜洗い', en: 'Wash Vegetables' },
  stir_season: { zh: '搅拌调味', ja: '混ぜて味付け', en: 'Stir & Season' },
  plate: { zh: '装盘', ja: '盛り付け', en: 'Plating' },
  stove_knob: { zh: '开关灶具', ja: 'コンロ操作', en: 'Stove Controls' },
  wash_dishes: { zh: '洗碗', ja: '皿洗い', en: 'Wash Dishes' },
  wipe_stove: { zh: '擦灶台', ja: 'コンロ拭き', en: 'Wipe Stovetop' },
  clean_sink: { zh: '清洁水槽', ja: 'シンク掃除', en: 'Clean Sink' },
  wipe_window: { zh: '擦窗', ja: '窓拭き', en: 'Wipe Windows' },
  hand_wash: { zh: '手洗衣物', ja: '手洗い洗濯', en: 'Hand Wash Clothes' },
  dry: { zh: '晾晒', ja: '物干し', en: 'Hang Dry' },
  fold: { zh: '叠衣', ja: '洗濯物たたみ', en: 'Fold Clothes' },
  wring: { zh: '拧干', ja: '絞る', en: 'Wring Out' },
};

export const TOOL_DEFS = {
  vacuum_cleaner: { zh: '吸尘器', ja: '掃除機', en: 'Vacuum Cleaner' },
  wet_mop: { zh: '湿巾拖把', ja: 'ウェットモップ', en: 'Wet Mop' },
  dry_mop: { zh: '干拖把', ja: 'ドライモップ', en: 'Dry Mop' },
  sheet: { zh: '床单被套', ja: 'シーツ・布団カバー', en: 'Sheets & Duvet Cover' },
  pillowcase: { zh: '枕套', ja: '枕カバー', en: 'Pillowcase' },
  cloth: { zh: '抹布', ja: '雑巾', en: 'Cloth' },
  spray_bottle: { zh: '清洁剂喷瓶', ja: '洗剤スプレーボトル', en: 'Spray Bottle' },
  spatula: { zh: '炒锅铲', ja: 'フライ返し', en: 'Spatula' },
  knife: { zh: '菜刀', ja: '包丁', en: 'Kitchen Knife' },
  ladle: { zh: '汤勺', ja: 'お玉', en: 'Ladle' },
  chopsticks: { zh: '筷子', ja: '箸', en: 'Chopsticks' },
  cutting_board: { zh: '案板', ja: 'まな板', en: 'Cutting Board' },
  pan_handle: { zh: '锅把', ja: '鍋の持ち手', en: 'Pot Handle' },
  dish_brush: { zh: '洗碗刷', ja: '食器洗いブラシ', en: 'Dish Brush' },
  sponge: { zh: '海绵', ja: 'スポンジ', en: 'Sponge' },
  mop_tool: { zh: '拖把', ja: 'モップ', en: 'Mop' },
  gloves: { zh: '清洁手套', ja: '掃除用手袋', en: 'Cleaning Gloves' },
  clothes: { zh: '衣物', ja: '衣類', en: 'Clothes' },
  hanger: { zh: '衣架', ja: 'ハンガー', en: 'Hanger' },
  wash_basin: { zh: '洗衣盆', ja: '洗濯たらい', en: 'Wash Basin' },
};

export const GESTURE_DEFS = {
  unknown: { zh: '未知', ja: '不明', en: 'Unknown' },
  fist: { zh: '握拳', ja: '握りこぶし', en: 'Fist' },
  palm_open: { zh: '手展开', ja: '手を開く', en: 'Palm Open' },
  wave_in: { zh: '波浪内', ja: '波（内側）', en: 'Wave In' },
  wave_out: { zh: '波浪外', ja: '波（外側）', en: 'Wave Out' },
  pinch: { zh: '掐指', ja: 'つまむ', en: 'Pinch' },
  shoot: { zh: '射击', ja: '指鉄砲', en: 'Shoot' },
  relax: { zh: '放松', ja: 'リラックス', en: 'Relax' },
};

// Preset ids translate via the *_DEFS tables above; anything else (a user-typed custom tag)
// has no translation and is displayed exactly as entered, in whichever field it was typed.
export function tScene(id) { return SCENE_DEFS[id] ? SCENE_DEFS[id][currentLang] : id; }
export function tTask(id) { return TASK_DEFS[id] ? TASK_DEFS[id][currentLang] : id; }
export function tTool(id) { return TOOL_DEFS[id] ? TOOL_DEFS[id][currentLang] : id; }
export function tGesture(id) { return GESTURE_DEFS[id] ? GESTURE_DEFS[id][currentLang] : id; }
