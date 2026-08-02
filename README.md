# EMG 采集

gForcePro+ 8 通道肌电（EMG）采集与场景标注工具。支持两种运行形态：

- **浏览器 PWA**（Android Chrome，走 Web Bluetooth）
- **Android 原生 App**（Capacitor 打包，走系统原生蓝牙，可脱离浏览器独立安装）

两种形态共用同一份 `web/` 前端代码，只是蓝牙传输层不同（见下方架构说明）。

## 协议修复说明（原来采的是 IMU，不是 EMG）

旧版本发送的"启用 EMG"指令是编造的帧格式 `[0xAA, 0x02, 0x00, 0x88, 0x00]`。真实的 gForce 协议里
根本没有 `0xAA` 帧头，指令就是裸的 `[命令字节, ...参数]`，设备收到这种不认识的指令会直接忽略，
于是应用收到的其实只是设备开机后默认在推送的四元数（姿态/IMU）数据，从未真正打开过 EMG。

以下字节级协议数据来自对 OYMotion 官方 `gForceSDKAndroid.aar`（gForceSDKAndroidDemo 项目自带）反编译
得到的真实常量，不是猜测：

| 数据包首字节类型 (DATA 特征通知) | 含义 |
|---|---|
| 1 | 加速度计 |
| 2 | 陀螺仪 |
| 3 | 磁力计 |
| 4 | 欧拉角 |
| **5** | **四元数（姿态/IMU）— 旧代码误当成 EMG 的就是这个** |
| 6 | 旋转矩阵 |
| 7 | 手势 |
| **8** | **EMG 原始数据（真正的肌电数据）** |
| 255 | 分包数据 |

启用开关指令 `CMD_SET_DATA_NOTIF_SWITCH = 0x4F`，参数是 32 位小端 flags，`EMG_RAW = 0x80`、
`EMG_GESTURE = 0x40`。EMG 采样参数指令 `CMD_SET_EMG_RAWDATA_CONFIG = 0x3F`，参数为
`[采样率低字节, 采样率高字节, 通道掩码低字节, 通道掩码高字节, 单包字节数, 分辨率]`，本项目固定使用
官方 Demo 采用的默认值：500Hz、8 通道全开（掩码 0xFF）、单包 128 字节、8bit 分辨率。

详见 `web/js/protocol.js`，其中每个常量都在注释里标注了对应的官方 SDK 类/字段名，便于以后核对。

**BLE Service/特征值 UUID**：`f000ffd0-0451-4000-b000-000000000000`（服务）/
`f000ffe1-0451-4000-b000-000000000000`（命令特征）/`f000ffe2-0451-4000-b000-000000000000`
（数据特征），和官方 SDK 硬编码的完全一致。早期版本沿用旧代码里的 `0000ffd0`/`ffd1`/`ffd4`
（SIG 短格式 UUID）在原生蓝牙上直接报 `Characteristic not found`——真机上打印出的实际 Service
列表证实这套设备根本没有那几个 UUID，纯属早期代码里的错误设定，已改用上面这套真实值。

**唯一没有百分之百把握的细节**：一个 128 字节的 EMG 数据包里，多个采样点是"按采样点交织"
（`ch0,ch1...ch7,ch0,ch1...`）还是"按通道分块"（`ch0×16,ch1×16...`）排列——反编译到的官方 Demo
代码只解析了四元数，没有解析 EMG 原始数据这部分，所以这个字节序是按最常见的多路 ADC 打包方式推断的。
如果连上真机后发现波形明显不对（比如 8 个通道看起来像是被"错位拼接"），去"波形"页切换一下
**采样交织方式**下拉框即可，不需要改代码。

## 新款设备（gForce Ultra / OYWW1000 等）：另一套启用协议

不是所有 gForce 系列设备都用上面那套流程启用 EMG。OYMotion 更新的一代硬件（gForce Ultra 之类，
设备名不以 `gForce`/`OHand`/`ORE-`/`OYEM-`/`ORehab` 开头的都算）走一条完全不同的启用路径，这是从
OYMotion 官方新一代 "Synchroni" SDK 的 Python 源码里核对出来的（PyPI 上的 `sensor-sdk` 包，
`sensor_data_context.py` 的 `initEMG()`）：

- `GET_FEATURE_MAP`（cmd=1）返回的位图，**跟 `SET_DATA_NOTIF_SWITCH` 用的 flags 位图完全是两套不同的定义**，
  只是恰好共用同一个查询指令。之前的版本误把两者当成同一套解析，把一台明明支持 EMG 的设备判断成"不支持"——
  已修正，正确定义见 `protocol.js` 里的 `FeatureMap`（区别于 `DataNotifFlag`）。
- 新款设备启用 EMG 不发 `SET_DATA_NOTIF_SWITCH`，而是发 `SET_FUNCTION_SWITCH`（cmd=0x85，
  参数 bit1=EMG、bit0=手势），等 500ms 后再发 `SET_EMG_RAWDATA_CONFIG`，最后还要发一个
  `PACKAGE_ID_CONTROL`（cmd=0x26，参数 `1`）。三步缺一都不行。
- App 现在按设备名前缀自动判断走哪条路（`protocol.js` 的 `isNewEmgDevice()`），不需要手动切换。
- **新款设备指令全部成功但收不到任何数据包**：真机调试发现 `SET_FUNCTION_SWITCH` /
  `SET_EMG_RAWDATA_CONFIG` / `PACKAGE_ID_CONTROL` 三条指令都返回成功，波形图却完全是平的，
  连"未知类型"的日志都没触发过——说明设备根本没有在推送任何通知包。
  第一轮怀疑是 BLE 通知订阅状态（CCCD）被模式切换指令重置，加了重新订阅（`resubscribeData()`）
  但真机验证无效，问题依旧。后来把官方 Python SDK 的 `sensor_data_context.py` 里
  `SensorDataContext.init()` / `initEMG()` 的完整调用顺序通读了一遍才找到真正原因：
  **不管新老设备，真正打开数据推送开关的都是 `SET_DATA_NOTIF_SWITCH`（cmd=0x4F，老代码里
  唯一的启用指令）**；新款设备的 `SET_FUNCTION_SWITCH`/`SET_EMG_RAWDATA_CONFIG`/
  `PACKAGE_ID_CONTROL` 三连只是配置采样参数和包格式，本身并不会让设备开始推流——官方 SDK
  在这三步之后，仍然会调用 `_buildNotifyDataFlag()` 拼出包含 `EMG_RAW` 位的订阅掩码，
  再发一次 `set_subscription()`（也就是 `SET_DATA_NOTIF_SWITCH`）才真正让固件开始推送。
  之前的新设备分支完全没有发送这条指令，这才是"指令全成功、但一个包都收不到"的真正原因。
  已修复：新设备分支现在会在 `PACKAGE_ID_CONTROL` 之后，额外发送一次
  `SET_DATA_NOTIF_SWITCH(EMG_RAW | EMG_GESTURE)`。
- **数据包类型字节对不上、连上后没几秒又掉线**：加上 `SET_DATA_NOTIF_SWITCH` 之后 OYWW1000
  真的开始推数据了，但调试日志全是"未知数据包 type=0x88 len=130"，而且开始收数据几秒后设备
  自己断开连接。两个问题分别查到了原因：
  1. `PACKAGE_ID_CONTROL(true)` 生效后，设备会在类型字节上 OR `0x80`（`8`→`0x88`），并且在
     实际数据前面多塞 2 字节的"包序号"（对照官方 SDK `_processDataPackage()` 的
     `data[0] & 0x7F` 取类型、`packageIndexLength + 1` 起跳读数据，完全对应）。`128字节 EMG
     数据 + 2字节包序号 = 130字节`，正好和日志对上。已修复 `parseDataNotification()`：先用
     `& 0x7F` 还原真实类型，再跳过打包模式下多出来的 2 字节包序号。老款设备从没启用过
     `PACKAGE_ID_CONTROL`，这个位永远不会被置位，所以完全不受影响。
  2. 上一轮加的"重新订阅数据通知"（`resubscribeData()`，见上一条）现在看是多余的——
     `SET_DATA_NOTIF_SWITCH` 一 ACK，设备可能立刻就开始用近 30 包/秒的速度推流了。已把这次
     调用去掉（连同两个传输层里的 `resubscribeData()` 方法本身，不再被调用，删掉了）。

  去掉重新订阅之后真机再测，包能正确解析成真实 EMG 数据了（首个 EMG_RAW 包日志能看到明显
  有起伏的字节序列），但设备还是在开始推流几秒后就断开——说明前面两轮的怀疑都不是真正原因，
  这次真机连续测试暴露的是另一个问题：
  1. **官方 SDK 对这类新款设备的默认行为是"新版 EMG 只开 EMG 流，不带手势"**：
     `sensor_data_context.py` 里有个 `BLEChipType.OYM` 判断，专门针对新版 EMG 且用这颗
     蓝牙芯片的设备，会强制关掉手势/IMU/加速度/陀螺仪等所有其他通知流，只留 EMG 一路。
     而这个 App 的新设备分支之前是 EMG 和手势两路notification一起开的
     （`SET_FUNCTION_SWITCH(emg=1, gest=1)` + `SET_DATA_NOTIF_SWITCH(EMG_RAW|EMG_GESTURE)`），
     跟官方对这颗芯片的默认做法不一致，很可能是这颗芯片的蓝牙通知队列扛不住两路并发的高频
     通知，几秒后队列压爆导致设备自己断连。已修复：新设备分支现在只开 EMG 一路
     （`SET_FUNCTION_SWITCH(emg=1, gest=0)` + `SET_DATA_NOTIF_SWITCH(EMG_RAW)`），跟官方对
     这颗芯片的默认行为保持一致。老款 gForcePro+ 不受影响，仍然同时开 EMG 和手势两路。
  2. **顺手加了 Android 连接优先级请求**：500Hz/128字节配置下大约每秒 30 个通知包，
     Android 默认的"均衡"连接优先级协商出的连接间隔对某些蓝牙芯片来说可能跟不上这个吞吐量，
     导致外设自己的通知队列排不过来而断连。原生蓝牙层现在连接成功后会主动请求
     `CONNECTION_PRIORITY_HIGH`（更短的连接间隔），失败了就打日志忽略，不影响后续流程，
     对不需要这个的设备也没有副作用。

## 面向销售/演示场景的功能：多语言、自定义场景与字段

为了方便用这个 App 给不同客户/渠道做演示（比如面向日本客户改成日语界面、面向某个具体行业
重新打自定义标签），加了两块东西：

- **中/日/英三语界面**：右上角有个语言切换下拉框，切换后立刻生效，不需要刷新页面，且当前
  已选中的场景/工序/工具不会因为切换语言而丢失（内部用的是语言无关的 ID，界面上显示的文案
  才是翻译出来的）。也支持用 `?lang=ja` 这样的链接参数直接打开指定语言版本，方便发给客户
  时提前定好语言。翻译逻辑集中在 `web/js/i18n.js`：`UI` 是界面文案表，`SCENE_DEFS`/
  `TASK_DEFS`/`TOOL_DEFS`/`GESTURE_DEFS` 是场景/工序/工具/手势的预设词表。
  **范围说明**：连接页里的"调试日志"面板没有做多语言——那是给排查连接问题用的技术性日志
  （BLE 指令、GATT 状态之类），不是面向客户演示的界面内容，所以保留中文原样，避免把翻译精力
  花在不会被客户看到的地方。
- **自定义场景/工序/工具标签**：每一组标签末尾都有一个"+ 自定义"按钮，点击后可以输入任意
  文本作为新标签，输入后会记住（存在浏览器 `localStorage` 里），下次打开还在，可以针对不同
  客户的行业场景现场加标签（比如给康复机构演示时加一个"握力训练"场景）。自定义标签没有翻译，
  显示成用户输入时的原样，跟随录制一起写入导出的 CSV。
- **自定义字段**：标注页新增"自定义字段"区块，可以自由添加任意"字段名 + 值"，会作为额外的
  列写入导出的 CSV（比如加一个"操作者"字段，值填客户名字）。字段配置也会持久化保存。

再加了四块面向机构批量采集场景的可用性改进：

- **场景/工序/工具改成带步骤感的引导**：三个区块标题前面加了 ① ② ③ 编号圆点，选完对应项后
  圆点会变绿并显示对勾；还没选场景时，工序/工具区块不再是干巴巴一行灰字，而是带箭头图标的
  虚线提示框，看起来像"下一步"而不是"没做完/坏了"。
- **受试者编号字段**：标注页顶部新增一个常驻的"受试者编号"输入框（可选），录制时会带进 CSV
  （新增 `subject` 列）和文件名，方便机构那种"多个受试者、每人跑多组任务"的批量采集场景按
  受试者归类/排序文件，不用每条记录都塞进自定义字段里手动输。
- **信号质量指示**：连接页新增"信号质量"卡片，连上设备后会显示 8 个通道各自的信号状态点
  （绿色=正常有波动、灰色=暂无信号、红色=贴着上下限跑，很可能是电极没贴好）外加一行文字
  摘要，不用再跳到波形页才能确认设备戴得好不好——这个判断复用了之前做数据质量分析时用的
  "贴限/无波动"启发式规则。
- **文件页汇总统计**：已保存文件列表上方新增四个统计卡片：总记录数、受试者数（按不同的受试者
  编号去重）、总时长（按采样数 ÷ 500Hz 估算）、总大小，给机构决策者演示时一眼就能看出"目前
  已经采集了多少数据"，比翻文件名列表更有说服力。

## 已修复的问题（对照上一轮代码审查）

- **数据持久化**：录制结果现在写入 IndexedDB（`web/js/db.js`），刷新页面/ 应用重启不会再丢失未下载的数据；"文件"页从数据库读取，并新增了"删除"按钮。
- **Blob URL 内存泄漏**：下载用的 Blob URL 在点击触发下载后会在 30 秒后自动 `revokeObjectURL`，不再无限累积。
- **CSV 注入 / 格式破坏**：备注等自由文本字段中若包含逗号、引号、换行，会按 CSV 规范加引号转义（`csvField()`），不会再破坏列结构。
- **PWA 名不副实**：补上了真正的 `manifest.json` + `sw.js`（离线缓存 App Shell），浏览器场景下可以真正"添加到主屏幕"并离线打开。
- **静默降级**：EMG 使能指令（开关 + 参数配置）任何一步失败都会抛出明确错误、阻止进入"可录制"状态，不会再出现"显示已连接但其实收不到 EMG 数据"的情况。
- **断线处理**：断开时若正在录制会先保存已录制部分，并给出明确的"设备已断开"状态提示。
- **工程化缺失**：现在是标准 npm + Capacitor 工程结构，有本 README、`.gitignore`、模块化的代码，不再是单文件糊在一起。

## 目录结构

```
web/                    前端源码（浏览器 PWA 与 Android App 共用）
  index.html
  style.css
  manifest.json / sw.js
  js/
    protocol.js          gForce 协议常量与编解码（纯函数，无 UI/BLE 依赖）
    ble-web.js            Web Bluetooth 传输层（浏览器用）
    ble-native.js          Capacitor 原生蓝牙传输层（APK 用）
    ble.js                统一的高层蓝牙控制器（自动选择上面两种传输层之一）
    db.js                 IndexedDB 持久化
    app.js                页面逻辑 / UI 状态机
  dist/bundle.js         esbuild 打包产物（不提交到 git，构建时生成）
android/                 Capacitor 生成的原生 Android 工程（`npx cap add android` 产物）
capacitor.config.json
package.json
```

## 本地开发 / 浏览器使用

```bash
npm install
npm run build:web   # 用 esbuild 把 web/js 打包成 web/dist/bundle.js
```

然后用任意静态服务器托管 `web/` 目录（Web Bluetooth 需要 HTTPS 或 localhost 安全上下文），
在 Android Chrome 里打开即可，用法和之前一样：连接 → 选场景/工序/工具 → 开始录制 → 停止后自动
弹出下载并保存到"文件"页。

## 打包 Android APK

**重要限制**：这个开发沙箱的出网策略把 Google 的整个二进制分发体系都拦掉了
（`dl.google.com` 直接拒绝连接，`maven.google.com` 会 301 重定向到同样被拦的 `dl.google.com`）。
`npm install`、`npx cap add android`、`npx cap sync` 这些不需要 Google 服务器的步骤都已经在这个环境里
跑通并提交了产物（见上面的目录结构），但最后一步把编译好的 `.class` 打包成 Android 需要的 `.dex`
所需要的 `d8`/`r8` 工具，以及 AndroidX 依赖库本身，只能从被拦截的 Google 服务器获取，Maven Central /
npm 上都没有替代来源。所以 **APK 编译这一步必须在有正常网络访问的机器上完成**，本仓库已经把
Capacitor 工程搭建、蓝牙插件接入、协议代码全部准备好，你只需要：

```bash
npm install
npm run android:debug
# 等价于: npm run build:web && npx cap sync android && cd android && ./gradlew assembleDebug
```

首次运行前确保本机已装好 Android SDK（`ANDROID_HOME` 指向一个装了 `platform-33`+ 和对应
build-tools 的 SDK 目录即可，用 Android Studio 装最省事）。构建完成后 debug APK 在：

```
android/app/build/outputs/apk/debug/app-debug.apk
```

用 `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` 或者直接把这个文件传到手机上
点开安装（需要在系统设置里允许"安装未知来源应用"）。

也可以直接用 Android Studio 打开 `android/` 目录，点 Run 到真机，效果一样。

打正式签名的 release APK/AAB 走标准 Capacitor/Gradle 流程即可（`./gradlew bundleRelease`，配置好签名
`keystore`），这里没有特殊处理。

## Android App 的蓝牙权限

`@capacitor-community/bluetooth-le` 插件会自动合并所需权限。本项目额外在
`android/app/src/main/AndroidManifest.xml` 里按插件官方文档加了 `neverForLocation` 声明
（配合 JS 侧 `BleClient.initialize({ androidNeverForLocation: true })`），这样 Android 12+
设备上扫描蓝牙不需要再向用户申请定位权限。如果 Gradle 构建时报 manifest 合并冲突，
把该权限声明改成带 `tools:node="replace"` 即可。

## 已知限制

- 仅在 Android Chrome / Android App 内可用，Web Bluetooth 在 iOS Safari 完全不支持。
- EMG 原始数据的采样点交织顺序是推断值，见上文"协议修复说明"最后一段，连真机测试后如有需要用波形页的下拉框切换。
- 手势识别包（type=7）目前只是把设备返回的原始字节展示出来，没有假装解析出置信度百分比——反编译到的官方 Demo 没有解析这部分,所以没有编造一个"看起来对"的格式。
