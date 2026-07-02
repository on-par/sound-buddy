import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('soundBuddy', {
  analyzeFile: (opts: { filePath: string; noSpectrum?: boolean }) =>
    ipcRenderer.invoke('analyze-file', opts),

  listDevices: () => ipcRenderer.invoke('list-devices'),

  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),

  openDirDialog: () => ipcRenderer.invoke('open-dir-dialog'),

  startLive: (opts: { device?: string; channels?: number[]; windowSecs: number; llmIntervalSecs: number }) =>
    ipcRenderer.invoke('start-live', opts),

  stopLive: () => ipcRenderer.invoke('stop-live'),

  triggerLlmAnalysis: (data: unknown) => ipcRenderer.invoke('trigger-llm-analysis', data),

  onLiveEvent: (cb: (data: unknown) => void) =>
    ipcRenderer.on('live-event', (_event, d) => cb(d)),

  onLlmDelta: (cb: (text: string) => void) =>
    ipcRenderer.on('llm-delta', (_event, t) => cb(t)),

  onLlmDone: (cb: () => void) =>
    ipcRenderer.on('llm-done', () => cb()),

  onAnalysisResult: (cb: (data: unknown) => void) =>
    ipcRenderer.on('analysis-result', (_event, d) => cb(d)),

  onMenuOpenFile: (cb: (filePath: string) => void) =>
    ipcRenderer.on('menu-open-file', (_event, fp) => cb(fp)),

  removeAllListeners: (ch: string) => ipcRenderer.removeAllListeners(ch),
});
