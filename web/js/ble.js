// High-level BLE controller: picks a transport (native Android via Capacitor plugin, or
// Web Bluetooth in a browser/PWA), and layers the gForce command/response protocol on top.
import { createWebBleTransport, isSupported as isWebBluetoothSupported } from './ble-web.js';
import { createNativeBleTransport } from './ble-native.js';
import * as proto from './protocol.js';

export { isWebBluetoothSupported };

export function isNativePlatform() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

export function createBleController({ log }) {
  const transport = isNativePlatform() ? createNativeBleTransport(log) : createWebBleTransport(log);
  let connected = false;
  let deviceName = '';
  const pending = new Map(); // cmd -> {resolve, reject, timer}
  let emgConfig = { channelCount: 8, interleaved: true, sampleRate: 500 };
  const listeners = { data: null, gesture: null, disconnect: null };

  transport.onCmdResponse((bytes) => {
    const resp = proto.parseCommandResponse(bytes);
    if (!resp || resp.partial) return;
    const entry = pending.get(resp.cmd);
    if (entry) {
      clearTimeout(entry.timer);
      pending.delete(resp.cmd);
      entry.resolve(resp);
    }
  });

  let loggedFirstEmgPacket = false;
  transport.onData((bytes) => {
    if (!loggedFirstEmgPacket && bytes.length > 0 && bytes[0] === proto.NotifDataType.EMG_RAW) {
      loggedFirstEmgPacket = true;
      log('首个 EMG_RAW 包 (' + bytes.length + '字节): ' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(' '));
    }
    const parsed = proto.parseDataNotification(bytes, emgConfig);
    if (!parsed) return;
    if (parsed.type === 'emg') {
      if (listeners.data) listeners.data(parsed.samples);
    } else if (parsed.type === 'gesture') {
      if (listeners.gesture) listeners.gesture(parsed);
    } else if (parsed.type === 'unknown') {
      log('未知数据包 type=0x' + parsed.typeByte.toString(16) + ' len=' + parsed.raw.length);
    }
  });

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function sendCommand(bytes, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      const cmd = bytes[0];
      const timer = setTimeout(() => {
        pending.delete(cmd);
        reject(new Error('指令超时: cmd=0x' + cmd.toString(16)));
      }, timeoutMs);
      pending.set(cmd, { resolve, reject, timer });
      transport.writeCmd(bytes).catch((e) => {
        clearTimeout(timer);
        pending.delete(cmd);
        reject(e);
      });
    });
  }

  return {
    async connect() {
      await transport.init();
      const info = await transport.requestAndConnect({
        onDisconnect: () => {
          connected = false;
          if (listeners.disconnect) listeners.disconnect();
        },
      });
      deviceName = info.deviceName;
      connected = true;
      return deviceName;
    },

    async disconnect() {
      await transport.disconnect();
      connected = false;
    },

    isConnected() { return connected; },
    getDeviceName() { return deviceName; },

    // Best-effort capability probe, using the correct FeatureMap bit layout (GET_FEATURE_MAP's
    // response is not the same bitmask as SET_DATA_NOTIF_SWITCH's flags, despite sharing a
    // command byte range — an earlier version of this file conflated the two).
    async queryDiagnostics() {
      try {
        const resp = await sendCommand(proto.buildGetFeatureMapCmd());
        if (resp.respCode === proto.RESPONSE_CODE.SUCCESS) {
          const fm = proto.parseFeatureMap(resp.data);
          log(fm
            ? '设备支持的数据类型: ' + (fm.names.join(', ') || '(空)') + '  [0x' + fm.map.toString(16) + ']'
            : 'GET_FEATURE_MAP 响应格式异常: ' + Array.from(resp.data).join(','));
          if (fm && !(fm.map & proto.FeatureMap.EMG)) {
            log('⚠️ 该设备固件声明不支持 EMG，这就是收不到数据的原因，不是连接问题');
          }
        } else {
          log('GET_FEATURE_MAP 失败, resp=' + resp.respCode);
        }
      } catch (e) {
        log('GET_FEATURE_MAP 查询异常: ' + e.message);
      }
      try {
        const resp = await sendCommand(proto.buildGetEmgRawCapCmd());
        log('GET_EMG_RAWDATA_CAP resp=' + resp.respCode + ' data=[' + Array.from(resp.data).join(',') + ']');
      } catch (e) {
        log('GET_EMG_RAWDATA_CAP 查询异常: ' + e.message);
      }
    },

    async enableEmg({ sampleRate = 500, channelMask = 0xFF, packetLen = 128, resolution = 8 } = {}) {
      const newEmg = proto.isNewEmgDevice(deviceName);
      log(newEmg ? '设备协议: 新版 EMG (SET_FUNCTION_SWITCH)' : '设备协议: 传统 EMG (SET_DATA_NOTIF_SWITCH)');

      if (newEmg) {
        const switchResp = await sendCommand(proto.buildSetFunctionSwitchCmd(true, true));
        if (switchResp.respCode !== proto.RESPONSE_CODE.SUCCESS) {
          throw new Error('启用 EMG 功能开关失败 (resp=' + switchResp.respCode + ')');
        }
        await sleep(500);
      } else {
        const flags = proto.DataNotifFlag.EMG_RAW | proto.DataNotifFlag.EMG_GESTURE;
        const switchResp = await sendCommand(proto.buildSetDataNotifSwitchCmd(flags));
        if (switchResp.respCode !== proto.RESPONSE_CODE.SUCCESS) {
          throw new Error('启用数据开关失败 (resp=' + switchResp.respCode + ')');
        }
      }

      const cfgResp = await sendCommand(proto.buildSetEmgRawConfigCmd(sampleRate, channelMask, packetLen, resolution));
      if (cfgResp.respCode !== proto.RESPONSE_CODE.SUCCESS) {
        throw new Error('EMG 参数配置失败 (resp=' + cfgResp.respCode + ')');
      }

      if (newEmg) {
        const pkgIdResp = await sendCommand(proto.buildPackageIdControlCmd(true));
        if (pkgIdResp.respCode !== proto.RESPONSE_CODE.SUCCESS) {
          log('⚠️ PACKAGE_ID_CONTROL 失败 (resp=' + pkgIdResp.respCode + ')，继续尝试接收数据');
        }

        // The official SDK's initEMG()/init() flow does SET_FUNCTION_SWITCH +
        // SET_EMG_RAWDATA_CONFIG + PACKAGE_ID_CONTROL exactly like above, but that alone
        // does not start data flowing — a final SET_DATA_NOTIF_SWITCH call (the same
        // command the legacy branch uses as its *only* enable step) is what actually turns
        // the notification stream on, for both device generations. Skipping this for new-EMG
        // devices is why commands all ACK success yet literally zero packets ever arrive.
        const flags = proto.DataNotifFlag.EMG_RAW | proto.DataNotifFlag.EMG_GESTURE;
        const notifResp = await sendCommand(proto.buildSetDataNotifSwitchCmd(flags));
        if (notifResp.respCode !== proto.RESPONSE_CODE.SUCCESS) {
          log('⚠️ SET_DATA_NOTIF_SWITCH 失败 (resp=' + notifResp.respCode + ')，继续尝试接收数据');
        }
      }

      // The mode-switch/config commands above may reset the device's notification
      // subscription state as a side effect (observed on "new EMG" hardware: commands all
      // ACK success, but zero data notifications ever arrive). Re-subscribing here, after
      // the enable sequence is fully done, matches the official SDK's actual ordering
      // (it subscribes to data last) and is a cheap no-op for devices that don't need it.
      if (transport.resubscribeData) {
        await transport.resubscribeData();
      }

      emgConfig = { channelCount: proto.popcount8(channelMask), interleaved: true, sampleRate };
      return emgConfig;
    },

    setInterleaved(v) { emgConfig = { ...emgConfig, interleaved: v }; },
    getEmgConfig() { return emgConfig; },

    onEmgData(cb) { listeners.data = cb; },
    onGesture(cb) { listeners.gesture = cb; },
    onDisconnect(cb) { listeners.disconnect = cb; },
  };
}
