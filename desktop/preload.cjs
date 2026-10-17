/**
 * Atlas Desktop — Preload
 * پل امن بین رندرر و پروسهٔ اصلی.
 * sandbox:true (اجرای ایزوله) + contextIsolation:true → فقط API محدود الکترون در دسترس است.
 */
const { contextBridge, ipcRenderer } = require("electron");

/** گرفتن اسکرین‌شات از صفحهٔ اصلی — اجرا در پروسهٔ اصلی (sandbox اجازهٔ DOM در preload را نمیدهد) */
async function captureScreen() {
  const r = await ipcRenderer.invoke("atlas:screen-capture");
  if (!r || !r.ok) throw new Error((r && r.error) || "اسکرین‌شات ناموفق بود");
  return r.dataUrl;
}

contextBridge.exposeInMainWorld("atlasAPI", {
  platform: process.platform,
  invokeTool: (tool, args) => ipcRenderer.invoke("atlas:tool", { tool, args }),
  captureScreen,
  openExternal: (url) => ipcRenderer.send("atlas:open-external", url),
  setConfirm: (enabled) => ipcRenderer.invoke("atlas:set-confirm", enabled),
  setPlan: (enabled) => ipcRenderer.invoke("atlas:set-plan", enabled),
  proxy: (opts) => ipcRenderer.invoke("atlas:proxy", opts),
  /** ترمینال تعاملی — نشست شل واقعی */
  terminal: {
    start: () => ipcRenderer.invoke("atlas:term-start"),
    write: (id, data) => ipcRenderer.send("atlas:term-write", { id, data }),
    signal: (id, signal) => ipcRenderer.send("atlas:term-signal", { id, signal }),
    kill: (id) => ipcRenderer.send("atlas:term-kill", { id }),
    onData: (cb) => {
      const listener = (_e, data) => cb(data);
      ipcRenderer.on("atlas:term-data", listener);
      return () => ipcRenderer.removeListener("atlas:term-data", listener);
    },
    onExit: (cb) => {
      const listener = (_e, data) => cb(data);
      ipcRenderer.on("atlas:term-exit", listener);
      return () => ipcRenderer.removeListener("atlas:term-exit", listener);
    },
  },
  onActivity: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on("atlas:activity", listener);
    return () => ipcRenderer.removeListener("atlas:activity", listener);
  },
});
