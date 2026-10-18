/**
 * لیست پیشنهادی سرورهای MCP (curated) — با یک کلیک اضافه می‌شوند.
 * همه از رجیستری رسمی modelcontextprotocol/servers هستند (npx).
 * کاربر فقط مقادیر env لازم را پر می‌کند؛ دستور و آرگومان‌ها آماده‌اند.
 * قانون: بدون ایموجی؛ لیبل‌ها و hintها فارسی.
 */
import type { McpServerConfig } from '@/types/atlas-api'

export interface CuratedMcpServer {
  id: string
  /** نام فارسی نمایشی */
  nameFa: string
  /** توضیح فارسی */
  descriptionFa: string
  command: string
  args: string[]
  /** قالب env — مقدارها خالی‌اند و کاربر پر می‌کند */
  envTemplate: Record<string, string>
  /** راهنمای فارسی: کلید را از کجا بگیرد */
  hintFa: string
}

export const CURATED_MCP_SERVERS: CuratedMcpServer[] = [
  {
    id: 'github',
    nameFa: 'گیت‌هاب',
    descriptionFa: 'مدیریت ریپوها، ایشوها و پول‌ریکوئست‌ها',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    envTemplate: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    hintFa: 'توکن را از github.com ← Settings ← Developer settings ← Personal access tokens بساز (دسترسی repo).',
  },
  {
    id: 'fetch',
    nameFa: 'دریافت وب',
    descriptionFa: 'خواندن و تبدیل صفحات وب به متن',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    envTemplate: {},
    hintFa: 'بدون کلید کار می‌کند.',
  },
  {
    id: 'memory',
    nameFa: 'حافظهٔ دانش',
    descriptionFa: 'گراف دانش بلندمدت برای ایجنت',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    envTemplate: {},
    hintFa: 'بدون کلید کار می‌کند؛ داده‌ها محلی ذخیره می‌شوند.',
  },
  {
    id: 'filesystem',
    nameFa: 'فایل‌سیستم',
    descriptionFa: 'خواندن و نوشتن فایل در پوشه‌های مجاز',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', ''],
    envTemplate: {},
    hintFa: 'به‌جای مقدار خالی، مسیر پوشهٔ مجاز را بنویس (مثلاً /home/mamadi/projects). فقط همان پوشه‌ها در دسترس‌اند.',
  },
  {
    id: 'slack',
    nameFa: 'اسلک',
    descriptionFa: 'خواندن و ارسال پیام در ورک‌اسپیس اسلک',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    envTemplate: { SLACK_BOT_TOKEN: '', SLACK_TEAM_ID: '' },
    hintFa: 'از api.slack.com ← اپ خودت ← OAuth & Permissions: توکن xoxb و شناسهٔ تیم (T...) را بردار.',
  },
  {
    id: 'postgres',
    nameFa: 'پستگرس',
    descriptionFa: 'اجرای کوئری روی دیتابیس PostgreSQL',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', ''],
    envTemplate: {},
    hintFa: 'به‌جای مقدار خالی، connection string را بنویس: postgresql://user:pass@host:5432/dbname',
  },
  {
    id: 'sqlite',
    nameFa: 'اسکیولایت',
    descriptionFa: 'کار با دیتابیس‌های محلی SQLite',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite', '--db-path', ''],
    envTemplate: {},
    hintFa: 'به‌جای مقدار خالی، مسیر فایل دیتابیس را بنویس (مثلاً /home/mamadi/data.db).',
  },
  {
    id: 'brave-search',
    nameFa: 'جست‌وجوی بریو',
    descriptionFa: 'جست‌وجوی وب و اخبار',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    envTemplate: { BRAVE_API_KEY: '' },
    hintFa: 'کلید رایگان را از brave.com/search/api بگیر.',
  },
]

/** ساخت کانفیگ از روی تمپلیت پیشنهادی */
export function curatedToConfig(c: CuratedMcpServer): McpServerConfig {
  return {
    id: c.id,
    name: c.nameFa,
    transport: 'stdio',
    command: c.command,
    args: [...c.args],
    env: { ...c.envTemplate },
    enabled: true,
    curated: true,
  }
}
