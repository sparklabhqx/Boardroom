/// <reference types="vite/client" />

export type DeviceInfo = {
  deviceName: string;
  firmwareVersion: string;
  chipId: string;
  uptime: number;
  rssi: number;
  heap: number;
  ip?: string;
};

export type GpioState = {
  pin: number;
  value: 0 | 1;
};

export type ProbeResult = {
  ok: boolean;
  ip: string;
  info?: DeviceInfo;
  gpio?: GpioState[];
  logs?: string[];
  error?: string;
};

export type FirmwareFile = {
  path: string;
  name: string;
  size: number;
};

export type UploadProgress = {
  requestId: string;
  sent: number;
  total: number;
  percent: number;
};

export type BoardroomApi = {
  getBackendStatus: () => Promise<{ port: number; url: string; defaultScanRange?: string }>;
  probeDevice: (ip: string) => Promise<ProbeResult>;
  scanRange: (range: string) => Promise<ProbeResult[]>;
  setGpio: (ip: string, pin: number, value: 0 | 1) => Promise<ProbeResult>;
  getLogs: (ip: string) => Promise<{ ok: boolean; logs?: string[]; error?: string }>;
  selectFirmwareFile: () => Promise<FirmwareFile | null>;
  uploadFirmware: (ip: string, filePath: string, requestId: string) => Promise<{ ok: boolean; statusCode?: number; body?: string; error?: string }>;
  onUploadProgress: (callback: (progress: UploadProgress) => void) => () => void;
};

declare global {
  interface Window {
    boardroom?: BoardroomApi;
  }
}
