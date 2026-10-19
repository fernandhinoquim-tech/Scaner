// Puente seguro entre la interfaz y el proceso principal.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

async function call(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (r && typeof r === 'object' && '__error' in r) throw new Error(r.__error);
  return r;
}

function on(channel, cb) {
  const fn = (e, data) => cb(data);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
}

contextBridge.exposeInMainWorld('lanz', {
  platform: process.platform,

  getState: () => call('state:get'),
  onState: (cb) => on('state', cb),
  patch: (p) => call('config:patch', p),
  setItems: (wsId, items) => call('items:set', wsId, items),

  launch: (item, opts) => call('item:launch', item, opts),
  launchMany: (items) => call('item:launchMany', items),
  reveal: (p) => call('item:reveal', p),
  describePaths: (paths) => call('paths:describe', paths),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },

  listFolder: (p, opts) => call('folder:list', p, opts),
  recent: () => call('recent:list'),
  watchFolders: (paths) => ipcRenderer.send('folder:watch', paths),
  onFolderChanged: (cb) => on('folder:changed', cb),
  copyInto: (paths, dir) => call('files:copy', paths, dir),
  trash: (paths) => call('files:trash', paths),
  startDrag: (paths) => ipcRenderer.send('drag:start', paths),

  shelfAdd: (paths) => call('shelf:add', paths),
  shelfRemove: (paths) => call('shelf:remove', paths),
  shelfClear: () => call('shelf:clear'),
  shelfTransfer: (mode) => call('shelf:transfer', mode),

  pick: (opts) => call('dialog:pick', opts),
  apps: (refresh) => call('apps:list', refresh),
  searchIndex: () => call('search:index'),

  orgPlan: (folder, opts) => call('org:plan', folder, opts),
  orgApply: (id, exclude) => call('org:apply', id, exclude),
  orgHistory: () => call('org:history'),
  orgUndo: (id) => call('org:undo', id),

  clipList: () => call('clip:list'),
  clipCopy: (id) => call('clip:copy', id),
  clipPin: (id) => call('clip:pin', id),
  clipRemove: (id) => call('clip:remove', id),
  clipClear: () => call('clip:clear'),
  clipPause: (v) => call('clip:pause', v),
  onClip: (cb) => on('clip:changed', cb),

  sysStats: () => call('sys:stats'),
  suggestions: () => call('stats:suggest'),

  uploadIcons: () => call('icons:upload'),
  importIcons: (paths) => call('icons:import', paths),
  deleteIcon: (file) => call('icons:delete', file),
  clearIconCache: () => call('icons:clearCache'),
  onIconsRefresh: (cb) => on('icons:refresh', cb),

  exportBackup: () => call('backup:export'),
  importBackup: () => call('backup:import'),
  resetAll: () => call('app:reset'),

  appInfo: () => call('app:info'),
  checkUpdate: () => call('update:check'),
  installUpdate: () => call('update:install'),
  onUpdate: (cb) => on('update', cb),
  hotkeyStatus: () => call('hotkeys:status'),
  run: (cmd, arg) => call('cmd:run', cmd, arg),

  setInteractive: (v) => ipcRenderer.send('dock:interactive', v),
  raise: () => ipcRenderer.send('dock:raise'),
  cursor: () => ipcRenderer.invoke('dock:cursor'),
  focusDock: () => ipcRenderer.send('dock:focus'),
  openPanel: (route) => ipcRenderer.send('panel:open', route),
  openSearch: (q) => ipcRenderer.send('search:open', q),
  hideSearch: () => ipcRenderer.send('search:hide'),
  onSearchShown: (cb) => on('search:shown', cb),
  onSearchHidden: (cb) => on('search:hidden', cb),
  onRoute: (cb) => on('panel:route', cb),
  closeWindow: () => ipcRenderer.send('win:close'),
  minimizeWindow: () => ipcRenderer.send('win:minimize'),
});
