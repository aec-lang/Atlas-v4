const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { createReadStream, existsSync, readFileSync, statSync } = require('node:fs')
const path = require('node:path')
const yaml = require('js-yaml')

async function verify() {
  if (!['linux', 'win32'].includes(process.platform)) return
  const output = path.resolve('release')
  const metadataPath = path.join(output, process.platform === 'linux' ? 'latest-linux.yml' : 'latest.yml')
  const metadata = yaml.load(readFileSync(metadataPath, 'utf8'))
  assert.equal(metadata.version, require('../package.json').version)
  assert.ok(Array.isArray(metadata.files) && metadata.files.length > 0)
  const extensions = new Set()
  for (const file of metadata.files) {
    const name = decodeURIComponent(file.url)
    assert.equal(path.basename(name), name)
    const fullPath = path.join(output, name)
    assert.ok(existsSync(fullPath), `Missing update asset: ${name}`)
    assert.equal(statSync(fullPath).size, file.size)
    const hash = createHash('sha512')
    for await (const chunk of createReadStream(fullPath)) hash.update(chunk)
    assert.equal(hash.digest('base64'), file.sha512, `Wrong checksum: ${name}`)
    extensions.add(path.extname(name))
    if (name.endsWith('.AppImage')) assert.ok(file.blockMapSize > 0, 'AppImage must include its differential block map')
    if (process.platform === 'win32') {
      assert.ok(name.endsWith('-Setup.exe'), 'Windows updates must target NSIS, not Portable')
      assert.ok(existsSync(`${fullPath}.blockmap`), 'NSIS differential block map is missing')
    }
  }
  if (process.platform === 'linux') {
    assert.ok(extensions.has('.AppImage'), 'AppImage is missing from Linux update metadata')
    assert.ok(extensions.has('.deb'), 'DEB is missing from Linux update metadata')
  }
  console.log(`Verified updater metadata, checksums and differential assets: ${metadataPath}`)
}

verify().catch(error => { console.error(error); process.exitCode = 1 })
