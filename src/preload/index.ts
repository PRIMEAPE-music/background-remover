import { contextBridge, ipcRenderer } from 'electron';

export interface OpenedImage {
  path: string;
  data: Uint8Array;
}

export type GeminiAspect = '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | '21:9' | 'auto';
export type GeminiSize = '1K' | '2K' | '4K';

export type GenerateResponse =
  | { ok: true; imageBytes: ArrayBuffer; mime: string }
  | {
      ok: false;
      kind: 'safety' | 'rate-limit' | 'auth' | 'network' | 'no-image' | 'cancelled' | 'other';
      message: string;
      status?: number;
    };

const api = {
  openImages: (): Promise<OpenedImage[]> => ipcRenderer.invoke('dialog:openImage'),
  openImagePaths: (): Promise<string[]> => ipcRenderer.invoke('dialog:openImagePaths'),
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  saveImage: (defaultName: string, buffer: ArrayBuffer): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveImage', defaultName, buffer),
  listImages: (folderPath: string): Promise<string[]> =>
    ipcRenderer.invoke('fs:listImages', folderPath),
  readFile: (filePath: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, buffer: ArrayBuffer): Promise<string> =>
    ipcRenderer.invoke('fs:writeFile', filePath, buffer),
  mkdir: (dirPath: string): Promise<string> => ipcRenderer.invoke('fs:mkdir', dirPath),
  renameFile: (from: string, to: string): Promise<string> =>
    ipcRenderer.invoke('fs:rename', from, to),
  unlinkFile: (filePath: string): Promise<string> => ipcRenderer.invoke('fs:unlink', filePath),

  // Gemini
  geminiSaveKey: (key: string): Promise<boolean> => ipcRenderer.invoke('gemini:saveKey', key),
  geminiLoadKey: (): Promise<string | null> => ipcRenderer.invoke('gemini:loadKey'),
  geminiClearKey: (): Promise<boolean> => ipcRenderer.invoke('gemini:clearKey'),
  geminiGenerate: (args: {
    jobId: string;
    apiKey: string;
    prompt: string;
    aspectRatio: GeminiAspect;
    size: GeminiSize;
    referenceImage?: { mime: string; data: ArrayBuffer };
  }): Promise<GenerateResponse> => ipcRenderer.invoke('gemini:generate', args),
  geminiCancel: (jobId: string): Promise<boolean> => ipcRenderer.invoke('gemini:cancel', jobId),
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
