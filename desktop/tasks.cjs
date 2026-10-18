/**
 * Atlas Desktop — Task Service (پروسهٔ اصلی)
 * رجیستری کارهای پس‌زمینه + زمان‌بند کرونی + ناتیفیکیشن دسکتاپ.
 *
 * معماری: پروسهٔ اصلی «مالک» رجیستری، پایداری (atlas-tasks.json)،
 * تایمرهای زمان‌بند و ناتیفیکیشن‌هاست؛ اجرای واقعی موتور ایجنت در رندرر
 * انجام می‌شود (همان AI SDK و استور تنظیمات) و نتیجه را با IPC برمی‌گرداند.
 * با tray، بستن پنجره برنامه را نمی‌بندد پس تسک‌ها با بستن/مینیمایز نمی‌میرند.
 */
const { ipcMain, app, BrowserWindow, Notification } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { Cron } = require("croner");

const TASKS_FILE = () => path.join(app.getPath("userData"), "atlas-tasks.json");
/** سقف هر تایمر (جلوگیری از سرریز setTimeout و تطبیق با تغییر ساعت) */
const MAX_TIMER_MS = 7 * 24 * 60 * 60 * 1000;

let registry = { version: 1, bgTasks: [], schedules: [] };
/** scheduleId -> timeout */
const timers = new Map();
let seq = 0;

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${(++seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

function loadRegistry() {
  try {
    const raw = fs.readFileSync(TASKS_FILE(), "utf8");
    const j = JSON.parse(raw);
    registry = {
      version: 1,
      bgTasks: Array.isArray(j.bgTasks) ? j.bgTasks : [],
      schedules: Array.isArray(j.schedules) ? j.schedules : [],
    };
  } catch {
    registry = { version: 1, bgTasks: [], schedules: [] };
  }
  // تسک‌هایی که هنگام بسته‌شدن برنامه «در حال اجرا» مانده‌اند، مرده‌اند
  let changed = false;
  for (const t of registry.bgTasks) {
    if (t.status === "running") {
      t.status = "error";
      t.error = "با بسته‌شدن برنامه متوقف شد.";
      t.finishedAt = Date.now();
      changed = true;
    }
  }
  if (changed) saveRegistry();
}

function saveRegistry() {
  // فقط ۱۰۰ تسک آخر نگه داشته می‌شود (جلوگیری از رشد فایل)
  const slim = {
    version: 1,
    bgTasks: registry.bgTasks.slice(0, 100),
    schedules: registry.schedules,
  };
  fsp.writeFile(TASKS_FILE(), JSON.stringify(slim, null, 2), "utf8").catch(() => {});
}

function snapshot() {
  return { bgTasks: registry.bgTasks, schedules: registry.schedules };
}

function broadcastChanged() {
  const s = snapshot();
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("atlas:tasks-changed", s);
  }
}

function focusWindow() {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

function notify(title, body) {
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body: String(body || "").slice(0, 200) });
    n.on("click", focusWindow);
    n.show();
  } catch {
    /* ناتیفیکیشن اختیاری است */
  }
}

/* ─── زمان‌بند ─── */

function clearTimer(id) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
}

function armSchedule(s) {
  clearTimer(s.id);
  if (!s.enabled) return;
  let next;
  try {
    next = new Cron(s.cron).nextRun();
  } catch {
    return; // کرون نامعتبر — نباید تایمر بزند
  }
  if (!next) return;
  const ms = next.getTime() - Date.now();
  if (ms <= 0) {
    // از موعد گذشته؛ کمی بعد دوباره محاسبه کن
    timers.set(s.id, setTimeout(() => armSchedule(s), 60_000));
    return;
  }
  s.nextRun = next.getTime();
  const wait = Math.min(ms, MAX_TIMER_MS);
  timers.set(
    s.id,
    setTimeout(() => {
      const cur = registry.schedules.find((x) => x.id === s.id);
      if (!cur || !cur.enabled) return;
      // اگر هنوز به موعد واقعی نرسیده‌ایم (به‌خاطر سقف تایمر)، دوباره مسلح کن
      let remain = 0;
      try {
        remain = new Cron(cur.cron).nextRun().getTime() - Date.now();
      } catch {
        return;
      }
      if (remain > 60_000) {
        armSchedule(cur);
        saveRegistry();
        broadcastChanged();
        return;
      }
      fireSchedule(cur);
    }, wait),
  );
}

function fireSchedule(s) {
  s.lastRun = Date.now();
  const task = {
    id: newId("bg"),
    title: s.title,
    prompt: s.prompt,
    kind: "scheduled",
    scheduleId: s.id,
    status: "running",
    createdAt: Date.now(),
    pendingApprovals: [],
    toolLog: [],
  };
  registry.bgTasks.unshift(task);
  armSchedule(s); // مسلح‌سازی مجدد برای اجرای بعدی
  saveRegistry();
  broadcastChanged();
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      w.webContents.send("atlas:schedule-fire", {
        taskId: task.id,
        scheduleId: s.id,
        title: s.title,
        prompt: s.prompt,
      });
    }
  }
}

/* ─── هندلرهای IPC ─── */

function registerTasks() {
  loadRegistry();

  ipcMain.handle("atlas:tasks-list", () => ({ ok: true, snapshot: snapshot() }));

  ipcMain.handle("atlas:bg-create", (_e, { title, prompt, kind, scheduleId } = {}) => {
    if (!prompt || !String(prompt).trim()) return { ok: false, error: "پرامپت خالی است" };
    const task = {
      id: newId("bg"),
      title: String(title || "").trim() || String(prompt).slice(0, 60),
      prompt: String(prompt),
      kind: kind === "scheduled" ? "scheduled" : "background",
      scheduleId,
      status: "running",
      createdAt: Date.now(),
      pendingApprovals: [],
      toolLog: [],
    };
    registry.bgTasks.unshift(task);
    saveRegistry();
    broadcastChanged();
    return { ok: true, id: task.id };
  });

  ipcMain.handle("atlas:bg-update", (_e, id, patch = {}) => {
    const t = registry.bgTasks.find((x) => x.id === id);
    if (!t) return { ok: false, error: "تسک یافت نشد" };
    const allowed = [
      "status", "progressNote", "result", "error",
      "pendingApprovals", "toolLog", "finishedAt", "title",
    ];
    for (const k of allowed) {
      if (patch[k] !== undefined) t[k] = patch[k];
    }
    if ((t.status === "done" || t.status === "error") && !t.finishedAt) {
      t.finishedAt = Date.now();
    }
    saveRegistry();
    broadcastChanged();
    if (t.status === "done") {
      notify("Atlas — کار پس‌زمینه تمام شد", t.title);
    } else if (t.status === "error") {
      notify("Atlas — کار پس‌زمینه با خطا مواجه شد", t.title);
    }
    return { ok: true };
  });

  ipcMain.handle("atlas:bg-cancel", (_e, id) => {
    const t = registry.bgTasks.find((x) => x.id === id);
    if (!t) return { ok: false, error: "تسک یافت نشد" };
    if (t.status === "running") {
      t.status = "cancelled";
      t.finishedAt = Date.now();
      saveRegistry();
      broadcastChanged();
    }
    return { ok: true };
  });

  ipcMain.handle("atlas:bg-approval-resolved", (_e, taskId, approvalId, status, result) => {
    const t = registry.bgTasks.find((x) => x.id === taskId);
    if (!t) return { ok: false, error: "تسک یافت نشد" };
    const a = (t.pendingApprovals || []).find((x) => x.id === approvalId);
    if (!a) return { ok: false, error: "درخواست یافت نشد" };
    a.status = status === "approved" ? "approved" : "rejected";
    if (result !== undefined) a.result = result;
    saveRegistry();
    broadcastChanged();
    return { ok: true };
  });

  ipcMain.handle("atlas:schedule-add", (_e, { title, prompt, cron, label } = {}) => {
    if (!prompt || !String(prompt).trim()) return { ok: false, error: "پرامپت خالی است" };
    try {
      new Cron(String(cron || ""));
    } catch {
      return { ok: false, error: "عبارت کرون نامعتبر است" };
    }
    const s = {
      id: newId("sch"),
      title: String(title || "").trim() || String(prompt).slice(0, 60),
      prompt: String(prompt),
      cron: String(cron),
      label: String(label || cron),
      enabled: true,
      createdAt: Date.now(),
    };
    registry.schedules.unshift(s);
    armSchedule(s);
    saveRegistry();
    broadcastChanged();
    return { ok: true, id: s.id };
  });

  ipcMain.handle("atlas:schedule-update", (_e, id, patch = {}) => {
    const s = registry.schedules.find((x) => x.id === id);
    if (!s) return { ok: false, error: "زمان‌بند یافت نشد" };
    if (patch.cron !== undefined) {
      try {
        new Cron(String(patch.cron));
      } catch {
        return { ok: false, error: "عبارت کرون نامعتبر است" };
      }
      s.cron = String(patch.cron);
    }
    if (patch.title !== undefined) s.title = String(patch.title);
    if (patch.prompt !== undefined) s.prompt = String(patch.prompt);
    if (patch.label !== undefined) s.label = String(patch.label);
    if (patch.enabled !== undefined) s.enabled = patch.enabled !== false;
    armSchedule(s);
    saveRegistry();
    broadcastChanged();
    return { ok: true };
  });

  ipcMain.handle("atlas:schedule-remove", (_e, id) => {
    clearTimer(id);
    registry.schedules = registry.schedules.filter((x) => x.id !== id);
    saveRegistry();
    broadcastChanged();
    return { ok: true };
  });

  // مسلح‌سازی اولیهٔ همهٔ زمان‌بندها بعد از بالا آمدن اپ
  app.whenReady().then(() => {
    for (const s of registry.schedules) armSchedule(s);
    broadcastChanged();
  });
}

module.exports = { registerTasks };
