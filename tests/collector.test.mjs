import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { apply } from '../server.mjs'
import { SOURCES, sourceForUrl, assertSourceUrl, publicUrl } from '../src/sources.mjs'
import { parsePrice, cleanSnapshot } from '../src/clean.mjs'
import { hotelAccessibilityBlocks } from '../src/accessibility.mjs'
import { collectPage } from '../src/browser.mjs'
import { validateModel } from '../sdk/harness/contracts.mjs'
const contract = JSON.parse(readFileSync(new URL('../contracts/plugin.json', import.meta.url)))
const source = SOURCES[0]
const snapshot = changes => ({ url: 'https://hotels.ctrip.com/hotels/list/?cityId=17', title: '杭州酒店', readyState: 'complete', bodyText: '找到酒店\n杭州样例酒店\n￥299起', blocks: [{ title: '杭州样例酒店', text: '杭州样例酒店\n￥299起', url: 'https://hotels.ctrip.com/hotels/123.html', priceText: '￥299起', selector: '.hotel-card' }], links: [], article: { title: '', text: '', images: [] }, ...changes })

test('normalizes explicit amounts without confusing ranges, discounts or missing data', () => {
  assert.deepEqual(parsePrice('￥1,299.50 每晚'), { raw: '￥1,299.50 每晚', basis: 'per_night', amountMinor: 129950, currency: 'CNY' })
  assert.equal(parsePrice('￥299起').basis, 'starting')
  assert.equal(parsePrice('会员券后￥299').basis, 'conditional')
  assert.equal(parsePrice('折扣券￥299起').basis, 'conditional')
  assert.equal(parsePrice('门店首单满减券￥156起').basis, 'conditional')
  assert.equal(parsePrice('合计￥598').basis, 'total')
  for (const text of ['', '暂无报价', '免费取消', '￥0', '￥199-299', '￥199 ￥299', '299积分', '￥12.345']) assert.equal(parsePrice(text).amountMinor, undefined, text)
})
test('keeps display quotes partial and deduplicates records with source evidence', () => {
  const page = snapshot(); page.blocks.push(page.blocks[0])
  const result = cleanSnapshot(page, source, 'tab-1', 123456)
  validateModel(contract, 'collection', result)
  assert.equal(result.status, 'partial'); assert.equal(result.records.length, 1)
  assert.equal(result.records[0].price.amountMinor, 29900)
  assert.equal(result.collectedAt, 123456)
  assert.ok(result.warnings.some(text => text.includes('未形成完整可比报价')))
})
test('reports login, verification, denial, loading, empty and layout changes separately', () => {
  const cases = [
    [{ url: 'https://passport.ctrip.com/user/login' }, 'login_required'],
    [{ bodyText: '登录后查看搜索结果' }, 'login_required'],
    [{ bodyText: '请完成安全验证' }, 'verification_required'],
    [{ bodyText: '403 Forbidden' }, 'blocked'],
    [{ readyState: 'loading' }, 'loading'],
    [{ blocks: [], bodyText: '暂无相关酒店' }, 'empty'],
    [{ blocks: [], bodyText: '页面新版本，未知结构' }, 'layout_changed'],
  ]
  for (const [changes, status] of cases) {
    const result = cleanSnapshot(snapshot(changes), source, 'tab-1')
    validateModel(contract, 'collection', result)
    assert.equal(result.status, status); assert.equal(result.records.length, 0)
  }
})
test('distinguishes guide links from full text and notes unprocessed image information', () => {
  const guide = SOURCES.find(s => s.id === 'xiaohongshu')
  let result = cleanSnapshot(snapshot({ url: guide.home }), guide, 'tab-2')
  assert.equal(result.status, 'partial'); assert.equal(result.records[0].kind, 'guide_link')
  result = cleanSnapshot(snapshot({ url: guide.home, article: { title: '杭州步行路线', text: '西湖路线与交通建议。'.repeat(15), images: ['https://example.com/guide.png'] } }), guide, 'tab-2')
  assert.equal(result.status, 'ok'); assert.equal(result.records[0].kind, 'guide'); assert.ok(result.warnings.some(s => s.includes('OCR')))
})
test('rejects unsupported origins and removes session parameters from returned links', () => {
  for (const url of ['http://hotels.ctrip.com/', 'https://ctrip.com.evil.test/', 'https://ctrip.com@evil.test/', 'https://hotels.ctrip.com:9999/', 'http://127.0.0.1:8649/']) assert.equal(sourceForUrl(url), undefined)
  assert.throws(() => assertSourceUrl('https://www.meituan.com/', 'ctrip'))
  assert.equal(publicUrl('https://www.xiaohongshu.com/explore/a?xsec_token=private&keyword=杭州#part'), 'https://www.xiaohongshu.com/explore/a?keyword=%E6%9D%AD%E5%B7%9E')
})
function setup(page = snapshot()) {
  const methods = new Map(), tools = new Map(), storage = new Map(), released = []
  let currentPage = page
  const tabs = [{ id: 'tab-1', title: '杭州酒店', url: page.url, loading: false }, { id: 'private-tab', title: 'Studio', url: 'http://127.0.0.1:8649/', loading: false }]
  const browser = { tabs: { list: async () => ({ tabs }), create: async url => ({ id: 'new-tab', title: '新页面', url, loading: true }) }, cdp: { attach: async () => ({}), send: async () => ({ result: { value: currentPage } }), release: async id => { released.push(id) } } }
  apply({ extensions: { rpc: { register: (name, handler) => methods.set(name, handler) }, tools: { register: tool => tools.set(tool.name, tool) } } })
  const context = (userId = 1, profile = 'default', signal = new AbortController().signal) => ({ identity: { userId, profile }, signal, host: { browser }, state: { profile: {
    get: async key => storage.get(`${userId}/${profile}/${key}`), set: async (key, value) => storage.set(`${userId}/${profile}/${key}`, value),
  } } })
  return { call: (name, input, userId, profile) => methods.get(name)(input, context(userId, profile)), tools, context, released, setPage: page => { currentPage = page } }
}
test('RPC uses browser SDK, validates boundaries and isolates persisted user/Profile results', async () => {
  const { call, released } = setup()
  assert.equal((await call('list-tabs', {})).tabs.length, 1)
  assert.equal((await call('last-result', null)).present, false)
  const result = await call('collect-page', { tabId: 'tab-1' })
  assert.equal(result.records.length, 1); assert.deepEqual(released, ['tab-1'])
  assert.equal((await call('last-result', null)).present, true)
  assert.equal((await call('last-result', null, 2)).present, false)
  assert.equal((await call('last-result', null, 1, 'work')).present, false)
  await assert.rejects(call('collect-page', { tabId: 'private-tab' }), /旅游站点/)
  await assert.rejects(call('collect-page', { tabId: 'tab-1', script: 'anything' }), /unknown property/)
  await assert.rejects(call('open-page', { source: 'ctrip', url: 'https://evil.test/' }), /HTTPS/)
})
test('releases browser leases on invalid page output and never persists a malformed result', async () => {
  const { call, setPage, released } = setup()
  setPage({ bad: true })
  await assert.rejects(call('collect-page', { tabId: 'tab-1' }), /missing/)
  assert.deepEqual(released, ['tab-1']); assert.equal((await call('last-result', null)).present, false)
})
test('tools return explicit failures for blocked pages and aborted calls', async () => {
  const { tools, context } = setup(snapshot({ bodyText: '403 Forbidden' }))
  const tool = tools.get('collect_page')
  const result = await tool.execute({ tabId: 'tab-1' }, context())
  assert.equal(result.ok, false); assert.equal(result.data.status, 'blocked')
  assert.deepEqual(JSON.parse(result.content), result.data)
  const abort = new AbortController(); abort.abort()
  const cancelled = await tool.execute({ tabId: 'tab-1' }, context(1, 'default', abort.signal))
  assert.equal(cancelled.ok, false); assert.ok(cancelled.error)
  assert.equal(cancelled.content, cancelled.error)
})

test('MCP content contains the same structured hotel records as data', async () => {
  const { tools, context } = setup()
  const result = await tools.get('collect_page').execute({ tabId: 'tab-1' }, context())
  assert.equal(result.ok, true)
  assert.deepEqual(JSON.parse(result.content), result.data)
  assert.equal(JSON.parse(result.content).records[0].price.amountMinor, 29900)
})

test('MCP guide content remains valid JSON beyond the old summary length limit', async () => {
  const text = '路线说明。'.repeat(600)
  const { tools, context } = setup(snapshot({ url: 'https://www.xiaohongshu.com/explore/example', article: { title: '样例攻略', text, images: [] } }))
  const result = await tools.get('collect_page').execute({ tabId: 'tab-1' }, context())
  assert.equal(result.ok, true)
  assert.ok(result.content.length > 2000)
  assert.equal(JSON.parse(result.content).records[0].text, text)
})

test('Ctrip accessibility adapter selects one current price and never substitutes an original price', () => {
  const node = (role, name) => ({ role: { value: role }, name: { value: name } })
  const tree = [node('group', 'Photo gallery for 样例湖畔酒店'), node('StaticText', '样例湖畔酒店'),
    node('StaticText', 'Original price ￥599'), node('StaticText', 'Current price ￥299'), node('StaticText', '起'),
    node('group', 'Photo gallery for 原价酒店'), node('StaticText', '原价酒店'), node('StaticText', 'Original price ￥899')]
  const blocks = hotelAccessibilityBlocks(tree, source.home)
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].priceText, '￥299起')
  assert.equal(blocks[1].priceText, '')
  assert.equal(parsePrice(blocks[0].priceText).amountMinor, 29900)
})

test('SDK uses the fixed accessibility fallback when Ctrip has no matching DOM cards', async () => {
  const calls = [], page = snapshot({ blocks: [] })
  const node = (role, name) => ({ role: { value: role }, name: { value: name } })
  const browser = { tabs: { list: async () => ({ tabs: [{ id: 'tab-1', url: page.url }] }) }, cdp: {
    attach: async () => calls.push('attach'), release: async () => calls.push('release'),
    send: async (_tabId, method) => {
      calls.push(method)
      return method === 'Runtime.evaluate' ? { result: { value: page } } : { nodes: [node('group', 'Photo gallery for 样例湖畔酒店'), node('StaticText', '样例湖畔酒店'), node('StaticText', 'Current price ￥299')] }
    },
  } }
  const result = await collectPage({ tabId: 'tab-1' }, { signal: new AbortController().signal }, contract, browser)
  assert.equal(result.status, 'partial'); assert.equal(result.records[0].price.amountMinor, 29900)
  assert.deepEqual(calls, ['attach', 'Runtime.evaluate', 'Accessibility.getFullAXTree', 'release'])
})
