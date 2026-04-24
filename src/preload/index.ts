import { contextBridge, ipcRenderer } from 'electron';

export interface OpenedImage {
  path: string;
  data: Uint8Array;
}

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
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
