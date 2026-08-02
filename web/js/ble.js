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

  transport.onData((bytes) => {
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

    async enableEmg({ sampleRate = 500, channelMask = 0xFF, packetLen = 128, resolution = 8 } = {}) {
      const flags = proto.DataNotifFlag.EMG_RAW | proto.DataNotifFlag.EMG_GESTURE;
      const switchResp = await sendCommand(proto.buildSetDataNotifSwitchCmd(flags));
      if (switchResp.respCode !== proto.RESPONSE_CODE.SUCCESS) {
        throw new Error('启用数据开关失败 (resp=' + switchResp.respCode + ')');
      }
      const cfgResp = await sendCommand(proto.buildSetEmgRawConfigCmd(sampleRate, channelMask, packetLen, resolution));
      if (cfgResp.respCode !== proto.RESPONSE_CODE.SUCCESS) {
        throw new Error('EMG 参数配置失败 (resp=' + cfgResp.respCode + ')');
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
