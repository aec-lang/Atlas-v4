/**
 * نگاشت نام ابزارهای عامل → لیبل فارسی + آیکون Lucide
 * برای نمایش «کارت قشنگ» tool callها در چت (به‌جای اسم‌های خامی مثل shell_exec).
 * قانون: بدون ایموجی، فقط آیکون Lucide با استایل سابتِل.
 */
import type { LucideIcon } from "lucide-react";
import {
  Brain,
  BrainCircuit,
  Camera,
  ClipboardCopy,
  ClipboardPaste,
  Clock,
  Command,
  Cpu,
  FileCheck2,
  FilePenLine,
  FileText,
  FolderOpen,
  FolderPlus,
  KeyRound,
  Keyboard,
  Layers,
  ListOrdered,
  MousePointer2,
  MousePointerClick,
  MoveVertical,
  OctagonX,
  Plug,
  SlidersHorizontal,
  Terminal,
  Trash2,
  Wrench,
} from "lucide-react";

export interface ToolMeta {
  /** لیبل فارسی نمایشی */
  label: string;
  /** آیکون Lucide */
  icon: LucideIcon;
}

/**
 * همه‌ی ابزارهای buildAgentTools (src/lib/agentTools.ts) باید اینجا باشند.
 * اگر ابزاری جا افتاد، getToolMeta با آیکون عمومی برمی‌گردد تا چیزی نشکند.
 */
export const TOOL_META: Record<string, ToolMeta> = {
  system_info: { label: "اطلاعات سیستم", icon: Cpu },
  shell_exec: { label: "اجرای دستور", icon: Terminal },
  fs_list: { label: "فهرست فایل‌ها", icon: FolderOpen },
  fs_read: { label: "خواندن فایل", icon: FileText },
  fs_write: { label: "نوشتن فایل", icon: FilePenLine },
  fs_mkdir: { label: "ساخت پوشه", icon: FolderPlus },
  fs_exists: { label: "بررسی فایل", icon: FileCheck2 },
  proc_list: { label: "فهرست پردازش‌ها", icon: ListOrdered },
  proc_kill: { label: "بستن پردازش", icon: OctagonX },
  clipboard_read: { label: "خواندن کلیپ‌برد", icon: ClipboardPaste },
  clipboard_write: { label: "نوشتن در کلیپ‌برد", icon: ClipboardCopy },
  mouse_move: { label: "حرکت نشانگر", icon: MousePointer2 },
  mouse_click: { label: "کلیک", icon: MousePointerClick },
  mouse_scroll: { label: "اسکرول", icon: MoveVertical },
  keyboard_type: { label: "تایپ متن", icon: Keyboard },
  keyboard_press: { label: "فشردن کلید", icon: Command },
  memory_set: { label: "ذخیره در حافظه", icon: Brain },
  memory_get: { label: "خواندن حافظه", icon: BrainCircuit },
  memory_list: { label: "فهرست حافظه", icon: Layers },
  memory_delete: { label: "حذف از حافظه", icon: Trash2 },
  screen_capture: { label: "اسکرین‌شات", icon: Camera },
  get_task_config: { label: "خواندن تنظیمات کار", icon: SlidersHorizontal },
  set_task_config: { label: "تنظیم API کار", icon: KeyRound },
  create_background_task: { label: "کار پس‌زمینه", icon: Layers },
  schedule_task: { label: "زمان‌بندی کار", icon: Clock },
};

/** متای نمایشی یک ابزار؛ برای نام‌های ناشناخته آیکون عمومی + همان اسم برمی‌گردد. */
export function getToolMeta(toolName: string): ToolMeta {
  const staticMeta = TOOL_META[toolName];
  if (staticMeta) return staticMeta;
  // ابزارهای داینامیک MCP: mcp_<server>__<tool> → «tool» (سرور server)
  if (toolName.startsWith("mcp_")) {
    const rest = toolName.slice(4);
    const sep = rest.indexOf("__");
    if (sep > 0) {
      const server = rest.slice(0, sep);
      const tool = rest.slice(sep + 2) || rest;
      return { label: `${tool} (کانکتور ${server})`, icon: Plug };
    }
    return { label: toolName, icon: Plug };
  }
  return { label: toolName, icon: Wrench };
}
