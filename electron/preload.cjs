const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('boardroom', {
  getBackendStatus: () => ipcRenderer.invoke('backend:status'),
  probeDevice: (ip) => ipcRenderer.invoke('device:probe', ip),
  scanRange: (range) => ipcRenderer.invoke('device:scan-range', range),
  setGpio: (ip, pin, value) => ipcRenderer.invoke('device:set-gpio', { ip, pin, value }),
  getLogs: (ip) => ipcRenderer.invoke('device:get-logs', ip),
  selectFirmwareFile: () => ipcRenderer.invoke('firmware:select-file'),
  uploadFirmware: (ip, filePath, requestId) => ipcRenderer.invoke('firmware:upload', { ip, filePath, requestId }),
  onUploadProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('firmware:upload-progress', listener);
    return () => ipcRenderer.removeListener('firmware:upload-progress', listener);
  },
});
