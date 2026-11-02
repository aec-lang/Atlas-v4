const RELEASES_URL = 'https://github.com/aec-lang/Atlas-v4/releases/latest'

function createUpdateController({ app, updater, platform = process.platform, env = process.env, packageType = '', publish = () => {} }) {
  let reason = ''
  if (!app.isPackaged) reason = 'آپدیت داخلی فقط در نسخهٔ نصب‌شدهٔ برنامه فعال است.'
  else if (platform === 'linux' && !env.APPIMAGE && packageType !== 'deb') reason = 'آپدیت داخلی در لینوکس برای نسخهٔ AppImage و بستهٔ DEB فعال است.'
  else if (platform === 'win32' && env.PORTABLE_EXECUTABLE_DIR) reason = 'نسخهٔ قابل‌حمل آپدیت داخلی ندارد؛ یک بار نسخهٔ Setup را نصب کن.'
  else if (platform === 'darwin') reason = 'آپدیت خودکار مک به نسخهٔ امضاشده نیاز دارد؛ فعلاً نسخهٔ جدید را از صفحهٔ انتشار دریافت کن.'
  else if (!['linux', 'win32'].includes(platform)) reason = 'آپدیت داخلی برای این سیستم‌عامل فعال نیست.'

  let state = {
    status: reason ? 'unsupported' : 'idle',
    supported: !reason,
    currentVersion: app.getVersion(),
    version: null,
    percent: 0,
    transferred: 0,
    total: 0,
    bytesPerSecond: 0,
    message: reason,
    releasesURL: RELEASES_URL,
    differential: platform !== 'linux' || !!env.APPIMAGE,
  }
  let checking = null
  let downloading = null
  let installing = false
  const snapshot = () => ({ ...state })
  const change = patch => {
    state = { ...state, ...patch }
    publish(snapshot())
  }
  const fail = () => {
    installing = false
    change({ status: 'error', message: 'ارتباط با سرور آپدیت یا دریافت فایل ناموفق بود. اینترنت، فضای دیسک و دسترسی نوشتن را بررسی کن و دوباره تلاش کن.' })
  }

  if (state.supported) {
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowPrerelease = false
    updater.allowDowngrade = false
    updater.disableDifferentialDownload = false
    updater.on('checking-for-update', () => change({ status: 'checking', version: null, message: '' }))
    updater.on('update-available', info => change({ status: 'available', version: info.version, percent: 0, transferred: 0, total: 0, message: '' }))
    updater.on('update-not-available', () => change({ status: 'current', version: null, message: '' }))
    updater.on('download-progress', progress => change({
      status: 'downloading',
      percent: Math.max(0, Math.min(100, progress.percent || 0)),
      transferred: progress.transferred || 0,
      total: progress.total || 0,
      bytesPerSecond: progress.bytesPerSecond || 0,
    }))
    updater.on('update-downloaded', info => change({ status: 'downloaded', version: info.version, percent: 100, message: '' }))
    updater.on('error', fail)
  }

  async function check() {
    if (!state.supported || downloading || installing || ['available', 'downloading', 'downloaded'].includes(state.status)) return snapshot()
    if (checking) return checking
    checking = (async () => {
      change({ status: 'checking', version: null, message: '' })
      try { await updater.checkForUpdates() } catch { fail() }
      return snapshot()
    })()
    try { return await checking } finally { checking = null }
  }

  async function download() {
    if (downloading) return downloading
    if (!state.supported || checking || !state.version || !['available', 'error'].includes(state.status)) return snapshot()
    downloading = (async () => {
      change({ status: 'downloading', percent: 0, transferred: 0, total: 0, message: '' })
      try { await updater.downloadUpdate() } catch { fail() }
      return snapshot()
    })()
    try { return await downloading } finally { downloading = null }
  }

  function install() {
    if (state.status !== 'downloaded' || installing) return snapshot()
    installing = true
    setImmediate(() => {
      try { updater.quitAndInstall(false, true) } catch { installing = false; fail() }
    })
    return snapshot()
  }

  return { snapshot, check, download, install }
}

function registerUpdater({ app, ipcMain, BrowserWindow, updater, platform = process.platform, env = process.env, packageType }) {
  if (packageType === undefined) {
    try { packageType = require('node:fs').readFileSync(require('node:path').join(process.resourcesPath, 'package-type'), 'utf8').trim() } catch { packageType = '' }
  }
  if (!updater) {
    const { autoUpdater, AppImageUpdater, DebUpdater } = require('electron-updater')
    updater = platform === 'linux' && env.APPIMAGE ? new AppImageUpdater() : platform === 'linux' && packageType === 'deb' ? new DebUpdater() : autoUpdater
  }
  const controller = createUpdateController({
    app,
    updater,
    platform,
    env,
    packageType,
    publish: state => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('atlas:update-state', state)
      }
    },
  })
  for (const [action, handler] of Object.entries({ state: controller.snapshot, check: controller.check, download: controller.download, install: controller.install })) {
    ipcMain.handle(`atlas:update-${action}`, event => {
      const owned = BrowserWindow.getAllWindows().some(win => win.webContents === event.sender)
      if (!owned || event.senderFrame !== event.sender.mainFrame) throw new Error('Update request rejected')
      return handler()
    })
  }
  if (controller.snapshot().supported) {
    const startup = setTimeout(() => { void controller.check() }, 20_000)
    const interval = setInterval(() => { void controller.check() }, 6 * 60 * 60 * 1000)
    startup.unref()
    interval.unref()
    app.once('before-quit', () => { clearTimeout(startup); clearInterval(interval) })
  }
  return controller
}

module.exports = { createUpdateController, registerUpdater }
