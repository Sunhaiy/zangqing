import { ipcMain, BrowserWindow, dialog } from 'electron';
import { SSHManager } from './ssh/sshManager.js';
import { SSHConnection } from '../src/shared/types.js';
import Store from 'electron-store';

const sshManager = new SSHManager();
const store = new Store();

export function setupIpcHandlers() {
  // Store
  ipcMain.handle('store-get', (event, key) => store.get(key));
  ipcMain.handle('store-set', (event, key, value) => store.set(key, value));
  ipcMain.handle('store-delete', (event, key) => store.delete(key as any));

  ipcMain.handle('ssh-connect', async (event, connection: SSHConnection) => {
    try {
      await sshManager.connect(connection, event.sender);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.on('term-write', (event, { id, data }) => {
    sshManager.write(id, data);
  });

  ipcMain.on('term-resize', (event, { id, cols, rows }) => {
    sshManager.resize(id, cols, rows);
  });

  ipcMain.handle('sftp-list', (event, { id, path }) => {
    return sshManager.listFiles(id, path);
  });

  ipcMain.handle('sftp-upload', async (event, { id, localPath, remotePath }) => {
    return sshManager.uploadFile(id, localPath, remotePath);
  });

  ipcMain.handle('sftp-download', async (event, { id, remotePath, localPath }) => {
    return sshManager.downloadFile(id, remotePath, localPath);
  });

  ipcMain.handle('sftp-delete', async (event, { id, path }) => {
    return sshManager.deleteFile(id, path);
  });

  ipcMain.handle('sftp-mkdir', async (event, { id, path }) => {
    return sshManager.createFolder(id, path);
  });

  ipcMain.handle('sftp-rename', async (event, { id, oldPath, newPath }) => {
    return sshManager.renameFile(id, oldPath, newPath);
  });

  ipcMain.handle('sftp-read-file', async (event, { id, path }) => {
    return sshManager.readFile(id, path);
  });

  ipcMain.handle('sftp-write-file', async (event, { id, path, content }) => {
    return sshManager.writeFile(id, path, content);
  });

  ipcMain.handle('get-pwd', async (event, id) => {
    return sshManager.getPwd(id);
  });

  ipcMain.handle('dialog-open', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'] });
    return result.filePaths[0];
  });

  ipcMain.handle('dialog-save', async (event, defaultName) => {
    const result = await dialog.showSaveDialog({ defaultPath: defaultName });
    return result.filePath;
  });

  ipcMain.on('start-monitoring', (event, id) => {
    sshManager.startMonitoring(id, event.sender);
  });

  ipcMain.on('stop-monitoring', (event, id) => {
    sshManager.stopMonitoring(id);
  });

  ipcMain.handle('get-processes', async (event, id) => {
    return sshManager.getProcesses(id);
  });

  ipcMain.handle('kill-process', async (event, { id, pid }) => {
    return sshManager.killProcess(id, pid);
  });

  ipcMain.handle('docker-list', async (event, id) => {
    return sshManager.getDockerContainers(id);
  });

  ipcMain.handle('docker-action', async (event, { id, containerId, action }) => {
    return sshManager.dockerAction(id, containerId, action);
  });

  // Tunnels
  ipcMain.handle('tunnel-add', async (event, { id, type, config }) => {
    return sshManager.addTunnel(id, type, config);
  });

  ipcMain.handle('tunnel-remove', async (event, { id, tunnelId }) => {
    return sshManager.removeTunnel(id, tunnelId);
  });

  ipcMain.handle('tunnel-list', async (event, id) => {
    return sshManager.getTunnels(id);
  });

  // Window Controls
  ipcMain.on('window-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
  });

  ipcMain.on('window-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });

  ipcMain.on('window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
  });
}
