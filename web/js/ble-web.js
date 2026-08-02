// Web Bluetooth transport (desktop/Android Chrome browser use of this app as a PWA).
import { SERVICE_UUID, CMD_CHAR_UUID, DATA_CHAR_UUID } from './protocol.js';

export function isSupported() {
  return !!navigator.bluetooth;
}

export function createWebBleTransport(log) {
  let device = null;
  let server = null;
  let cmdChar = null;
  let dataChar = null;
  let dataCb = null;
  let cmdCb = null;
  let disconnectCb = null;

  function onDataChanged(ev) {
    const bytes = new Uint8Array(ev.target.value.buffer);
    if (dataCb) dataCb(bytes);
  }
  function onCmdChanged(ev) {
    const bytes = new Uint8Array(ev.target.value.buffer);
    if (cmdCb) cmdCb(bytes);
  }
  function onGattDisconnected() {
    cmdChar = null;
    dataChar = null;
    if (disconnectCb) disconnectCb();
  }

  return {
    async init() {},

    async requestAndConnect({ onDisconnect } = {}) {
      disconnectCb = onDisconnect || null;
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [SERVICE_UUID],
      });
      device.addEventListener('gattserverdisconnected', onGattDisconnected);
      log('设备已选择: ' + (device.name || device.id));

      server = await device.gatt.connect();
      log('GATT 已连接');

      const svc = await server.getPrimaryService(SERVICE_UUID);
      cmdChar = await svc.getCharacteristic(CMD_CHAR_UUID);
      dataChar = await svc.getCharacteristic(DATA_CHAR_UUID);

      await cmdChar.startNotifications();
      cmdChar.addEventListener('characteristicvaluechanged', onCmdChanged);

      await dataChar.startNotifications();
      dataChar.addEventListener('characteristicvaluechanged', onDataChanged);

      return { deviceId: device.id, deviceName: device.name || '设备' };
    },

    // See ble-native.js's resubscribeData() for why this exists — kept here too so ble.js
    // can call it unconditionally regardless of which transport is active.
    async resubscribeData() {
      if (!dataChar) return;
      try {
        await dataChar.stopNotifications();
      } catch (e) {
        // fine if it was never actually subscribed — we're about to (re)subscribe anyway
      }
      await dataChar.startNotifications();
      log('已重新订阅数据通知');
    },

    async disconnect() {
      if (device && device.gatt.connected) device.gatt.disconnect();
    },

    async writeCmd(byteArray) {
      if (!cmdChar) throw new Error('未连接 CMD 特征');
      await cmdChar.writeValue(new Uint8Array(byteArray));
    },

    onData(cb) { dataCb = cb; },
    onCmdResponse(cb) { cmdCb = cb; },
  };
}
