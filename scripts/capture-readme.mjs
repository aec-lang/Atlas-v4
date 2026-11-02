import { mkdir } from 'node:fs/promises'
const { chromium } = await import(process.env.ATLAS_PLAYWRIGHT_MODULE || 'playwright')

const output = 'docs/assets/screenshots'
await mkdir(output, { recursive: true })
const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1320, height: 840 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'چطور میتونم کمک کنم؟' }).waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.getByText('به هر مدلی وصل میشم و کارها رو انجام میدم', { exact: false }).waitFor()
  await page.screenshot({ path: `${output}/home-dark.png`, animations: 'disabled' })
  await page.keyboard.press('Control+,')
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: /^OpenAI/ }).click()
  await dialog.screenshot({ path: `${output}/api-setup.png`, animations: 'disabled' })
  await dialog.getByRole('button', { name: 'بستن', exact: true }).click()
  await page.getByTitle('ابزارها و قابلیت‌های پیشرفته').click()
  const tools = page.getByRole('dialog', { name: 'ابزارهای Atlas' })
  await tools.getByRole('button', { name: 'کانکتورها', exact: true }).click()
  await page.screenshot({ path: `${output}/tools-mcp.png`, animations: 'disabled' })
  await tools.getByRole('button', { name: 'بستن', exact: true }).click()
  await page.getByTitle('کاغذی — روشن').click()
  await page.getByRole('heading', { name: 'چطور میتونم کمک کنم؟' }).evaluate(heading => {
    heading.closest('.overflow-y-auto').scrollTo({ top: 0, behavior: 'instant' })
  })
  await page.screenshot({ path: `${output}/home-light.png`, animations: 'disabled' })
  console.log(`Captured four screenshots of the real web UI in ${output}`)
} finally {
  await browser.close()
}
