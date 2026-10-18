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
  /** فایل providers.json در app-data (خواندن/نوشتن کانفیگ پرووایدرها) */
  providersRead: () => ipcRenderer.invoke("atlas:providers-read"),
  providersWrite: (content) => ipcRenderer.invoke("atlas:providers-write", { content }),
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
  /* ─── کارهای پس‌زمینه و زمان‌بندی‌شده ─── */
  bgCreate: (t) => ipcRenderer.invoke("atlas:bg-create", t),
  bgUpdate: (id, patch) => ipcRenderer.invoke("atlas:bg-update", id, patch),
  bgCancel: (id) => ipcRenderer.invoke("atlas:bg-cancel", id),
  bgApprovalResolved: (taskId, approvalId, status, result) =>
    ipcRenderer.invoke("atlas:bg-approval-resolved", taskId, approvalId, status, result),
  tasksList: () => ipcRenderer.invoke("atlas:tasks-list"),
  scheduleAdd: (s) => ipcRenderer.invoke("atlas:schedule-add", s),
  scheduleUpdate: (id, patch) => ipcRenderer.invoke("atlas:schedule-update", id, patch),
  scheduleRemove: (id) => ipcRenderer.invoke("atlas:schedule-remove", id),
  onTasksChanged: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on("atlas:tasks-changed", listener);
    return () => ipcRenderer.removeListener("atlas:tasks-changed", listener);
  },
  onScheduleFire: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on("atlas:schedule-fire", listener);
    return () => ipcRenderer.removeListener("atlas:schedule-fire", listener);
  },
  onActivity: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on("atlas:activity", listener);
    return () => ipcRenderer.removeListener("atlas:activity", listener);
  },
  /* ─── کانکتورهای MCP ─── */
  mcp: {
    list: () => ipcRenderer.invoke("atlas:mcp-list"),
    tools: (serverId) => ipcRenderer.invoke("atlas:mcp-tools", { serverId }),
    toolsAll: () => ipcRenderer.invoke("atlas:mcp-tools-all"),
    test: (serverId) => ipcRenderer.invoke("atlas:mcp-test", { serverId }),
    call: (serverId, tool, args) => ipcRenderer.invoke("atlas:mcp-call", { serverId, tool, args }),
    disconnect: (serverId) => ipcRenderer.invoke("atlas:mcp-disconnect", { serverId }),
  },
});
