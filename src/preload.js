const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Folder operations
  selectFolder:  ()           => ipcRenderer.invoke('select-folder'),
  startWatch:    (folderPath) => ipcRenderer.invoke('start-watch', folderPath),
  stopWatch:     ()           => ipcRenderer.invoke('stop-watch'),
  getSavedFolder:()           => ipcRenderer.invoke('get-saved-folder'),
  getImages:     (folderPath) => ipcRenderer.invoke('get-images', folderPath),
  isWatching:    ()           => ipcRenderer.invoke('is-watching'),

  // Manual send / Delete operations
  manualSend:    (data)       => ipcRenderer.invoke('manual-send', data),
  deleteImage:   (imageId)    => ipcRenderer.invoke('delete-image', imageId),

  // Info / control
  getDbStatus:   ()           => ipcRenderer.invoke('get-db-status'),
  getStats:      ()           => ipcRenderer.invoke('get-stats'),
  retryFailed:   ()           => ipcRenderer.invoke('retry-failed'),

  // Frames
  uploadFrame:   ()           => ipcRenderer.invoke('upload-frame'),
  getFrames:     ()           => ipcRenderer.invoke('get-frames'),
  setActiveFrame:(filename)   => ipcRenderer.invoke('set-active-frame', filename),
  deleteFrame:   (filename)   => ipcRenderer.invoke('delete-frame', filename),

  // Event listeners
  onLog:         (cb) => ipcRenderer.on('log',          (_, d) => cb(d)),
  onDbStatus:    (cb) => ipcRenderer.on('db-status',    (_, d) => cb(d)),
  onImageStatus: (cb) => ipcRenderer.on('image-status', (_, d) => cb(d)),

  // Cleanup
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
