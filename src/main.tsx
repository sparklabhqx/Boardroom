import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  Cpu,
  HardDriveUpload,
  LayoutDashboard,
  ListRestart,
  Loader2,
  Plus,
  RefreshCcw,
  Router,
  Search,
  Settings,
  Terminal,
  ToggleLeft,
  ToggleRight,
  Upload,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { DeviceInfo, FirmwareFile, GpioState, ProbeResult, UploadProgress } from './vite-env';
import './styles.css';

type Section = 'devices' | 'ota' | 'settings';

type DeviceRecord = {
  id: string;
  ip: string;
  name: string;
  status: 'unknown' | 'online' | 'offline' | 'loading';
  firmwareVersion: string;
  lastSeen?: string;
  info?: DeviceInfo;
  gpio: GpioState[];
  logs: string[];
  error?: string;
};

type AppSettings = {
  scanRange: string;
  gpioPins: number[];
  backendPort: number;
};

const storageKeys = {
  devices: 'boardroom.devices',
  settings: 'boardroom.settings',
};

const defaultSettings: AppSettings = {
  scanRange: '192.168.1.1-254',
  gpioPins: [2, 4, 5, 12, 13],
  backendPort: 8765,
};

function loadDevices(): DeviceRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKeys.devices) || '[]') as DeviceRecord[];
    return parsed.map((device) => ({ ...device, status: 'unknown', gpio: device.gpio || [], logs: device.logs || [] }));
  } catch {
    return [];
  }
}

function loadSettings(): AppSettings {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(storageKeys.settings) || '{}') };
  } catch {
    return defaultSettings;
  }
}

function normalizeIp(value: string) {
  return value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

function deviceFromProbe(result: ProbeResult, existing?: DeviceRecord): DeviceRecord {
  const now = new Date().toISOString();
  return {
    id: existing?.id || result.ip,
    ip: result.ip,
    name: result.info?.deviceName || existing?.name || result.ip,
    status: result.ok ? 'online' : 'offline',
    firmwareVersion: result.info?.firmwareVersion || existing?.firmwareVersion || 'unknown',
    lastSeen: result.ok ? now : existing?.lastSeen,
    info: result.info || existing?.info,
    gpio: result.gpio || existing?.gpio || [],
    logs: result.logs || existing?.logs || [],
    error: result.ok ? undefined : result.error,
  };
}

function formatDuration(seconds?: number) {
  if (!seconds && seconds !== 0) return 'unknown';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatTime(value?: string) {
  if (!value) return 'never';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function formatBytes(value?: number) {
  if (!value && value !== 0) return 'unknown';
  if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

function getApi() {
  return window.boardroom;
}

function App() {
  const [section, setSection] = useState<Section>('devices');
  const [devices, setDevices] = useState<DeviceRecord[]>(loadDevices);
  const [selectedId, setSelectedId] = useState<string | undefined>(() => loadDevices()[0]?.id);
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [manualIp, setManualIp] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [backendStatus, setBackendStatus] = useState<{ port: number; url: string } | null>(null);
  const [firmwareFile, setFirmwareFile] = useState<FirmwareFile | null>(null);
  const [otaDeviceId, setOtaDeviceId] = useState<string | undefined>();
  const [uploadState, setUploadState] = useState<{ busy: boolean; percent: number; message: string; ok?: boolean }>({
    busy: false,
    percent: 0,
    message: 'Select a device and firmware binary.',
  });

  const selectedDevice = devices.find((device) => device.id === selectedId) || devices[0];
  const otaDevice = devices.find((device) => device.id === otaDeviceId) || selectedDevice;

  useEffect(() => {
    localStorage.setItem(storageKeys.devices, JSON.stringify(devices));
  }, [devices]);

  useEffect(() => {
    localStorage.setItem(storageKeys.settings, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    getApi()?.getBackendStatus().then(setBackendStatus).catch(() => setBackendStatus(null));
  }, []);

  useEffect(() => {
    const dispose = getApi()?.onUploadProgress((progress: UploadProgress) => {
      setUploadState((current) => ({
        ...current,
        percent: progress.percent,
        message: `Uploading ${Math.round(progress.sent / 1024)} KB of ${Math.round(progress.total / 1024)} KB`,
      }));
    });
    return () => dispose?.();
  }, []);

  function mergeDevice(result: ProbeResult) {
    setDevices((current) => {
      const index = current.findIndex((device) => device.ip === result.ip);
      if (index === -1) return [...current, deviceFromProbe(result)];
      return current.map((device, deviceIndex) => (deviceIndex === index ? deviceFromProbe(result, device) : device));
    });
    setSelectedId((current) => current || result.ip);
  }

  async function refreshDevice(ip: string) {
    const host = normalizeIp(ip);
    setDevices((current) =>
      current.map((device) => (device.ip === host ? { ...device, status: 'loading', error: undefined } : device)),
    );
    const result = await getApi()?.probeDevice(host);
    if (result) mergeDevice(result);
  }

  async function addManualDevice() {
    const host = normalizeIp(manualIp);
    if (!host) return;
    const placeholder: DeviceRecord = {
      id: host,
      ip: host,
      name: host,
      status: 'loading',
      firmwareVersion: 'unknown',
      gpio: [],
      logs: [],
    };
    setDevices((current) => (current.some((device) => device.ip === host) ? current : [...current, placeholder]));
    setSelectedId(host);
    setManualIp('');
    await refreshDevice(host);
  }

  async function scanRange() {
    if (!settings.scanRange) return;
    setScanBusy(true);
    try {
      const results = await getApi()?.scanRange(settings.scanRange);
      results?.forEach(mergeDevice);
    } finally {
      setScanBusy(false);
    }
  }

  async function setGpio(device: DeviceRecord, pin: number, value: 0 | 1) {
    setDevices((current) => current.map((item) => (item.id === device.id ? { ...item, status: 'loading' } : item)));
    const result = await getApi()?.setGpio(device.ip, pin, value);
    if (result) mergeDevice(result);
  }

  async function refreshLogs(device: DeviceRecord) {
    const result = await getApi()?.getLogs(device.ip);
    if (!result?.ok) return;
    setDevices((current) => current.map((item) => (item.id === device.id ? { ...item, logs: result.logs || [] } : item)));
  }

  async function pickFirmware() {
    const file = await getApi()?.selectFirmwareFile();
    if (file) {
      setFirmwareFile(file);
      setUploadState({ busy: false, percent: 0, message: `${file.name} selected.` });
    }
  }

  async function uploadFirmware() {
    if (!otaDevice || !firmwareFile || otaDevice.status !== 'online') {
      setUploadState({ busy: false, percent: 0, ok: false, message: 'Select an online ESP32 and a .bin file first.' });
      return;
    }
    const requestId = crypto.randomUUID();
    setUploadState({ busy: true, percent: 0, message: 'Starting upload...' });
    const result = await getApi()?.uploadFirmware(otaDevice.ip, firmwareFile.path, requestId);
    if (result?.ok) {
      setUploadState({
        busy: false,
        percent: 100,
        ok: true,
        message: result.body || 'Update accepted. The ESP32 should reboot shortly.',
      });
      setTimeout(() => refreshDevice(otaDevice.ip), 4000);
    } else {
      setUploadState({
        busy: false,
        percent: 0,
        ok: false,
        message: result?.error || result?.body || 'Upload failed.',
      });
    }
  }

  const navigation = [
    { id: 'devices' as Section, label: 'Devices', icon: LayoutDashboard },
    { id: 'ota' as Section, label: 'OTA', icon: HardDriveUpload },
    { id: 'settings' as Section, label: 'Settings', icon: Settings },
  ];

  const onlineCount = devices.filter((device) => device.status === 'online').length;
  const configuredPins = useMemo(() => settings.gpioPins.filter(Number.isFinite), [settings.gpioPins]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Router size={28} />
          <div>
            <strong>Boardroom</strong>
            <span>ESP32 local control</span>
          </div>
        </div>
        <nav>
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => setSection(item.id)}>
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-status">
          <span>{onlineCount} online</span>
          <span>{devices.length} saved</span>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <h1>{section === 'devices' ? 'Devices' : section === 'ota' ? 'OTA Update' : 'Settings'}</h1>
            <p>
              {backendStatus
                ? `Local backend ${backendStatus.url}`
                : 'Browser fallback mode. Open with Electron for full backend features.'}
            </p>
          </div>
          <div className="topbar-actions">
            <input
              value={manualIp}
              onChange={(event) => setManualIp(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addManualDevice();
              }}
              placeholder="ESP32 IP address"
            />
            <button className="primary" onClick={addManualDevice}>
              <Plus size={17} />
              Add IP
            </button>
          </div>
        </header>

        {section === 'devices' && (
          <DevicesView
            devices={devices}
            selectedDevice={selectedDevice}
            settings={settings}
            configuredPins={configuredPins}
            scanBusy={scanBusy}
            onSelect={setSelectedId}
            onRefresh={refreshDevice}
            onScan={scanRange}
            onSetGpio={setGpio}
            onRefreshLogs={refreshLogs}
          />
        )}

        {section === 'ota' && (
          <OtaView
            devices={devices}
            selectedDevice={otaDevice}
            selectedId={otaDevice?.id}
            firmwareFile={firmwareFile}
            uploadState={uploadState}
            onSelectDevice={setOtaDeviceId}
            onPickFirmware={pickFirmware}
            onUpload={uploadFirmware}
          />
        )}

        {section === 'settings' && (
          <SettingsView
            settings={settings}
            backendStatus={backendStatus}
            onSettingsChange={setSettings}
            onScan={scanRange}
            scanBusy={scanBusy}
          />
        )}
      </main>
    </div>
  );
}

function DevicesView(props: {
  devices: DeviceRecord[];
  selectedDevice?: DeviceRecord;
  settings: AppSettings;
  configuredPins: number[];
  scanBusy: boolean;
  onSelect: (id: string) => void;
  onRefresh: (ip: string) => void;
  onScan: () => void;
  onSetGpio: (device: DeviceRecord, pin: number, value: 0 | 1) => void;
  onRefreshLogs: (device: DeviceRecord) => void;
}) {
  const { devices, selectedDevice, configuredPins } = props;
  return (
    <div className="content-grid">
      <section className="panel device-list-panel">
        <div className="panel-header">
          <div>
            <h2>Device List</h2>
            <p>Manual IPs and LAN scan results</p>
          </div>
          <button onClick={props.onScan} disabled={props.scanBusy}>
            {props.scanBusy ? <Loader2 className="spin" size={16} /> : <Search size={16} />}
            Scan
          </button>
        </div>

        {devices.length === 0 ? (
          <div className="empty-state">
            <Router size={34} />
            <strong>No devices saved</strong>
            <span>Add an ESP32 by IP address or scan the configured range.</span>
          </div>
        ) : (
          <div className="device-list">
            {devices.map((device) => (
              <button
                key={device.id}
                className={`device-row ${selectedDevice?.id === device.id ? 'selected' : ''}`}
                onClick={() => props.onSelect(device.id)}
              >
                <StatusIcon status={device.status} />
                <div>
                  <strong>{device.name}</strong>
                  <span>{device.ip}</span>
                </div>
                <div className="device-meta">
                  <span>{device.firmwareVersion}</span>
                  <span>{formatTime(device.lastSeen)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="panel detail-panel">
        {selectedDevice ? (
          <DeviceDetail
            device={selectedDevice}
            configuredPins={configuredPins}
            onRefresh={props.onRefresh}
            onSetGpio={props.onSetGpio}
            onRefreshLogs={props.onRefreshLogs}
          />
        ) : (
          <div className="empty-state detail-empty">
            <Activity size={36} />
            <strong>Select a device</strong>
            <span>Live status, GPIO, telemetry, and logs appear here.</span>
          </div>
        )}
      </section>
    </div>
  );
}

function DeviceDetail(props: {
  device: DeviceRecord;
  configuredPins: number[];
  onRefresh: (ip: string) => void;
  onSetGpio: (device: DeviceRecord, pin: number, value: 0 | 1) => void;
  onRefreshLogs: (device: DeviceRecord) => void;
}) {
  const { device, configuredPins } = props;
  const pinStates = new Map(device.gpio.map((pin) => [pin.pin, pin.value]));
  return (
    <>
      <div className="panel-header">
        <div>
          <h2>{device.name}</h2>
          <p>{device.ip}</p>
        </div>
        <button onClick={() => props.onRefresh(device.ip)} disabled={device.status === 'loading'}>
          {device.status === 'loading' ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
          Refresh
        </button>
      </div>

      <div className={`status-strip ${device.status}`}>
        <StatusIcon status={device.status} />
        <strong>{device.status === 'online' ? 'Online' : device.status === 'loading' ? 'Checking device' : 'Offline'}</strong>
        <span>{device.error || `Last seen ${formatTime(device.lastSeen)}`}</span>
      </div>

      <div className="telemetry-grid">
        <Metric icon={Activity} label="Uptime" value={formatDuration(device.info?.uptime)} />
        <Metric icon={Wifi} label="Wi-Fi RSSI" value={device.info ? `${device.info.rssi} dBm` : 'unknown'} />
        <Metric icon={Cpu} label="Chip ID" value={device.info?.chipId || 'unknown'} />
        <Metric icon={Router} label="Firmware" value={device.firmwareVersion} />
        <Metric icon={Activity} label="Free heap" value={formatBytes(device.info?.heap)} />
      </div>

      <div className="subsection">
        <div className="subsection-title">
          <h3>GPIO Controls</h3>
          <span>{configuredPins.length} configured pins</span>
        </div>
        <div className="gpio-grid">
          {configuredPins.map((pin) => {
            const value = pinStates.get(pin) || 0;
            return (
              <button
                key={pin}
                className={`gpio-button ${value ? 'on' : ''}`}
                disabled={device.status !== 'online'}
                onClick={() => props.onSetGpio(device, pin, value ? 0 : 1)}
              >
                {value ? <ToggleRight size={30} /> : <ToggleLeft size={30} />}
                <span>GPIO {pin}</span>
                <strong>{value ? 'High' : 'Low'}</strong>
              </button>
            );
          })}
        </div>
      </div>

      <div className="subsection logs-section">
        <div className="subsection-title">
          <h3>Live Log Console</h3>
          <button onClick={() => props.onRefreshLogs(device)} disabled={device.status !== 'online'}>
            <ListRestart size={15} />
            Refresh logs
          </button>
        </div>
        <pre className="log-console">
          {(device.logs.length ? device.logs : ['No logs received yet.']).map((line) => `${line}\n`)}
        </pre>
      </div>
    </>
  );
}

function OtaView(props: {
  devices: DeviceRecord[];
  selectedDevice?: DeviceRecord;
  selectedId?: string;
  firmwareFile: FirmwareFile | null;
  uploadState: { busy: boolean; percent: number; message: string; ok?: boolean };
  onSelectDevice: (id: string) => void;
  onPickFirmware: () => void;
  onUpload: () => void;
}) {
  const { selectedDevice, firmwareFile, uploadState } = props;
  return (
    <div className="single-column">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Firmware Upload</h2>
            <p>OTA works only after the first USB flash installs the Boardroom ESP32 agent.</p>
          </div>
          <button className="primary" onClick={props.onUpload} disabled={uploadState.busy}>
            {uploadState.busy ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}
            Upload
          </button>
        </div>

        <div className="ota-layout">
          <label className="field">
            <span>Target ESP32</span>
            <select value={props.selectedId || ''} onChange={(event) => props.onSelectDevice(event.target.value)}>
              <option value="" disabled>
                Select device
              </option>
              {props.devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name} ({device.ip}) {device.status !== 'online' ? '- offline' : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="file-picker">
            <div>
              <strong>{firmwareFile?.name || 'No .bin selected'}</strong>
              <span>{firmwareFile ? `${Math.round(firmwareFile.size / 1024)} KB` : 'Choose a compiled ESP32 firmware binary.'}</span>
            </div>
            <button onClick={props.onPickFirmware}>
              <HardDriveUpload size={16} />
              Select .bin
            </button>
          </div>

          <div className="upload-progress">
            <div className="progress-bar">
              <span style={{ width: `${uploadState.percent}%` }} />
            </div>
            <p className={uploadState.ok === false ? 'error-text' : uploadState.ok ? 'success-text' : ''}>{uploadState.message}</p>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="subsection-title">
          <h3>OTA Safety</h3>
        </div>
        <div className="notice-grid">
          <div>
            <strong>First flash still uses USB</strong>
            <span>The app cannot wirelessly flash a stock ESP32. The OTA endpoint exists only after the agent sketch is installed.</span>
          </div>
          <div>
            <strong>Use an OTA partition layout</strong>
            <span>Select a partition scheme with OTA app slots before building the binary.</span>
          </div>
          <div>
            <strong>Keep the device powered</strong>
            <span>Interrupting power during an update can leave the active app invalid.</span>
          </div>
        </div>
        {selectedDevice && (
          <div className={`status-strip compact ${selectedDevice.status}`}>
            <StatusIcon status={selectedDevice.status} />
            <strong>{selectedDevice.name}</strong>
            <span>{selectedDevice.status === 'online' ? `${selectedDevice.firmwareVersion} ready` : selectedDevice.error || 'Offline'}</span>
          </div>
        )}
      </section>
    </div>
  );
}

function SettingsView(props: {
  settings: AppSettings;
  backendStatus: { port: number; url: string } | null;
  scanBusy: boolean;
  onSettingsChange: (settings: AppSettings) => void;
  onScan: () => void;
}) {
  const pinsText = props.settings.gpioPins.join(', ');
  function updatePins(value: string) {
    const pins = value
      .split(',')
      .map((pin) => Number(pin.trim()))
      .filter((pin) => Number.isInteger(pin) && pin >= 0 && pin <= 39);
    props.onSettingsChange({ ...props.settings, gpioPins: pins });
  }
  return (
    <div className="single-column">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Network Discovery</h2>
            <p>Manual IPs are supported now. Range scanning is available for known subnets.</p>
          </div>
          <button onClick={props.onScan} disabled={props.scanBusy}>
            {props.scanBusy ? <Loader2 className="spin" size={16} /> : <Search size={16} />}
            Scan now
          </button>
        </div>
        <div className="settings-grid">
          <label className="field">
            <span>Default scan range</span>
            <input
              value={props.settings.scanRange}
              onChange={(event) => props.onSettingsChange({ ...props.settings, scanRange: event.target.value })}
              placeholder="192.168.1.1-254"
            />
          </label>
          <label className="field">
            <span>Configurable GPIO pins</span>
            <input value={pinsText} onChange={(event) => updatePins(event.target.value)} placeholder="2, 4, 5, 12, 13" />
          </label>
          <label className="field">
            <span>Backend port</span>
            <input
              type="number"
              value={props.settings.backendPort}
              onChange={(event) => props.onSettingsChange({ ...props.settings, backendPort: Number(event.target.value) })}
            />
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="subsection-title">
          <h3>Backend Status</h3>
          <Terminal size={18} />
        </div>
        <div className="backend-readout">
          <span>Runtime URL</span>
          <strong>{props.backendStatus?.url || 'Electron backend unavailable'}</strong>
          <span>Configured port</span>
          <strong>{props.settings.backendPort}</strong>
          <span>Discovery mode</span>
          <strong>Manual IP + subnet scan. mDNS service names are reserved in firmware for future automatic discovery.</strong>
        </div>
      </section>
    </div>
  );
}

function StatusIcon({ status }: { status: DeviceRecord['status'] }) {
  if (status === 'loading') return <Loader2 className="spin status loading" size={18} />;
  if (status === 'online') return <Wifi className="status online" size={18} />;
  if (status === 'offline') return <WifiOff className="status offline" size={18} />;
  return <Router className="status unknown" size={18} />;
}

function Metric({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="metric">
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
