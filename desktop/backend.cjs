/**
 * Atlas Desktop — Backend Agent
 * پروسهٔ اصلی الکترون: اجرای ابزارهای عامل روی سیستم واقعی.
 * از طریق IPC (atlas:tool) از رندرر فراخوانی میشود.
 */
const { ipcMain, app, BrowserWindow, clipboard, screen, shell, dialog } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { exec, spawn } = require("node:child_process");

const MAX_OUTPUT = 200000;
const MAX_FILE_READ = 400000;
const COMMAND_TIMEOUT = 30000;

/**
 * نرمال‌سازی و اعتبارسنجی مسیر:
 * - تیلیدِ ~ به خانهٔ کاربر
 * - حل کردن نسبی/مطلق و حذف ../ تو در تو
 * - رد کردن کاراکترهای کنترلی (مثل null byte)
 * توجه: این ابزارها سطح دسترسی خودِ کاربر را دارند (مانند شل)؛ هدف جلوگیری از
 * ورودیهای خراب‌کننده است نه جیل کردن فایل‌سیستم.
 */
function resolvePath(input) {
  const raw = typeof input === "string" && input.trim() ? input : os.homedir();
  if (raw.includes("\0")) throw new Error("مسیر نامعتبر (کاراکتر کنترلی)");
  const expanded = raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
  return path.resolve(expanded);
}

/* ─── تأیید دستورات خطرناک ─── */
const DANGEROUS = new Set([
  "shell_exec", "proc_kill",
  "mouse_move", "mouse_click", "mouse_scroll",
  "keyboard_type", "keyboard_press",
]);
let confirmDangerous = loadConfirm();
const confirmPath = path.join(app.getPath("userData"), "atlas-confirm.json");

/* ─── حالت پلن (در انتظار تأیید) ─── */
const planPath = path.join(app.getPath("userData"), "atlas-plan.json");
let planMode = loadPlan();
function loadPlan() {
  try {
    return JSON.parse(fs.readFileSync(planPath, "utf8")).planMode !== false;
  } catch {
    return false;
  }
}
function savePlan() {
  fsp.writeFile(planPath, JSON.stringify({ planMode }), "utf8").catch(() => {});
}

function loadConfirm() {
  try {
    const j = JSON.parse(fs.readFileSync(confirmPath, "utf8"));
    return j.confirmDangerous !== false;
  } catch {
    return true; // پیش‌فرض: تأیید کاربر لازم است
  }
}
function saveConfirm() {
  fsp.writeFile(confirmPath, JSON.stringify({ confirmDangerous }), "utf8").catch(() => {});
}

/** نمایش دیالوگ تأیید برای ابزارهای خطرناک (فقط روی دسکتاپ) */
function requestConfirm(tool, args) {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const detail =
    tool === "shell_exec"
      ? String((args && args.command) || "")
      : tool === "proc_kill"
        ? `PID: ${args && args.pid}`
        : JSON.stringify(args || {});
  const { response, checkboxChecked } = dialog.showMessageBoxSync(win, {
    type: "warning",
    title: "Atlas — تأیید دستور سیستمی",
    message: `Atlas قصد اجرای ابزار «${tool}» را دارد.`,
    detail,
    buttons: ["تأیید", "لغو"],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: "این جلسه را بدون تأیید ادامه بده",
  });
  if (checkboxChecked) {
    confirmDangerous = false;
    saveConfirm();
  }
  return response === 0;
}

let memoryPath = null;

function memFile() {
  if (!memoryPath) {
    memoryPath = path.join(app.getPath("userData"), "atlas-memory.json");
  }
  return memoryPath;
}

function readMemory() {
  try {
    return JSON.parse(fs.readFileSync(memFile(), "utf8") || "{}");
  } catch {
    return {};
  }
}

function writeMemory(obj) {
  fsp.writeFile(memFile(), JSON.stringify(obj, null, 2)).catch(() => {});
}

function broadcast(activity) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("atlas:activity", activity);
  }
}

/** اجرای فرمان با محدودیت زمان و حجم خروجی */
function runRaw(command, { cwd, timeoutMs = COMMAND_TIMEOUT, maxBuffer } = {}) {
  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd: cwd || undefined,
        timeout: timeoutMs,
        maxBuffer: maxBuffer || 64 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, ATLAS_AGENT: "1" },
      },
      (error, stdout, stderr) => {
        const timedOut = !!error && (error.killed || error.signal === "SIGKILL");
        resolve({
          stdout: String(stdout || "").slice(0, MAX_OUTPUT),
          stderr: String(stderr || "").slice(0, MAX_OUTPUT),
          exitCode: error && typeof error.code === "number" ? error.code : error ? 1 : 0,
          timedOut,
          signal: error && error.signal ? error.signal : null,
        });
      },
    );
  });
}

/** اجرای فایل با آرگومان (بدون پوسته) */
function runFile(cmd, args = [], timeoutMs = COMMAND_TIMEOUT) {
  return new Promise((resolve) => {
    const cp = spawn(cmd, args, { windowsHide: true, timeout: timeoutMs });
    let out = "";
    let err = "";
    const to = setTimeout(() => cp.kill("SIGKILL"), timeoutMs + 5000);
    cp.stdout.on("data", (d) => (out += d));
    cp.stderr.on("data", (d) => (err += d));
    cp.on("close", (code, signal) => {
      clearTimeout(to);
      resolve({
        stdout: out.slice(0, MAX_OUTPUT),
        stderr: err.slice(0, MAX_OUTPUT),
        exitCode: code ?? 0,
        signal,
      });
    });
    cp.on("error", (e) => {
      clearTimeout(to);
      resolve({ stdout: out, stderr: String(e.message), exitCode: 127 });
    });
  });
}

/* ═════════ ابزارها ═════════ */

const tools = {
  /* ─── اطلاعات سیستم ─── */
  system_info: async () => ({
    platform: process.platform,
    arch: os.arch(),
    hostname: os.hostname(),
    homedir: os.homedir(),
    cpus: os.cpus().length,
    uptimeSec: Math.floor(os.uptime()),
    totalMemMB: Math.round(os.totalmem() / 1024 / 1024),
    freeMemMB: Math.round(os.freemem() / 1024 / 1024),
    displays: screen.getAllDisplays().length,
  }),

  /* ─── فایل‌سیستم ─── */
  fs_list: async ({ path: p }) => {
    const base = resolvePath(p);
    const entries = await fsp.readdir(base, { withFileTypes: true });
    const items = entries
      .map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "dir" : e.isSymbolicLink() ? "link" : "file",
      }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
    return { path: base, count: items.length, entries: items.slice(0, 400) };
  },

  fs_read: async ({ path: p, limit }) => {
    const rp = resolvePath(p);
    const stat = await fsp.stat(rp);
    if (stat.isDirectory()) return { isDir: true, path: rp };
    const size = stat.size;
    if (size > MAX_FILE_READ * 4) {
      return { path: rp, size, truncated: true, note: "فایل بزرگ است؛ از fs_read با limit استفاده کنید." };
    }
    const buf = await fsp.readFile(rp);
    const text = buf.toString("utf8");
    const limited = limit ? text.slice(0, limit) : text.slice(0, MAX_FILE_READ);
    return { path: rp, size, isBinary: false, content: limited, truncated: limit ? text.length > limit : size > MAX_FILE_READ };
  },

  fs_write: async ({ path: p, content, append }) => {
    const rp = resolvePath(p);
    await fsp.mkdir(path.dirname(rp), { recursive: true });
    if (append) await fsp.appendFile(rp, content);
    else await fsp.writeFile(rp, content);
    const stat = await fsp.stat(rp);
    return { path: rp, bytes: stat.size, mode: append ? "append" : "write" };
  },

  fs_mkdir: async ({ path: p }) => {
    const rp = resolvePath(p);
    await fsp.mkdir(rp, { recursive: true });
    return { path: rp, created: true };
  },

  fs_exists: async ({ path: p }) => {
    const rp = resolvePath(p);
    try {
      const s = await fsp.stat(rp);
      return { path: rp, exists: true, type: s.isDirectory() ? "dir" : "file", size: s.size };
    } catch {
      return { path: rp, exists: false };
    }
  },

  /* ─── شل ─── */
  shell_exec: async ({ command, cwd, timeoutMs }) => {
    const r = await runRaw(command, { cwd, timeoutMs });
    return r;
  },

  /* ─── فرآیندها ─── */
  proc_list: async () => {
    const { stdout } = await runRaw("ps -eo pid,comm,%cpu,etime --sort=-%cpu", { timeoutMs: 8000 });
    const lines = stdout.trim().split("\n").slice(1);
    const processes = lines
      .map((l) => {
        const m = l.trim().split(/\s+/);
        return { pid: Number(m[0]), name: m[1], cpu: Number(m[2]), elapsed: m[3] };
      })
      .filter((p) => !Number.isNaN(p.pid))
      .slice(0, 80);
    return { count: processes.length, processes };
  },

  proc_kill: async ({ pid, signal = "SIGTERM" }) => {
    try {
      process.kill(Number(pid), signal);
      return { pid: Number(pid), killed: true, signal };
    } catch (e) {
      return { pid: Number(pid), killed: false, error: e.message };
    }
  },

  /* ─── کلیپبورد ─── */
  clipboard_read: async () => ({ text: clipboard.readText() }),
  clipboard_write: async ({ text }) => {
    clipboard.writeText(text);
    return { written: true, length: text.length };
  },

  /* ─── ماوس (لینوکس: xdotool) ─── */
  mouse_move: async ({ x, y }) => runFile("xdotool", ["mousemove", String(x), String(y)]),
  mouse_click: async ({ button = "left", x, y, count = 1 }) => {
    const b = { left: 1, middle: 2, right: 3 }[button] ?? 1;
    const parts = [];
    if (x != null && y != null) parts.push("mousemove", String(x), String(y));
    for (let i = 0; i < Math.max(1, count); i++) parts.push("click", String(b));
    return runFile("xdotool", parts);
  },
  mouse_scroll: async ({ dx = 0, dy = 0 }) => {
    const parts = [];
    // اسکرول عمودی: پایین = کلیک ۵، بالا = کلیک ۴
    for (let i = 0; i < Math.max(0, dy); i++) parts.push("click", "5");
    for (let i = 0; i < Math.max(0, -dy); i++) parts.push("click", "4");
    // اسکرول افقی: راست = کلیک ۶، چپ = کلیک ۷
    for (let i = 0; i < Math.max(0, dx); i++) parts.push("click", "6");
    for (let i = 0; i < Math.max(0, -dx); i++) parts.push("click", "7");
    if (parts.length === 0) return { stdout: "", stderr: "", exitCode: 0 };
    return runFile("xdotool", parts);
  },

  /* ─── کیبورد (لینوکس: xdotool) ─── */
  keyboard_type: async ({ text }) => runFile("xdotool", ["type", "--", String(text)]),
  keyboard_press: async ({ key }) => runFile("xdotool", ["key", String(key)]),

  /* ─── حافظهٔ بلندمدت (JSON در userData) ─── */
  memory_set: async ({ key, value }) => {
    const m = readMemory();
    m[key] = { value, updatedAt: new Date().toISOString() };
    writeMemory(m);
    return { key, stored: true };
  },
  memory_get: async ({ key }) => {
    const m = readMemory();
    if (!(key in m)) return { key, found: false };
    return { key, found: true, value: m[key].value, updatedAt: m[key].updatedAt };
  },
  memory_list: async () => {
    const m = readMemory();
    return { keys: Object.keys(m), count: Object.keys(m).length };
  },
  memory_delete: async ({ key }) => {
    const m = readMemory();
    const had = key in m;
    delete m[key];
    writeMemory(m);
    return { key, deleted: had };
  },
};

/* ═════════ ترمینال تعاملی — نشست شل واقعی ═════════
 * این ترمینالِ خودِ کاربر است (مثل GNOME Terminal): دستورها را خودِ کاربر
 * تایپ می‌کند، پس تأیید تکراری لازم ندارد. ابزار shell_exec (مسیر عامل
 * هوشمند) همچنان دریچهٔ تأیید خودش را دارد و دست نخورده است.
 */
const termSessions = new Map(); // id -> { proc, wc }
let termSeq = 0;

// نویز راه‌اندازی bash تعاملی وقتی tty واقعی ندارد
const TERM_NOISE = [
  /^bash: cannot set terminal process group.*$/,
  /^bash: no job control in this shell.*$/,
];

function termSend(wc, id, data) {
  try {
    if (wc && !wc.isDestroyed()) wc.send("atlas:term-data", { id, data: String(data) });
  } catch { /* ignore */ }
}

function registerTerminal() {
  ipcMain.handle("atlas:term-start", (event) => {
    const wc = event.sender;
    const isWin = process.platform === "win32";
    // ویندوز شل یونیکسی ندارد؛ از COMSPEC (معمولاً cmd.exe) استفاده می‌کنیم
    const shellPath = isWin
      ? (process.env.COMSPEC && process.env.COMSPEC.trim()
          ? process.env.COMSPEC.trim()
          : "C:\\Windows\\System32\\cmd.exe")
      : (process.env.SHELL && process.env.SHELL.trim() ? process.env.SHELL.trim() : "/bin/bash");
    const shellBase = path.basename(shellPath).toLowerCase();
    const args = isWin
      ? [] // cmd.exe/powershell با stdin پایپ‌شده تعاملی کار می‌کند؛ آرگومان لازم نیست
      : (shellBase === "bash" ? ["--noprofile", "--norc", "-i"] : ["-i"]);
    let proc;
    try {
      proc = spawn(shellPath, args, {
        cwd: os.homedir(),
        // detached: نشست، رهبر گروه فرآیند خودش است تا Ctrl+C به کل گروه
        // پیش‌زمینه (شل + دستور در حال اجرا) برسد — مثل ترمینال واقعی
        detached: true,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          // پرامپت خوانا؛ کدهای رنگی را رندرر تفسیر می‌کند
          PS1: "\\[\\e[1;32m\\]\\u@\\h\\[\\e[0m\\]:\\[\\e[1;34m\\]\\w\\[\\e[0m\\]\\$ ",
        },
        windowsHide: true,
      });
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
    const id = `term_${Date.now().toString(36)}_${++termSeq}`;
    termSessions.set(id, { proc, wc });

    const onData = (chunk) => {
      let s = chunk.toString("utf8");
      s = s
        .split("\n")
        .filter((ln) => !TERM_NOISE.some((re) => re.test(ln.trim())))
        .join("\n");
      if (s) termSend(wc, id, s);
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("error", (e) => {
      termSend(wc, id, `\r\n[خطا در اجرای شل: ${e.message}]\r\n`);
    });
    proc.on("close", (code) => {
      termSessions.delete(id);
      try {
        if (wc && !wc.isDestroyed()) wc.send("atlas:term-exit", { id, code });
      } catch { /* ignore */ }
    });
    return { ok: true, id };
  });

  ipcMain.on("atlas:term-write", (_e, { id, data }) => {
    const s = termSessions.get(id);
    if (s && s.proc.stdin.writable) {
      try { s.proc.stdin.write(String(data)); } catch { /* ignore */ }
    }
  });

  ipcMain.on("atlas:term-signal", (_e, { id, signal }) => {
    const s = termSessions.get(id);
    if (!s || !s.proc.pid) return;
    const sig = signal || "SIGINT";
    if (process.platform === "win32") {
      // ویندوز سیگنال گروه فرآیندی ندارد؛ بهترین تلاش برای وقفه (ممکن است شل بسته شود)
      try { s.proc.kill(sig); } catch { /* ignore */ }
      return;
    }
    // اول به کل گروه فرآیند (مثل Ctrl+C واقعی)؛ اگر نشد به خود شل
    try { process.kill(-s.proc.pid, sig); }
    catch { try { s.proc.kill(sig); } catch { /* ignore */ } }
  });

  ipcMain.on("atlas:term-kill", (_e, { id }) => {
    const s = termSessions.get(id);
    if (s) {
      try { s.proc.kill("SIGKILL"); } catch { /* ignore */ }
      termSessions.delete(id);
    }
  });

  app.on("will-quit", () => {
    for (const [, s] of termSessions) { try { s.proc.kill("SIGKILL"); } catch { /* ignore */ } }
    termSessions.clear();
  });
}

function registerBackend() {
  registerTerminal();
  ipcMain.handle("atlas:tool", async (_e, { tool, args }) => {
    const fn = tools[tool];
    if (!fn) return { ok: false, error: `ابزار ناشناخته: ${tool}` };

    // دریچهٔ امنیتی: حالت پلن → ابتدا «در انتظار تأیید» (بدون اجرا)
    if (planMode && DANGEROUS.has(tool) && !(args && args.approved)) {
      broadcast({ tool, args, pending: true, ts: Date.now() });
      return { ok: false, pending: true, plan: { tool, args } };
    }

    // دریچهٔ امنیتی: تأیید کاربر برای ابزارهای خطرناک
    if (confirmDangerous && DANGEROUS.has(tool)) {
      const allowed = requestConfirm(tool, args);
      if (!allowed) return { ok: false, error: "لغو شد توسط کاربر." };
    }

    try {
      const result = await fn(args || {});
      broadcast({ tool, args, result, ts: Date.now() });
      return { ok: true, ...result };
    } catch (err) {
      const error = err && err.message ? err.message : String(err);
      broadcast({ tool, args, error, ts: Date.now() });
      return { ok: false, error };
    }
  });

  ipcMain.handle("atlas:set-confirm", (_e, enabled) => {
    confirmDangerous = enabled !== false;
    saveConfirm();
    return { ok: true, confirmDangerous };
  });

  ipcMain.handle("atlas:set-plan", (_e, enabled) => {
    planMode = enabled !== false;
    savePlan();
    return { ok: true, planMode };
  });

  /* ─── فایل providers.json — کانفیگ پرووایدرها (قابل ویرایش دستی، مثل OpenCode) ─── */
  const providersPath = () => path.join(app.getPath("userData"), "providers.json");
  ipcMain.handle("atlas:providers-read", async () => {
    try {
      const raw = await fsp.readFile(providersPath(), "utf8");
      return { ok: true, content: raw, path: providersPath() };
    } catch (err) {
      if (err && err.code === "ENOENT") return { ok: true, content: null, path: providersPath() };
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });
  ipcMain.handle("atlas:providers-write", async (_e, { content } = {}) => {
    try {
      if (typeof content !== "string" || content.length > 1000000) {
        return { ok: false, error: "محتوای نامعتبر" };
      }
      JSON.parse(content); // اعتبارسنجی JSON قبل از نوشتن
      await fsp.writeFile(providersPath(), content, "utf8");
      return { ok: true, path: providersPath() };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });

  ipcMain.handle("atlas:proxy", async (_e, { url, method = "GET", headers = {}, body, responseType } = {}) => {    try {
      const m = String(method || "GET").toUpperCase();
      const init = { method: m, headers };
      if (m !== "GET" && body !== undefined) init.body = body; // body روی GET غیرمجاز است
      const res = await fetch(url, init);
      // responseType: 'base64' برای پاسخ‌های باینری (مثل صوت TTS) — بدنه base64 برمی‌گردد
      if (responseType === "base64") {
        const buf = Buffer.from(await res.arrayBuffer());
        const ct = res.headers.get("content-type") || undefined;
        return { ok: true, status: res.status, body: buf.toString("base64"), base64: true, contentType: ct };
      }
      const text = await res.text();
      return { ok: true, status: res.status, body: text };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });

  ipcMain.on("atlas:open-external", (_e, url) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) shell.openExternal(url);
  });
}

module.exports = { registerBackend, tools };
