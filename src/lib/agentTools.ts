/**
 * Atlas Agent Tools — ابزارهای عامل برای دسترسی به سیستم
 * هر ابزار روی پروسهٔ اصلی (Electron) اجرا میشود و از طریق IPC فراخوانی میگردد.
 * در حالت مرورگر (بدون electron) با پیام ملایمی باز میگردد.
 */
import { jsonSchema, tool, type ToolSet, type Tool, type Schema } from "ai";
import { useActivityStore } from "@/stores/activityStore";
import {
  TASKS,
  useSettingsStore,
  type ProviderKind,
  type TaskKind,
} from "@/stores/settingsStore";
import type { AtlasAPI } from "@/types/atlas-api";

type RawResult = {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
};

function getApi(): AtlasAPI | undefined {
  return window.atlasAPI;
}

/** فراخوانی ابزار در پروسهٔ اصلی از طریق preload */
async function invoke(toolName: string, args: Record<string, unknown>): Promise<RawResult> {
  const api = getApi();
  if (!api?.invokeTool) {
    return { ok: false, error: "ابزارهای سیستمی فقط در نسخهٔ دسکتاپ (Electron) در دسترسند." };
  }
  return api.invokeTool(toolName, args);
}

/** فشرده‌سازی خروجی برای ارسال به مدل */
function compact(res: RawResult): string {
  if (!res.ok) return `خطا: ${res.error ?? "نامشخص"}`;
  const clone: Record<string, unknown> = { ...res };
  delete clone.ok;
  for (const k of ["stdout", "stderr", "content", "entries", "processes"]) {
    if (typeof clone[k] === "string" && (clone[k] as string).length > 8000) {
      clone[k] = (clone[k] as string).slice(0, 8000) + "\n… (بریده‌شده)";
    }
  }
  if (Object.keys(clone).length === 0) return "انجام شد.";
  return JSON.stringify(clone, null, 2);
}

function str(v: unknown, d = ""): string {
  return typeof v === "string" ? v : d;
}
function num(v: unknown, d = 0): number {
  return typeof v === "number" ? v : d;
}

/** هلپر ساخت ابزار با بستن ایمن تایپ‌ها */
function atlasTool<Args extends Record<string, unknown>>(config: {
  description: string;
  schema: Record<string, unknown>;
  execute: (args: Args) => Promise<unknown> | unknown;
}): Tool {
  const t = tool<Args, unknown, Record<string, unknown>>({
    description: config.description,
    inputSchema: jsonSchema(config.schema) as Schema<Args>,
    execute: async (args: Args) => config.execute(args),
  })
  return t as unknown as Tool
}

export function buildAgentTools(): ToolSet {
  return {
    system_info: atlasTool({
      description: "دریافت اطلاعات کلی سیستم (سیستم‌عامل، معماری، تعداد هسته، حافظه، نمایشگرها).",
      schema: { type: "object", properties: {} },
      execute: async () => compact(await invoke("system_info", {})),
    }),

    shell_exec: atlasTool({
      description:
        "اجرای یک دستور ترمینال/شل روی سیستم کاربر و بازگرداندن خروجی (stdout/stderr/کد خروج). برای نصب، اجرا، جستجو و مدیریت سیستم استفاده شود.",
      schema: {
        type: "object",
        properties: {
          command: { type: "string", description: "دستور شل کامل، مثلاً 'ls -la' یا 'npm run build'" },
          cwd: { type: "string", description: "مسیر پوشهٔ اجرا (اختیاری)" },
          timeoutMs: { type: "number", description: "محدودیت زمان به میلی‌ثانیه (پیش‌فرض ۳۰۰۰۰)" },
        },
        required: ["command"],
      },
      execute: async (a) =>
        compact(await invoke("shell_exec", { command: str(a.command), cwd: str(a.cwd), timeoutMs: num(a.timeoutMs) })),
    }),

    fs_list: atlasTool({
      description: "فهرست کردن محتوای یک پوشه.",
      schema: { type: "object", properties: { path: { type: "string", description: "مسیر پوشه (پیش‌فرض خانهٔ کاربر)" } } },
      execute: async (a) => compact(await invoke("fs_list", { path: str(a.path) })),
    }),

    fs_read: atlasTool({
      description: "خواندن محتوای یک فایل متنی.",
      schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "مسیر کامل فایل" },
          limit: { type: "number", description: "محدودیت تعداد کاراکتر (اختیاری)" },
        },
        required: ["path"],
      },
      execute: async (a) => compact(await invoke("fs_read", { path: str(a.path), limit: num(a.limit) })),
    }),

    fs_write: atlasTool({
      description: "نوشتن یا الحاق محتوا به یک فایل (پوشه‌ها ساخته میشوند).",
      schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "مسیر کامل فایل" },
          content: { type: "string", description: "محتوای نوشتنی" },
          append: { type: "boolean", description: "الحاق به انتهای فایل به‌جای جایگزینی" },
        },
        required: ["path", "content"],
      },
      execute: async (a) =>
        compact(await invoke("fs_write", { path: str(a.path), content: str(a.content), append: a.append === true })),
    }),

    fs_mkdir: atlasTool({
      description: "ساخت یک پوشه (با زیرپوشه‌ها).",
      schema: { type: "object", properties: { path: { type: "string", description: "مسیر پوشه" } }, required: ["path"] },
      execute: async (a) => compact(await invoke("fs_mkdir", { path: str(a.path) })),
    }),

    fs_exists: atlasTool({
      description: "بررسی وجود یک فایل یا پوشه.",
      schema: { type: "object", properties: { path: { type: "string", description: "مسیر" } }, required: ["path"] },
      execute: async (a) => compact(await invoke("fs_exists", { path: str(a.path) })),
    }),

    proc_list: atlasTool({
      description: "فهرست فرآیندهای در حال اجرا به ترتیب مصرف CPU.",
      schema: { type: "object", properties: {} },
      execute: async () => compact(await invoke("proc_list", {})),
    }),

    proc_kill: atlasTool({
      description: "متوقف کردن یک فرآیند با شناسه (PID).",
      schema: {
        type: "object",
        properties: {
          pid: { type: "number", description: "شناسهٔ فرآیند" },
          signal: { type: "string", description: "سیگنال (پیش‌فرض SIGTERM)" },
        },
        required: ["pid"],
      },
      execute: async (a) => compact(await invoke("proc_kill", { pid: num(a.pid), signal: str(a.signal, "SIGTERM") })),
    }),

    clipboard_read: atlasTool({
      description: "خواندن متن کلیپبورد سیستم.",
      schema: { type: "object", properties: {} },
      execute: async () => compact(await invoke("clipboard_read", {})),
    }),

    clipboard_write: atlasTool({
      description: "نوشتن متن در کلیپبورد سیستم.",
      schema: {
        type: "object",
        properties: { text: { type: "string", description: "متن برای کپی" } },
        required: ["text"],
      },
      execute: async (a) => compact(await invoke("clipboard_write", { text: str(a.text) })),
    }),

    mouse_move: atlasTool({
      description: "جابجا کردن موس به مختصات صفحهٔ نمایش (x, y).",
      schema: {
        type: "object",
        properties: {
          x: { type: "number", description: "مختصات افقی پیکسل" },
          y: { type: "number", description: "مختصات عمودی پیکسل" },
        },
        required: ["x", "y"],
      },
      execute: async (a) => compact(await invoke("mouse_move", { x: num(a.x), y: num(a.y) })),
    }),

    mouse_click: atlasTool({
      description: "کلیک موس (چپ/راست/میانه)، اختیاری در مختصات مشخص.",
      schema: {
        type: "object",
        properties: {
          button: { type: "string", enum: ["left", "right", "middle"], description: "دکمه (پیش‌فرض left)" },
          x: { type: "number", description: "مختصات x (اختیاری)" },
          y: { type: "number", description: "مختصات y (اختیاری)" },
          count: { type: "number", description: "تعداد کلیک (پیش‌فرض ۱)" },
        },
      },
      execute: async (a) =>
        compact(await invoke("mouse_click", { button: str(a.button, "left"), x: num(a.x), y: num(a.y), count: num(a.count, 1) })),
    }),

    mouse_scroll: atlasTool({
      description: "اسکرول صفحه (dy مثبت به پایین، منفی به بالا).",
      schema: {
        type: "object",
        properties: {
          dx: { type: "number", description: "اسکرول افقی (معمولاً ۰)" },
          dy: { type: "number", description: "اسکرول عمودی" },
        },
      },
      execute: async (a) => compact(await invoke("mouse_scroll", { dx: num(a.dx), dy: num(a.dy) })),
    }),

    keyboard_type: atlasTool({
      description: "تایپ متن در جایی که موس قرار دارد.",
      schema: {
        type: "object",
        properties: { text: { type: "string", description: "متن برای تایپ" } },
        required: ["text"],
      },
      execute: async (a) => compact(await invoke("keyboard_type", { text: str(a.text) })),
    }),

    keyboard_press: atlasTool({
      description: "فشار دادن یک کلید (مثل Return، ctrl+c، alt+F4).",
      schema: {
        type: "object",
        properties: { key: { type: "string", description: "نام کلید طبق xdotool/سینتکس سیستم" } },
        required: ["key"],
      },
      execute: async (a) => compact(await invoke("keyboard_press", { key: str(a.key) })),
    }),

    memory_set: atlasTool({
      description: "ذخیرهٔ یک حقیقت در حافظهٔ بلندمدت Atlas (مثل اولویت‌ها، نام کاربر، جلسات).",
      schema: {
        type: "object",
        properties: {
          key: { type: "string", description: "کلید یکتا" },
          value: { type: "string", description: "مقدار برای ذخیره" },
        },
        required: ["key", "value"],
      },
      execute: async (a) => compact(await invoke("memory_set", { key: str(a.key), value: str(a.value) })),
    }),

    memory_get: atlasTool({
      description: "بازیابی یک مقدار از حافظهٔ بلندمدت.",
      schema: { type: "object", properties: { key: { type: "string", description: "کلید" } }, required: ["key"] },
      execute: async (a) => compact(await invoke("memory_get", { key: str(a.key) })),
    }),

    memory_list: atlasTool({
      description: "فهرست کلیدهای موجود در حافظهٔ بلندمدت.",
      schema: { type: "object", properties: {} },
      execute: async () => compact(await invoke("memory_list", {})),
    }),

    memory_delete: atlasTool({
      description: "حذف یک کلید از حافظهٔ بلندمدت.",
      schema: { type: "object", properties: { key: { type: "string", description: "کلید" } }, required: ["key"] },
      execute: async (a) => compact(await invoke("memory_delete", { key: str(a.key) })),
    }),

    screen_capture: atlasTool({
      description:
        "گرفتن اسکرین‌شات از صفحهٔ کاربر. خروجی در پنل فعالیت نمایش داده میشود تا وضعیت بصری سیستم دیده شود.",
      schema: { type: "object", properties: {} },
      execute: async () => {
        const api = getApi();
        if (!api?.captureScreen) return { ok: false, error: "اسکرین‌شات فقط در نسخهٔ دسکتاپ در دسترس است." };
        try {
          const dataUrl = await api.captureScreen();
          useActivityStore.getState().setLastScreenshot(dataUrl);
          useActivityStore.getState().push({
            id: `screen-${Date.now()}`,
            tool: "screen_capture",
            ts: Date.now(),
            screenshot: dataUrl,
          });
          return { ok: true, captured: true, bytes: dataUrl.length, note: "اسکرین‌شات با موفقیت گرفته شد و در پنل فعالیت نمایش داده شد." };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),

    /* ─── تنظیم محاوره‌ای پرووایدرها (BYO API) ─── */

    get_task_config: atlasTool({
      description:
        "خواندن تنظیمات فعلی یک کار (چت متنی، چت صوتی، تولید تصویر، تولید ویدیو، مدل سه‌بعدی، صوتی/TTS): پرووایدر، مدل، آدرس. مقدار کلید API هرگز برنمی‌گردد (فقط اینکه ست شده یا نه).",
      schema: {
        type: "object",
        properties: {
          task: {
            type: "string",
            enum: TASKS.map(t => t.id),
            description: "شناسهٔ کار: text-chat | voice-chat | image | video | 3d | tts",
          },
        },
        required: ["task"],
      },
      execute: async (a) => {
        const task = str(a.task) as TaskKind;
        if (!TASKS.some(t => t.id === task)) {
          return { ok: false, error: `کار نامعتبر: ${task}` };
        }
        const cfg = useSettingsStore.getState().taskConfigs[task];
        const label = TASKS.find(t => t.id === task)?.name ?? task;
        return {
          ok: true,
          task,
          taskName: label,
          provider: cfg.provider,
          model: cfg.model,
          baseURL: cfg.baseURL,
          hasApiKey: cfg.apiKey.trim().length > 0,
          customName: cfg.custom?.name?.trim() || undefined,
          // امنیت: مقدار کلید عمداً برنمی‌گردد
        };
      },
    }),

    set_task_config: atlasTool({
      description:
        "تنظیم پرووایدر/کلید/مدل یک کار از روی حرف کاربر (مثلاً «کلید fal من اینه»). فیلدهای عادی فوراً اعمال می‌شوند؛ ولی ذخیرهٔ کلید API فقط با تأیید صریح کاربر انجام می‌شود: بار اول بدون confirmed صدا بزن تا خلاصهٔ در انتظار تأیید برگردد، بعد از «تأیید» گفتن کاربر دوباره با confirmed=true صدا بزن.",
      schema: {
        type: "object",
        properties: {
          task: {
            type: "string",
            enum: TASKS.map(t => t.id),
            description: "شناسهٔ کار",
          },
          provider: {
            type: "string",
            enum: ["openai", "ollama", "anthropic", "gemini", "custom"],
            description: "پرووایدر (اختیاری)",
          },
          apiKey: { type: "string", description: "کلید API — فقط با تأیید صریح کاربر ذخیره می‌شود" },
          baseURL: { type: "string", description: "آدرس پایه (اختیاری)" },
          model: { type: "string", description: "مدل (اختیاری)" },
          customName: { type: "string", description: "نام پرووایدر کاستوم (اختیاری)" },
          confirmed: {
            type: "boolean",
            description: "تأیید صریح کاربر برای ذخیرهٔ کلید (وقتی pending برگشت، بعد از تأیید کاربر true بگذار)",
          },
        },
        required: ["task"],
      },
      execute: async (a) => {
        const task = str(a.task) as TaskKind;
        if (!TASKS.some(t => t.id === task)) {
          return { ok: false, error: `کار نامعتبر: ${task}` };
        }
        const label = TASKS.find(t => t.id === task)?.name ?? task;
        const store = useSettingsStore.getState();

        const patch: Record<string, unknown> = {};
        const provider = str(a.provider);
        if (provider) {
          const valid: ProviderKind[] = ["openai", "ollama", "anthropic", "gemini", "custom"];
          if (!valid.includes(provider as ProviderKind)) {
            return { ok: false, error: `پرووایدر نامعتبر: ${provider}` };
          }
          patch.provider = provider;
        }
        if (typeof a.baseURL === "string") patch.baseURL = a.baseURL;
        if (typeof a.model === "string") patch.model = a.model;
        const customName = str(a.customName);
        if (customName) {
          const cur = store.taskConfigs[task].custom;
          patch.custom = { ...(cur ?? {}), name: customName };
        }

        const apiKey = str(a.apiKey);
        if (apiKey) {
          // ─── ذخیرهٔ کلید فقط با تأیید صریح ───
          if (a.confirmed !== true) {
            pendingKeyPatch = { task, apiKey, ts: Date.now() };
            return {
              ok: true,
              pending: true,
              task,
              taskName: label,
              summary: `کلید جدید برای «${label}» آمادهٔ ذخیره است (…${apiKey.slice(-4)}).`,
              hint: "از کاربر تأیید صریح بگیر (مثلاً «تأیید می‌کنم») و بعد همین ابزار را با confirmed=true صدا بزن. بدون تأیید، کلید ذخیره نمی‌شود.",
            };
          }
          const pend = pendingKeyPatch;
          if (!pend || pend.task !== task || Date.now() - pend.ts > 5 * 60 * 1000) {
            return {
              ok: false,
              error: "درخواست تأیید معتبر/تازه‌ای برای این کار نیست — اول بدون confirmed صدا بزن تا pending ساخته شود.",
            };
          }
          patch.apiKey = pend.apiKey;
          pendingKeyPatch = null;
        }

        if (Object.keys(patch).length === 0) {
          return { ok: false, error: "هیچ فیلدی برای تنظیم داده نشد." };
        }
        store.setTaskConfig(task, patch as Parameters<typeof store.setTaskConfig>[1]);
        return {
          ok: true,
          task,
          taskName: label,
          applied: Object.keys(patch),
          note: apiKey ? "کلید با تأیید کاربر ذخیره شد." : "تنظیمات اعمال شد.",
        };
      },
    }),
    /* ─── کارهای پس‌زمینه و زمان‌بندی‌شده ─── */

    create_background_task: atlasTool({
      description:
        "سپردن یک کار به «ایجنت پس‌زمینه»: کاربر می‌گوید «تو پس‌زمینه انجام بده» و می‌رود سر کارش؛ " +
        "ایجنت بدون UI اجرا می‌شود و با تمام‌شدن، ناتیفیکیشن دسکتاپ می‌آید و نتیجه در پنل «کارها» " +
        "قابل مشاهده است. فقط در نسخهٔ دسکتاپ کار می‌کند.",
      schema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "شرح کامل کاری که باید انجام شود" },
          title: { type: "string", description: "عنوان کوتاه (اختیاری)" },
        },
        required: ["prompt"],
      },
      execute: async (a) => {
        const { createAndRunBackgroundTask } = await import("@/lib/tasksSync");
        const r = await createAndRunBackgroundTask(str(a.prompt), str(a.title) || undefined);
        if (!r.ok) return { ok: false, error: r.error };
        return {
          ok: true,
          taskId: r.id,
          note: "تسک پس‌زمینه ساخته و اجرا شد؛ با تمام‌شدن، ناتیفیکیشن دسکتاپ می‌آید و نتیجه در پنل «کارها» است.",
        };
      },
    }),

    schedule_task: atlasTool({
      description:
        "ساخت «تسک زمان‌بندی‌شده»: کاربر می‌گوید «هر صبح ساعت ۸ …»؛ زمان با زبان طبیعی فارسی " +
        "فهمیده می‌شود (مثل «هر صبح ساعت ۸»، «هر ۳۰ دقیقه»، «هر جمعه ساعت ۹») یا می‌توان کرون مستقیم داد. " +
        "در موعد مقرر ایجنت خودکار اجرا می‌شود و نتیجه با ناتیفیکیشن اعلام می‌گردد.",
      schema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "کاری که در هر اجرا انجام شود" },
          when: {
            type: "string",
            description: "زمان به زبان طبیعی فارسی («هر صبح ساعت ۸») یا کرون («0 8 * * *»)",
          },
          title: { type: "string", description: "عنوان (اختیاری)" },
        },
        required: ["prompt", "when"],
      },
      execute: async (a) => {
        const { parseScheduleFa, isValidCron } = await import("@/lib/scheduleParse");
        const when = str(a.when).trim();
        const parsed = when ? parseScheduleFa(when) : null;
        const cron = parsed?.cron ?? (when && isValidCron(when) ? when : null);
        if (!cron) {
          return {
            ok: false,
            error:
              "زمان را نفهمیدم. مثال‌های معتبر: «هر صبح ساعت ۸»، «هر ۳۰ دقیقه»، «هر جمعه ساعت ۹»، یا کرون مثل «0 8 * * *».",
          };
        }
        const api = getApi();
        if (!api?.scheduleAdd) {
          return { ok: false, error: "زمان‌بند فقط در نسخهٔ دسکتاپ (Electron) در دسترس است." };
        }
        const r = await api.scheduleAdd({
          title: str(a.title).trim() || str(a.prompt).slice(0, 60),
          prompt: str(a.prompt),
          cron,
          label: parsed?.label ?? cron,
        });
        if (!r.ok) return { ok: false, error: r.error ?? "ثبت زمان‌بند ناموفق بود" };
        return {
          ok: true,
          scheduleId: r.id,
          when: parsed?.label ?? cron,
          note: `زمان‌بند ثبت شد (${parsed?.label ?? cron})؛ در موعد مقرر خودکار اجرا و با ناتیفیکیشن اعلام می‌شود. مدیریت از پنل «کارها».`,
        };
      },
    }),
  };
}

/**
 * درخواستِ در انتظارِ ذخیرهٔ کلید — فقط یکی در لحظه.
 * با تأیید صریح کاربر (confirmed=true) مصرف می‌شود؛ بعد از ۵ دقیقه منقضی است.
 */
let pendingKeyPatch: { task: TaskKind; apiKey: string; ts: number } | null = null;
