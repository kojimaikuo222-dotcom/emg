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
