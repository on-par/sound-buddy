import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('soundBuddy', {
  getSettings: () => ipcRenderer.invoke('get-settings'),

  updateSettings: (patch: { aiEnabled?: boolean; idealProfile?: string }) =>
    ipcRenderer.invoke('update-settings', patch),

  // Capture rigs (#36) — backend only for now; the Live-tab UI arrives in #37.
  listRigs: () => ipcRenderer.invoke('list-rigs'),
  saveRig: (rig: unknown) => ipcRenderer.invoke('save-rig', rig),
  deleteRig: (id: string) => ipcRenderer.invoke('delete-rig', id),
  setActiveRig: (id: string | null) => ipcRenderer.invoke('set-active-rig', id),

  analyzeFile: (opts: { filePath: string; noSpectrum?: boolean }) =>
    ipcRenderer.invoke('analyze-file', opts),

  listDevices: () => ipcRenderer.invoke('list-devices'),

  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),

  openDirDialog: () => ipcRenderer.invoke('open-dir-dialog'),

  startLive: (opts: {
    device?: string;
    channels?: string[];
    windowSecs: number;
    intervalSecs?: number;
    llmIntervalSecs: number;
    mode?: 'monitor' | 'record';
    recordDir?: string;
    // Record mode: which strips to arm as session stems, as channel-config
    // tokens (e.g. ['0', '2-3']). Omitted ⇒ all configured strips are armed.
    arm?: string[];
  }) => ipcRenderer.invoke('start-live', opts),

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

  // Updates
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  openReleasePage: (url?: string) => ipcRenderer.invoke('open-release-page', url),
  onUpdateAvailable: (cb: (info: { version: string; url: string; notes: string }) => void) =>
    ipcRenderer.on('update-available', (_event, info) => cb(info)),
  onUpdateStatus: (cb: (status: { state: string; version?: string }) => void) =>
    ipcRenderer.on('update-status', (_event, s) => cb(s)),

  removeAllListeners: (ch: string) => ipcRenderer.removeAllListeners(ch),
});
