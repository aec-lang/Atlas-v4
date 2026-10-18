/**
 * MCP Tools — تبدیل ابزارهای سرورهای MCP به ابزارهای ایجنت Atlas.
 * نام‌گذاری namespace: mcp_<server>__<tool> (مثلاً mcp_github__create_issue)
 * اسکیمای JSON Schema سرور مستقیم به ابزار Atlas تبدیل می‌شود.
 * اجرا از طریق پروسهٔ اصلی (atlas:mcp-call) انجام می‌شود.
 */
import { jsonSchema, tool, type ToolSet, type Tool, type Schema } from "ai";
import type { AtlasAPI, McpAgentToolDef } from "@/types/atlas-api";

function getApi(): AtlasAPI | undefined {
  return (window as unknown as { atlasAPI?: AtlasAPI }).atlasAPI;
}

/** یکدست‌سازی نام ابزار برای namespace */
export function sanitizeMcpToolName(name: string): string {
  return String(name || "tool").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "tool";
}

/** فشرده‌سازی خروجی ابزار MCP برای مدل */
function compactMcp(res: { ok: boolean; result?: string; error?: string }): string {
  if (!res.ok) return `خطا: ${res.error ?? "نامشخص"}`;
  const text = res.result ?? "انجام شد.";
  const MAX = 12000;
  return text.length > MAX ? text.slice(0, MAX) + "\n… (بریده‌شده)" : text;
}

/**
 * ساخت همهٔ ابزارهای MCP فعال — خروجی با buildAgentTools() مرج می‌شود.
 * در مرورگر (بدون Electron) مجموعهٔ خالی برمی‌گردد.
 */
export async function buildMcpTools(): Promise<ToolSet> {
  const api = getApi();
  if (!api?.mcp?.toolsAll) return {};
  let defs: McpAgentToolDef[];
  try {
    const r = await api.mcp.toolsAll();
    if (!r.ok || !r.tools) return {};
    defs = r.tools;
  } catch {
    return {};
  }

  const out: ToolSet = {};
  const seen = new Set<string>();
  for (const d of defs) {
    const toolName = `mcp_${d.serverId}__${sanitizeMcpToolName(d.toolName)}`;
    if (seen.has(toolName)) continue;
    seen.add(toolName);
    const serverId = d.serverId;
    const rawTool = d.toolName;
    const schema = d.inputSchema && typeof d.inputSchema === "object" ? d.inputSchema : { type: "object", properties: {} };
    const description = d.description
      ? `[MCP · ${d.serverName}] ${d.description}`
      : `ابزار MCP «${rawTool}» از سرور «${d.serverName}»`;

    const t = tool<Record<string, unknown>, unknown, Record<string, unknown>>({
      description,
      inputSchema: jsonSchema(schema) as Schema<Record<string, unknown>>,
      execute: async (args: Record<string, unknown>) => {
        const a = getApi();
        if (!a?.mcp?.call) return "ابزارهای MCP فقط در نسخهٔ دسکتاپ (Electron) در دسترس‌اند.";
        try {
          const r = await a.mcp.call(serverId, rawTool, args ?? {});
          return compactMcp(r);
        } catch (e) {
          return `خطا: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });
    out[toolName] = t as unknown as Tool;
  }
  return out;
}
