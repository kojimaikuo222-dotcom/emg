// Native BLE transport for the Android app shell, via @capacitor-community/bluetooth-le.
// This is what actually talks to real Android BluetoothGatt — Web Bluetooth does not exist
// inside a Capacitor WebView, which is why the APK needs this separate transport.
import { BleClient, ConnectionPriority, numbersToDataView, dataViewToNumbers } from '@capacitor-community/bluetooth-le';
import { SERVICE_UUID, CMD_CHAR_UUID, DATA_CHAR_UUID } from './protocol.js';

export function createNativeBleTransport(log) {
  let deviceId = null;
  let dataCb = null;
  let cmdCb = null;

  function onDataNotification(value) {
    if (dataCb) dataCb(new Uint8Array(dataViewToNumbers(value)));
  }

  return {
    async init() {
      await BleClient.initialize({ androidNeverForLocation: true });
    },

    async requestAndConnect({ onDisconnect } = {}) {
      const device = await BleClient.requestDevice({ optionalServices: [SERVICE_UUID] });
      deviceId = device.deviceId;
      log('设备已选择: ' + (device.name || deviceId));

      await BleClient.connect(deviceId, () => {
        deviceId = null;
        if (onDisconnect) onDisconnect();
      });
      log('GATT 已连接');

      // The EMG stream is ~30 notifications/sec at the default 500Hz/128-byte config. Under
      // Android's default "balanced" connection priority the negotiated connection interval
      // can be too slow for some peripherals' BLE chips to keep their notification queue
      // drained, and the peripheral itself drops the connection a few seconds into streaming
      // (observed on real hardware). Requesting a high-priority (short interval) connection
      // is the standard fix; harmless to request even for devices that didn't need it.
      try {
        await BleClient.requestConnectionPriority(deviceId, ConnectionPriority.CONNECTION_PRIORITY_HIGH);
        log('已请求高优先级连接参数');
      } catch (e) {
        log('请求连接优先级失败（可忽略）: ' + e.message);
      }

      // Android's cached GATT profile for a device can be stale/incomplete on a first
      // connection, which makes the service/characteristics connect() already discovered
      // look empty to this specific BluetoothGatt instance. Force a fresh discovery and log
      // exactly what the phone sees, so a "Characteristic not found" failure is diagnosable
      // instead of a dead end.
      await BleClient.discoverServices(deviceId);
      const services = await BleClient.getServices(deviceId);
      log('发现 ' + services.length + ' 个 Service');
      for (const s of services) {
        log('  SVC ' + s.uuid + ' -> ' + s.characteristics.map((c) => c.uuid).join(', '));
      }

      await BleClient.startNotifications(deviceId, SERVICE_UUID, CMD_CHAR_UUID, (value) => {
        if (cmdCb) cmdCb(new Uint8Array(dataViewToNumbers(value)));
      });
      await BleClient.startNotifications(deviceId, SERVICE_UUID, DATA_CHAR_UUID, onDataNotification);

      return { deviceId, deviceName: device.name || '设备' };
    },

    async disconnect() {
      if (deviceId) await BleClient.disconnect(deviceId);
      deviceId = null;
    },

    async writeCmd(byteArray) {
      if (!deviceId) throw new Error('未连接');
      await BleClient.write(deviceId, SERVICE_UUID, CMD_CHAR_UUID, numbersToDataView(byteArray));
    },

    onData(cb) { dataCb = cb; },
    onCmdResponse(cb) { cmdCb = cb; },
  };
}
