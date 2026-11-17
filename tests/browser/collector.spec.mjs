import { test, expect } from '@playwright/test'
import { captureDocument } from '../../src/capture.mjs'
import { SOURCES } from '../../src/sources.mjs'
import { cleanSnapshot } from '../../src/clean.mjs'
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
