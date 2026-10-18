/**
 * Atlas Desktop — پروسهٔ اصلی الکترون
 * بدون منوی پیشفرض، لینکهای خارجی در مرورگر سیستم، زمینهٔ ایزوله
 */
const { app, BrowserWindow, shell, Menu, ipcMain, desktopCapturer, Tray } = require('electron')
const path = require('node:path')
const { registerBackend } = require('./backend.cjs')
const { registerTasks } = require('./tasks.cjs')
const { registerMcp } = require('./mcp.cjs')

/** اسکرین‌شات واقعی از صفحه (در پروسهٔ اصلی؛ sandbox اجازهٔ DOM در preload را نمیدهد) */
function registerScreenCapture() {
  ipcMain.handle('atlas:screen-capture', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 },
      })
      if (!sources.length) return { ok: false, error: 'هیچ منبع صفحه‌نمایشی یافت نشد' }
      const dataUrl = sources[0].thumbnail.toDataURL()
      return { ok: true, dataUrl }
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) }
    }
  })
}

app.setName('Atlas')

/* ─── Tray: بستن پنجره برنامه را نمی‌بندد تا کارهای پس‌زمینه نمیرند ─── */
let tray = null
let quitting = false

function setupTray() {
  if (tray) return
  try {
    tray = new Tray(path.join(__dirname, 'icons', '256x256.png'))
    tray.setToolTip('Atlas')
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: 'باز کردن Atlas',
        click: () => {
          const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
          if (win) { win.show(); win.focus() }
          else createWindow()
        },
      },
      {
        label: 'خروج',
        click: () => { quitting = true; app.quit() },
      },
    ]))
    tray.on('click', () => {
      const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
      if (win) {
        if (win.isVisible()) win.hide()
        else { win.show(); win.focus() }
      } else createWindow()
    })
  } catch {
    tray = null
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 920,
    minHeight: 600,
    title: 'Atlas',
    backgroundColor: '#05060a',
    icon: path.join(__dirname, 'icons', '256x256.png'),
    autoHideMenuBar: true,
    show: false,
      webPreferences: {
        contextIsolation: true,
        // sandbox:true → پریلود در محیط ایزوله اجرا میشود (فقط API محدود الکترون در دسترس است)
        sandbox: true,
        spellcheck: false,
        webviewTag: true,
        preload: path.join(__dirname, 'preload.cjs')
      }
  })

  // حذف منوی پیشفرض (الزام امنیتی مستند)
  Menu.setApplicationMenu(null)

  win.once('ready-to-show', () => win.show())
  // بستن پنجره = مخفی‌شدن در tray (نه خروج) تا کارهای پس‌زمینه زنده بمانند
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      win.hide()
    }
  })
  // dist در ریشهٔ پروژه ساخته میشود (vite build)
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  // لینکهای خارجی فقط در مرورگر پیشفرض سیستم
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!win.webContents.getURL().startsWith('file://')) e.preventDefault()
    if (/^https?:\/\//i.test(url)) {
      e.preventDefault()
      shell.openExternal(url)
    }
  })
}

app.whenReady().then(() => {
  registerBackend()
  registerScreenCapture()
  registerTasks()
  registerMcp()
  setupTray()
  createWindow()
})
app.on('before-quit', () => { quitting = true })
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
app.on('window-all-closed', () => {
  // با tray دیگر خودکار خارج نمی‌شویم؛ خروج فقط از منوی tray («خروج»)
})
