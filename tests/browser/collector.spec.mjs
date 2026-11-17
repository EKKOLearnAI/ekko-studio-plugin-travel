import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { captureDocument } from '../../src/capture.mjs'
import { SOURCES } from '../../src/sources.mjs'
import { cleanSnapshot } from '../../src/clean.mjs'
const clientSource = readFileSync(new URL('../../client.mjs', import.meta.url), 'utf8')
const source = SOURCES[0]
async function fixture(page) {
  await page.route('https://hotels.ctrip.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<html><head><title>杭州酒店测试</title></head><body><article class="hotel-card"><h2 class="hotel-name">样例湖畔酒店</h2><p>大床房，免费取消</p><span class="sale-price">￥299起</span></article><article hidden class="hotel-card"><h2 class="hotel-name">隐藏旧报价</h2><span class="sale-price">￥1起</span></article><div id="root"></div></body></html>' }))
  await page.goto('https://hotels.ctrip.com/hotels/list/?cityId=17')
  const snapshot = await page.evaluate(captureDocument, source)
  return cleanSnapshot(snapshot, source, 'test-tab', 1700000000000)
}
test('DOM collector scopes visible hotel cards and preserves starting-price evidence', async ({ page }) => {
  const result = await fixture(page)
  expect(result.status).toBe('partial'); expect(result.records).toHaveLength(1)
  expect(result.records[0].title).toBe('样例湖畔酒店')
  expect(result.records[0].price).toMatchObject({ amountMinor: 29900, basis: 'starting' })
})
test('Ctrip prices use one explicit current amount, retain conditions and reject original-only or ambiguous quotes', async ({ page }) => {
  await page.setContent(`<article class="hotel-card"><h2 class="hotel-name">当前价酒店</h2><div class="price">早鸟优惠<span aria-label="Original price ¥499">¥499</span><span aria-label="Current price ¥299">¥299</span>起</div></article>
    <article class="hotel-card"><h2 class="hotel-name">新客酒店</h2><div class="price">新客体验钻石<span aria-label="Original price ¥299">¥299</span><span aria-label="Current price ¥199">¥199</span>起</div></article>
    <article class="hotel-card"><h2 class="hotel-name">仅原价酒店</h2><div class="price"><span aria-label="Original price ¥899">¥899</span>起</div></article>
    <article class="hotel-card"><h2 class="hotel-name">多当前价酒店</h2><div class="price"><span aria-label="Current price ¥199">¥199</span>起</div><div class="price"><span aria-label="Current price ¥299">¥299</span>起</div></article>`)
  const snapshot = await page.evaluate(captureDocument, source)
  snapshot.url = 'https://hotels.ctrip.com/hotels/list/?cityId=17'
  const result = cleanSnapshot(snapshot, source, 'price-test')
  expect(result.records[0].price).toMatchObject({ amountMinor: 29900, basis: 'starting' })
  expect(result.records[0].price.raw).not.toContain('499')
  expect(result.records[0].text).toContain('499')
  expect(result.records[1].price).toMatchObject({ amountMinor: 19900, basis: 'conditional' })
  expect(result.records[2].price.amountMinor).toBeUndefined()
  expect(result.records[3].price.amountMinor).toBeUndefined()
})
async function mount(page, result, fail = false) {
  await page.evaluate(async ({ clientSource, result, fail }) => {
    const directory = [{ id: 'ctrip', name: '携程酒店', kind: 'hotel', home: 'https://hotels.ctrip.com/' }]
    const ctx = { lifecycle: { add: dispose => { window.disposeTravel = dispose } }, rpc: { call: async (name, input) => {
      if (name === 'list-sources') return { sources: directory }
      if (name === 'list-tabs') return { tabs: [{ id: 'test-tab', title: '杭州酒店', source: 'ctrip', url: result.url, loading: false }] }
      if (['last-result', 'last-transport'].includes(name)) return { present: false }
      if (name === 'collect-page') { if (fail) throw new Error('站点要求重新登录'); return result }
      throw new Error(`unexpected ${name}`)
    } } }
    const url = URL.createObjectURL(new Blob([clientSource], { type: 'text/javascript' }))
    try { await (await import(url)).mount(document.getElementById('root'), ctx) } finally { URL.revokeObjectURL(url) }
  }, { clientSource, result, fail })
}
test('UI collects, labels partial data, safely renders text and cleans up', async ({ page }) => {
  const result = await fixture(page)
  result.records[0].title = '<img src=x onerror=alert(1)>样例酒店'
  await mount(page, result)
  await page.getByRole('button', { name: '采集并清洗' }).click()
  await expect(page.locator('#travel-status')).toHaveText('部分数据')
  await expect(page.locator('.record h3')).toHaveText('<img src=x onerror=alert(1)>样例酒店')
  await expect(page.locator('.record img')).toHaveCount(0)
  await expect(page.locator('.price')).toHaveText('￥299起')
  await page.getByText('查看结构化数据', { exact: true }).click()
  await expect(page.locator('pre').first()).toContainText('amountMinor')
  await page.evaluate(() => window.disposeTravel())
  await expect(page.locator('#root')).toBeEmpty()
})
test('mobile UI keeps failures visible and permits retry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const result = await fixture(page)
  await mount(page, result, true)
  await page.getByRole('button', { name: '采集并清洗' }).click()
  await expect(page.getByRole('alert')).toHaveText('站点要求重新登录')
  await expect(page.getByRole('button', { name: '采集并清洗' })).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
