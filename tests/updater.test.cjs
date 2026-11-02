const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createUpdateController, registerUpdater } = require('../desktop/updater.cjs')

function fixture(options = {}) {
  const app = Object.assign(new EventEmitter(), { isPackaged: true, getVersion: () => '4.3.0' })
  const updater = new EventEmitter()
  const calls = { check: 0, download: 0, install: 0 }
  updater.checkForUpdates = async () => { calls.check++; updater.emit('update-available', { version: '4.3.1' }) }
  updater.downloadUpdate = async () => { calls.download++; updater.emit('update-downloaded', { version: '4.3.1' }) }
  updater.quitAndInstall = () => { calls.install++ }
  const params = { app, updater, platform: 'linux', env: { APPIMAGE: '/apps/Atlas.AppImage' }, ...options }
  return { ...params, calls, controller: createUpdateController(params) }
}

test('checking never downloads or installs; installation requires a verified downloaded event', async () => {
  const { controller, calls, updater } = fixture()
  assert.equal(updater.autoDownload, false)
  assert.equal(updater.autoInstallOnAppQuit, false)
  assert.equal(updater.disableDifferentialDownload, false)
  assert.equal(updater.allowDowngrade, false)
  assert.equal(updater.allowPrerelease, false)
  controller.install()
  await controller.check()
  assert.equal(controller.snapshot().status, 'available')
  controller.install()
  assert.deepEqual(calls, { check: 1, download: 0, install: 0 })
  await controller.download()
  assert.equal(controller.snapshot().status, 'downloaded')
  assert.equal(calls.install, 0)
  controller.install()
  controller.install()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.install, 1)
})

test('unsupported packages cannot check, download or install', async () => {
  for (const options of [
    { app: { isPackaged: false, getVersion: () => '4.3.0' } },
    { platform: 'linux', env: {} },
    { platform: 'win32', env: { PORTABLE_EXECUTABLE_DIR: 'C:/Atlas' } },
    { platform: 'darwin', env: {} },
  ]) {
    const { controller, calls } = fixture(options)
    await controller.check()
    await controller.download()
    controller.install()
    assert.equal(controller.snapshot().supported, false)
    assert.deepEqual(calls, { check: 0, download: 0, install: 0 })
  }
})

test('DEB is supported without claiming differential downloads; installed Windows supports them', () => {
  const deb = fixture({ env: {}, packageType: 'deb' }).controller.snapshot()
  assert.equal(deb.supported, true)
  assert.equal(deb.differential, false)
  const windows = fixture({ platform: 'win32', env: {} }).controller.snapshot()
  assert.equal(windows.supported, true)
  assert.equal(windows.differential, true)
})

test('concurrent checks and downloads are coalesced and cannot overlap', async () => {
  const { controller, updater, calls } = fixture()
  let finishCheck
  updater.checkForUpdates = () => { calls.check++; return new Promise(resolve => { finishCheck = resolve }) }
  const first = controller.check()
  const second = controller.check()
  await controller.download()
  assert.deepEqual(calls, { check: 1, download: 0, install: 0 })
  updater.emit('update-available', { version: '4.3.1' })
  finishCheck()
  await Promise.all([first, second])
  let finishDownload
  updater.downloadUpdate = () => { calls.download++; return new Promise(resolve => { finishDownload = resolve }) }
  const downloads = [controller.download(), controller.download()]
  await controller.check()
  assert.equal(calls.check, 1)
  assert.equal(calls.download, 1)
  updater.emit('update-downloaded', { version: '4.3.1' })
  finishDownload()
  await Promise.all(downloads)
  assert.equal(controller.snapshot().status, 'downloaded')
})

test('failed downloads can retry and progress reaches the UI without leaking error details', async () => {
  const states = []
  const { controller, updater } = fixture({ publish: state => states.push(state) })
  await controller.check()
  updater.downloadUpdate = async () => { throw new Error('private path or URL') }
  await controller.download()
  assert.equal(controller.snapshot().status, 'error')
  assert.equal(controller.snapshot().version, '4.3.1')
  assert.ok(!controller.snapshot().message.includes('private'))
  updater.downloadUpdate = async () => {
    updater.emit('download-progress', { percent: 42, transferred: 420, total: 1000, bytesPerSecond: 10 })
    updater.emit('update-downloaded', { version: '4.3.1' })
  }
  await controller.download()
  assert.equal(states.find(state => state.percent === 42).transferred, 420)
  assert.equal(controller.snapshot().status, 'downloaded')
})

test('no update leaves the current version available for another check', async () => {
  const { controller, updater } = fixture()
  updater.checkForUpdates = async () => updater.emit('update-not-available')
  await controller.check()
  assert.equal(controller.snapshot().status, 'current')
  updater.checkForUpdates = async () => { throw new Error('offline') }
  await controller.check()
  assert.equal(controller.snapshot().status, 'error')
  assert.equal(controller.snapshot().version, null)
})

test('IPC accepts only the owned top-level application frame', () => {
  const { app, updater } = fixture({ platform: 'darwin' })
  const sender = { mainFrame: {} }
  const handlers = {}
  registerUpdater({
    app, updater, platform: 'darwin', env: {}, packageType: '',
    BrowserWindow: { getAllWindows: () => [{ webContents: sender }] },
    ipcMain: { handle: (channel, handler) => { handlers[channel] = handler } },
  })
  const handler = handlers['atlas:update-state']
  assert.throws(() => handler({ sender: {}, senderFrame: {} }), /rejected/)
  assert.throws(() => handler({ sender, senderFrame: {} }), /rejected/)
  assert.equal(handler({ sender, senderFrame: sender.mainFrame }).currentVersion, '4.3.0')
})
