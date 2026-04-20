import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';

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
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
