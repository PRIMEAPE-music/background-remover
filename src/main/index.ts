import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile, writeFile, readdir, stat, mkdir, rename, unlink } from 'node:fs/promises';
import {
  generateImage,
  saveApiKey,
  loadApiKey,
  clearApiKey,
  GeminiError,
  type GeminiAspect,
  type GeminiSize,
} from './gemini.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1e1e22',
    autoHideMenuBar: true,
    title: 'Background Remover',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
    // Don't auto-open DevTools — it attaches the React DevTools hook which
    // snapshots large state/prop values and can stall setState by seconds.
    // Toggle with Ctrl+Shift+I when you need it.
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // F5 / Ctrl+R to reload; Ctrl+Shift+I to toggle DevTools.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    if (key === 'f5' || (input.control && key === 'r')) {
      win.webContents.reloadIgnoringCache();
      event.preventDefault();
    } else if (input.control && input.shift && key === 'i') {
      if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
      else win.webContents.openDevTools({ mode: 'detach' });
      event.preventDefault();
    } else if (key === 'f12') {
      if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
      else win.webContents.openDevTools({ mode: 'detach' });
      event.preventDefault();
    }
  });
}

ipcMain.handle('dialog:openImage', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select image(s)',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
  });
  if (result.canceled) return [];
  return Promise.all(
    result.filePaths.map(async (path) => ({
      path,
      data: await readFile(path),
    })),
  );
});

// Dialog-only: lets the renderer time the picker separately from the file read.
ipcMain.handle('dialog:openImagePaths', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select image(s)',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:saveImage', async (_, defaultName: string, buffer: ArrayBuffer) => {
  const result = await dialog.showSaveDialog({
    title: 'Save image',
    defaultPath: defaultName,
    filters: [{ name: 'PNG', extensions: ['png'] }],
  });
  if (result.canceled || !result.filePath) return null;
  await writeFile(result.filePath, Buffer.from(buffer));
  return result.filePath;
});

ipcMain.handle('fs:listImages', async (_, folderPath: string) => {
  const entries = await readdir(folderPath);
  const images: string[] = [];
  for (const entry of entries) {
    const full = join(folderPath, entry);
    const s = await stat(full);
    if (s.isFile() && /\.(png|jpg|jpeg|webp|bmp|gif)$/i.test(entry)) {
      images.push(full);
    }
  }
  return images;
});

ipcMain.handle('fs:readFile', async (_, filePath: string) => {
  return await readFile(filePath);
});

ipcMain.handle('fs:writeFile', async (_, filePath: string, buffer: ArrayBuffer) => {
  await writeFile(filePath, Buffer.from(buffer));
  return filePath;
});

ipcMain.handle('fs:mkdir', async (_, dirPath: string) => {
  await mkdir(dirPath, { recursive: true });
  return dirPath;
});

ipcMain.handle('fs:rename', async (_, from: string, to: string) => {
  await rename(from, to);
  return to;
});

ipcMain.handle('fs:unlink', async (_, filePath: string) => {
  await unlink(filePath);
  return filePath;
});

ipcMain.handle('gemini:saveKey', async (_, key: string) => {
  await saveApiKey(key);
  return true;
});

ipcMain.handle('gemini:loadKey', async () => {
  return await loadApiKey();
});

ipcMain.handle('gemini:clearKey', async () => {
  await clearApiKey();
  return true;
});

// One AbortController per active generate job, keyed by jobId so the renderer
// can cancel a specific batch row mid-flight.
const generateJobs = new Map<string, AbortController>();

ipcMain.handle(
  'gemini:generate',
  async (
    _,
    args: {
      jobId: string;
      apiKey: string;
      prompt: string;
      aspectRatio: GeminiAspect;
      size: GeminiSize;
      referenceImage?: { mime: string; data: ArrayBuffer };
    },
  ) => {
    const ctrl = new AbortController();
    generateJobs.set(args.jobId, ctrl);
    try {
      const result = await generateImage({
        apiKey: args.apiKey,
        prompt: args.prompt,
        aspectRatio: args.aspectRatio,
        size: args.size,
        referenceImage: args.referenceImage
          ? { mime: args.referenceImage.mime, data: new Uint8Array(args.referenceImage.data) }
          : undefined,
        signal: ctrl.signal,
      });
      return {
        ok: true as const,
        imageBytes: result.imageBytes.buffer.slice(
          result.imageBytes.byteOffset,
          result.imageBytes.byteOffset + result.imageBytes.byteLength,
        ),
        mime: result.mime,
      };
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        return { ok: false as const, kind: 'cancelled' as const, message: 'Cancelled' };
      }
      if (e instanceof GeminiError) {
        return { ok: false as const, kind: e.kind, message: e.message, status: e.status };
      }
      return { ok: false as const, kind: 'other' as const, message: (e as Error).message };
    } finally {
      generateJobs.delete(args.jobId);
    }
  },
);

ipcMain.handle('gemini:cancel', async (_, jobId: string) => {
  const ctrl = generateJobs.get(jobId);
  if (ctrl) ctrl.abort();
  return true;
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
