/**
 * Atlas Desktop — MCP Host (پروسهٔ اصلی)
 *
 * Atlas به‌عنوان MCP host به سرورهای Model Context Protocol وصل می‌شود تا
 * کاربر صدها کانکتور آماده (گیت‌هاب، جیمیل، اسلک، دیتابیس…) را بدون کدنویسی
 * ما داشته باشد. SDK رسمی: @modelcontextprotocol/sdk
 *
 * معماری:
 *  - کانفیگ سرورها در همان providers.json است (app-data) — همان فایلی که
 *    UI و providerFile.ts می‌خوانند/می‌نویسند؛ این ماژول آن را مستقیم می‌خواند.
 *  - اتصال‌ها lazy و کش می‌شوند (serverId → Client)؛ تست اتصال هم همین مسیر است.
 *  - transportها: stdio (child_process) و streamable-HTTP.
 *
 * امنیت (مستند):
 *  - سرور stdio می‌تواند «هر» دستوری روی سیستم اجرا کند. افزودن سرور کاستوم
 *    فقط با هشدار صریح و تأیید کاربر در UI مجاز است (این لایه فقط اجرا می‌کند).
 *  - در حالت اجرای خودکار (پس‌زمینه/زمان‌بندی‌شده) همهٔ ابزارهای mcp_* در
 *    taskPolicy.ts مسدود و «در انتظار تأیید» می‌مانند — چون ابزارهای شخص ثالث‌اند.
 *  - در حالت تعاملی، اعتماد در لحظهٔ فعال‌سازی سرور داده می‌شود (مثل Claude Code).
 */
const { ipcMain, app } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

const PROVIDERS_FILE = () => path.join(app.getPath("userData"), "providers.json");
/** سقف اتصال/تست — جلوگیری از گیر کردن روی سرور خراب */
const CONNECT_TIMEOUT_MS = 25000;

let seq = 0;
function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${(++seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** یکدست‌سازی شناسهٔ سرور برای namespace ابزارها: mcp_<server>__<tool> */
function sanitizeServerId(id) {
  const s = String(id || "").toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return (s || "srv").slice(0, 32);
}

/** خواندن و اعتبارسنجی لیست سرورها از providers.json */
function readServerConfigs() {
  try {
    const raw = fs.readFileSync(PROVIDERS_FILE(), "utf8");
    const j = JSON.parse(raw);
    const arr = Array.isArray(j.mcpServers) ? j.mcpServers : [];
    const out = [];
    for (const s of arr) {
      if (!s || typeof s !== "object") continue;
      const transport = s.transport === "http" ? "http" : "stdio";
      const cfg = {
        id: sanitizeServerId(s.id || s.name || newId("srv")),
        name: String(s.name || s.id || "سرور MCP").slice(0, 80),
        transport,
        enabled: s.enabled !== false,
        curated: s.curated === true,
      };
      if (transport === "stdio") {
        if (typeof s.command !== "string" || !s.command.trim()) continue;
        cfg.command = s.command.trim();
        cfg.args = Array.isArray(s.args) ? s.args.map(a => String(a)) : [];
        cfg.env = s.env && typeof s.env === "object" ? Object.fromEntries(
          Object.entries(s.env).filter(([, v]) => typeof v === "string").map(([k, v]) => [String(k), String(v)])
        ) : {};
      } else {
        if (typeof s.url !== "string" || !s.url.trim()) continue;
        cfg.url = s.url.trim();
        cfg.headers = s.headers && typeof s.headers === "object" ? Object.fromEntries(
          Object.entries(s.headers).filter(([, v]) => typeof v === "string").map(([k, v]) => [String(k), String(v)])
        ) : {};
      }
      out.push(cfg);
    }
    // حذف تکراری‌ها بر اساس id (اولی می‌ماند)
    const seen = new Set();
    return out.filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  } catch {
    return [];
  }
}

/** کش اتصال‌ها: serverId -> { client, transport, tools, error } */
const connections = new Map();

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: مهلت ${Math.round(ms / 1000)} ثانیه تمام شد`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function ensureConnected(cfg) {
  const cached = connections.get(cfg.id);
  if (cached && !cached.error) return cached;

  let transport;
  if (cfg.transport === "stdio") {
    transport = new StdioClientTransport({
      command: cfg.command,
      args: cfg.args || [],
      // env کاربر روی process.env سوار می‌شود (مثل PATH برای npx)
      env: { ...process.env, ...(cfg.env || {}) },
      stderr: "pipe",
    });
  } else {
    transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
      requestInit: { headers: { ...(cfg.headers || {}) } },
    });
  }

  const client = new Client({ name: "atlas", version: "4.0.0" }, { capabilities: {} });
  await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, "اتصال به سرور MCP");
  const { tools } = await client.listTools();
  const entry = {
    client,
    transport,
    tools: (tools || []).map(t => ({
      name: String(t.name || ""),
      description: typeof t.description === "string" ? t.description : "",
      inputSchema: t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {} },
    })).filter(t => t.name),
    error: null,
  };
  connections.set(cfg.id, entry);
  return entry;
}

async function disconnectServer(serverId) {
  const entry = connections.get(serverId);
  connections.delete(serverId);
  if (!entry) return;
  try { await entry.client.close(); } catch { /* ignore */ }
}

/** تبدیل محتوای callTool به رشتهٔ فشرده برای مدل */
function contentToString(result) {
  if (!result || typeof result !== "object") return "";
  const parts = [];
  const content = Array.isArray(result.content) ? result.content : [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    } else if (block.type === "image" || block.type === "audio") {
      parts.push(`[${block.type} دریافتی — در چت متنی نمایش داده نمی‌شود]`);
    } else if (block.type === "resource") {
      try { parts.push(JSON.stringify(block.resource)); } catch { parts.push("[resource]"); }
    }
  }
  const text = parts.join("\n");
  const MAX = 12000;
  return text.length > MAX ? text.slice(0, MAX) + "\n… (بریده‌شده)" : text;
}

function serverStatus(cfg) {
  const entry = connections.get(cfg.id);
  if (!cfg.enabled) return { status: "disabled", tools: [], error: null };
  if (entry && !entry.error) return { status: "connected", tools: entry.tools, error: null };
  if (entry && entry.error) return { status: "error", tools: [], error: entry.error };
  return { status: "idle", tools: [], error: null };
}

function registerMcp() {
  /** فهرست سرورها + وضعیت زنده + تعداد ابزارها */
  ipcMain.handle("atlas:mcp-list", async () => {
    try {
      const cfgs = readServerConfigs();
      return {
        ok: true,
        servers: cfgs.map(c => ({ config: c, ...serverStatus(c) })),
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** ابزارهای همهٔ سرورهای فعال و متصل — برای ایجنت */
  ipcMain.handle("atlas:mcp-tools-all", async () => {
    try {
      const cfgs = readServerConfigs().filter(c => c.enabled);
      const out = [];
      for (const cfg of cfgs) {
        try {
          const entry = await ensureConnected(cfg);
          for (const t of entry.tools) {
            out.push({
              serverId: cfg.id,
              serverName: cfg.name,
              toolName: `mcp_${cfg.id}__${t.name}`,
              description: t.description,
              inputSchema: t.inputSchema,
            });
          }
        } catch (e) {
          connections.set(cfg.id, { client: null, transport: null, tools: [], error: e instanceof Error ? e.message : String(e) });
        }
      }
      return { ok: true, tools: out };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** ابزارهای یک سرور (برای نمایش در UI) */
  ipcMain.handle("atlas:mcp-tools", async (_e, { serverId } = {}) => {
    try {
      const cfg = readServerConfigs().find(c => c.id === sanitizeServerId(serverId));
      if (!cfg) return { ok: false, error: "سرور یافت نشد." };
      const entry = await ensureConnected(cfg);
      return { ok: true, tools: entry.tools };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** تست اتصال: وصل شو، ابزارها را بشمار، وصل بمان (کش) */
  ipcMain.handle("atlas:mcp-test", async (_e, { serverId } = {}) => {
    try {
      const cfg = readServerConfigs().find(c => c.id === sanitizeServerId(serverId));
      if (!cfg) return { ok: false, error: "سرور یافت نشد." };
      await disconnectServer(cfg.id);
      const entry = await ensureConnected(cfg);
      return { ok: true, toolCount: entry.tools.length, tools: entry.tools.map(t => t.name) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** اجرای ابزار MCP — در حالت تعاملی اعتماد در لحظهٔ فعال‌سازی داده شده است */
  ipcMain.handle("atlas:mcp-call", async (_e, { serverId, tool, args } = {}) => {
    try {
      const cfg = readServerConfigs().find(c => c.id === sanitizeServerId(serverId));
      if (!cfg) return { ok: false, error: "سرور یافت نشد." };
      if (!cfg.enabled) return { ok: false, error: "سرور غیرفعال است." };
      const entry = await ensureConnected(cfg);
      const result = await withTimeout(
        entry.client.callTool({ name: String(tool), arguments: (args && typeof args === "object") ? args : {} }),
        CONNECT_TIMEOUT_MS,
        "اجرای ابزار MCP",
      );
      if (result && result.isError) {
        return { ok: false, error: contentToString(result) || "ابزار MCP خطا داد." };
      }
      const text = contentToString(result);
      return { ok: true, result: text || "انجام شد." };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** قطع اتصال یک سرور (بعد از غیرفعال‌سازی/حذف) */
  ipcMain.handle("atlas:mcp-disconnect", async (_e, { serverId } = {}) => {
    await disconnectServer(sanitizeServerId(serverId));
    return { ok: true };
  });
}

module.exports = { registerMcp, sanitizeServerId };
