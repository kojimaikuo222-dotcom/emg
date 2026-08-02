// gForce BLE Data Protocol constants and packet encode/decode.
// Reverse-engineered from OYMotion's official gForceSDKAndroid.aar (gForceSDKAndroidDemo),
// decompiled locally. Byte-level values below are read directly from the SDK's compiled
// constants, not guessed. UUIDs confirmed against a real gForcePro+ over native Android BLE
// (logged service/characteristic discovery on-device): the SIG-base short-form UUIDs an
// earlier version of this app used (0000ffd0/ffd1/ffd4) do not exist on this hardware at
// all — the real service is the TI-base UUID used by OYMotion's own SDK.

export const SERVICE_UUID = 'f000ffd0-0451-4000-b000-000000000000';
export const CMD_CHAR_UUID = 'f000ffe1-0451-4000-b000-000000000000';
export const DATA_CHAR_UUID = 'f000ffe2-0451-4000-b000-000000000000';

export const CommandType = {
  GET_PROTOCOL_VERSION: 0,
  GET_FEATURE_MAP: 1,
  GET_DEVICE_NAME: 2,
  GET_MODEL_NUMBER: 3,
  GET_SERIAL_NUMBER: 4,
  GET_HW_REVISION: 5,
  GET_FW_REVISION: 6,
  GET_MANUFACTURER_NAME: 7,
  GET_BATTERY_LEVEL: 8,
  GET_TEMPERATURE: 9,
  GET_BOOTLOADER_VERSION: 10,
  POWEROFF: 29,
  SYSTEM_RESET: 31,
  SET_LOG_LEVEL: 33,
  MOTOR_CONTROL: 36,
  LED_CONTROL_TEST: 37,
  GET_EMG_RAWDATA_CAP: 62,
  SET_EMG_RAWDATA_CONFIG: 63,
  GET_EMG_RAWDATA_CONFIG: 70,
  GET_GESTURE_THRESHOLD: 71,
  SET_GESTURE_THRESHOLD: 72,
  SET_DATA_NOTIF_SWITCH: 79,
};

// Bit flags for CommandType.SET_DATA_NOTIF_SWITCH (32-bit, little-endian on the wire).
export const DataNotifFlag = {
  OFF: 0,
  ACCELERATE: 1 << 0,
  GYROSCOPE: 1 << 1,
  MAGNETOMETER: 1 << 2,
  EULERANGLE: 1 << 3,
  QUATERNION: 1 << 4,
  ROTATIONMATRIX: 1 << 5,
  EMG_GESTURE: 1 << 6,
  EMG_RAW: 1 << 7,
  HID_MOUSE: 1 << 8,
  HID_JOYSTICK: 1 << 9,
  DEVICE_STATUS: 1 << 10,
  LOG: 1 << 11,
  ALL: -1,
};

// Leading type byte of each notification payload on DATA_CHAR_UUID.
export const NotifDataType = {
  ACC: 1,
  GYRO: 2,
  MAG: 3,
  EULER: 4,
  QUATERNION: 5,
  ROTATION_MATRIX: 6,
  EMG_GESTURE: 7,
  EMG_RAW: 8,
  HID_MOUSE: 9,
  HID_JOYSTICK: 10,
  DEVICE_STATUS: 11,
  LOG: 12,
  PARTIAL: 255,
};

export const RESPONSE_CODE = { SUCCESS: 0, NOT_SUPPORT: 1, BAD_PARAM: 2, FAILED: 3, TIMEOUT: 4, PARTIAL_PACKET: 255 };

export const GESTURE_LABELS = { 0: '未知', 1: '握拳', 2: '手展开', 3: '波浪内', 4: '波浪外', 5: '掐指', 6: '射击', 255: '放松' };

export function buildSetDataNotifSwitchCmd(flags) {
  return [
    CommandType.SET_DATA_NOTIF_SWITCH,
    flags & 0xFF,
    (flags >> 8) & 0xFF,
    (flags >> 16) & 0xFF,
    (flags >> 24) & 0xFF,
  ];
}

// sampRate: Hz (e.g. 500). channelMask: bit per channel, 0xFF = 8 channels.
// dataLen: bytes of raw samples packed per BLE notification. resolution: bits per sample (8 or 12).
export function buildSetEmgRawConfigCmd(sampRate, channelMask, dataLen, resolution) {
  return [
    CommandType.SET_EMG_RAWDATA_CONFIG,
    sampRate & 0xFF,
    (sampRate >> 8) & 0xFF,
    channelMask & 0xFF,
    (channelMask >> 8) & 0xFF,
    dataLen & 0xFF,
    resolution & 0xFF,
  ];
}

export function buildGetFeatureMapCmd() {
  return [CommandType.GET_FEATURE_MAP];
}

export function buildGetEmgRawCapCmd() {
  return [CommandType.GET_EMG_RAWDATA_CAP];
}

// respData: the 4-byte payload of a GET_FEATURE_MAP (cmd=1) response, per the decompiled SDK
// (little-endian u32, same bit layout as DataNotifFlag). Returns which flags this specific
// device firmware declares support for — a device can ACK a SET_DATA_NOTIF_SWITCH write for a
// bit it doesn't actually implement, so this is the one call that tells the truth up front.
export function parseFeatureMap(respData) {
  if (!respData || respData.length < 4) return null;
  const map = (respData[0] | (respData[1] << 8) | (respData[2] << 16) | (respData[3] << 24)) >>> 0;
  const names = [];
  for (const [name, bit] of Object.entries(DataNotifFlag)) {
    if (name === 'OFF' || name === 'ALL') continue;
    if (map & bit) names.push(name);
  }
  return { map, names };
}

export function popcount8(mask) {
  let n = 0;
  for (let i = 0; i < 8; i++) if (mask & (1 << i)) n++;
  return n;
}

function readFloatLE(bytes, offset) {
  const buf = new Uint8Array(4);
  buf.set(bytes.subarray(offset, offset + 4));
  return new DataView(buf.buffer).getFloat32(0, true);
}

// Parses one DATA_CHAR_UUID notification payload.
// channelCount + sampleInterleaved describe how EMG_RAW batches are unpacked; both are
// configurable at runtime (see settings) since the exact byte ordering isn't spelled out
// in the parts of the SDK we could decompile (params only, no sample-packing code).
export function parseDataNotification(bytes, { channelCount = 8, interleaved = true } = {}) {
  if (!bytes || bytes.length < 1) return null;
  const type = bytes[0];
  const payload = bytes.subarray(1);

  switch (type) {
    case NotifDataType.EMG_RAW: {
      const n = channelCount > 0 ? Math.floor(payload.length / channelCount) : 0;
      const samples = [];
      for (let s = 0; s < n; s++) {
        const row = new Array(channelCount);
        for (let c = 0; c < channelCount; c++) {
          row[c] = interleaved ? payload[s * channelCount + c] : payload[c * n + s];
        }
        samples.push(row);
      }
      return { type: 'emg', samples };
    }
    case NotifDataType.QUATERNION: {
      if (payload.length < 16) return { type: 'quaternion', raw: payload };
      return {
        type: 'quaternion',
        w: readFloatLE(payload, 0),
        x: readFloatLE(payload, 4),
        y: readFloatLE(payload, 8),
        z: readFloatLE(payload, 12),
      };
    }
    case NotifDataType.EMG_GESTURE: {
      return { type: 'gesture', gestureId: payload[0], raw: payload };
    }
    case NotifDataType.EULER:
      return { type: 'euler', raw: payload };
    case NotifDataType.ACC:
      return { type: 'acc', raw: payload };
    case NotifDataType.GYRO:
      return { type: 'gyro', raw: payload };
    case NotifDataType.MAG:
      return { type: 'mag', raw: payload };
    case NotifDataType.DEVICE_STATUS:
      return { type: 'device_status', raw: payload };
    case NotifDataType.PARTIAL:
      return { type: 'partial', raw: payload };
    default:
      return { type: 'unknown', typeByte: type, raw: payload };
  }
}

// Parses one CMD_CHAR_UUID notification payload (command response channel).
export function parseCommandResponse(bytes) {
  if (!bytes || bytes.length < 2) return null;
  if (bytes[0] === 0xFF) return { partial: true, seq: bytes[1], data: bytes.subarray(2) };
  return { partial: false, respCode: bytes[0], cmd: bytes[1], data: bytes.subarray(2) };
}
