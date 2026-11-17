import { setTimeout as pause } from 'node:timers/promises'
import { validateModel } from '../sdk/harness/contracts.mjs'
import { SOURCES } from './sources.mjs'
import { collectAttachedPage } from './browser.mjs'
import { hotelPageExpression } from './hotel-page.mjs'

export const normalizeCity = value => value.replace(/\s+/g, '').replace(/市$/, '')
const normalized = value => value.replace(/\s+/g, '')
const isoDay = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
export function validateHotelQuery(input, now = new Date()) {
  const query = { ...input, city: input.city.trim(), address: input.address.trim() }
  if (!query.city || !query.address) throw new Error('请填写城市和地址、商圈或地标')
  for (const key of ['checkIn', 'checkOut']) {
    const date = query[key]
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('日期必须是有效的 YYYY-MM-DD')
  }
  if (query.checkIn < isoDay(now)) throw new Error('入住日期不能早于今天（北京时间）')
  if (query.checkOut <= query.checkIn) throw new Error('离店日期必须晚于入住日期')
  if ((Date.parse(query.checkOut) - Date.parse(query.checkIn)) / 86400000 > 30) throw new Error('本版一次最多查询 30 晚')
  return query
}
function dateVisible(text, iso) {
  const [, month, day] = iso.split('-').map(Number)
  return text.includes(iso) || new RegExp(`(?:^|\\D)0?${month}月0?${day}日`).test(text)
}
export function checkHotelConditions(state, query) {
  const url = new URL(state.url), params = url.searchParams
  return url.hostname === 'hotels.ctrip.com' && url.pathname.startsWith('/hotels/list')
    && normalizeCity(params.get('cityName') || params.get('destName') || '') === normalizeCity(query.city)
    && normalizeCity(state.city) === normalizeCity(query.city)
    && normalized(params.get('searchWord') || '') === normalized(query.address)
    && normalized(state.address) === normalized(query.address)
    && params.get('checkin') === query.checkIn && params.get('checkout') === query.checkOut && params.get('curr') === 'CNY'
    && dateVisible(state.checkInText, query.checkIn) && dateVisible(state.checkOutText, query.checkOut)
}
export function filterDisplayBudget(collection, maxPrice) {
  if (maxPrice === undefined) return { excluded: 0, unverified: 0 }
  let excluded = 0, unverified = 0
  collection.records = collection.records.filter(row => {
    if (row.price.amountMinor === undefined || !['starting', 'per_night'].includes(row.price.basis)) { unverified++; return true }
    if (row.price.amountMinor > Math.round(maxPrice * 100)) { excluded++; return false }
    return true
  })
  collection.warnings.push(`按当前已采集记录的展示价筛选上限 ¥${maxPrice}；排除 ${excluded} 条，另有 ${unverified} 条价格条件不明保留待核实。此筛选不代表全站或最终成交价。`)
  return { excluded, unverified }
}

export async function searchHotels(input, run, contract, browser = run.host.browser) {
  const query = validateHotelQuery(input)
  run.signal.throwIfAborted()
  // The known city is only an entry form; it is replaced through site suggestions.
  // No entry-city records are returned before the requested conditions match.
  const seed = new URL('https://hotels.ctrip.com/hotels/list/?cityId=17')
  seed.searchParams.set('checkin', query.checkIn); seed.searchParams.set('checkout', query.checkOut)
  seed.searchParams.set('curr', 'CNY')
  const tab = await browser.tabs.create(seed.href)
  const inspect = async (command = { action: 'inspect' }) => {
    run.signal.throwIfAborted()
    validateModel(contract, 'hotel-page-command', command)
    const response = await browser.cdp.send(tab.id, 'Runtime.evaluate', { expression: hotelPageExpression(command), returnByValue: true })
    if (response.exceptionDetails || !response.result?.value) throw new Error('酒店查询脚本未能执行，请检查页面布局')
    const state = validateModel(contract, 'hotel-page-state', response.result.value)
    if (state.blocking) throw new Error({ blocked: '站点拒绝访问', verification_required: '请在酒店页面完成安全验证后重试', login_required: '请在内置浏览器登录携程后重试' }[state.blocking])
    if (new URL(state.url).hostname !== 'hotels.ctrip.com') throw new Error('酒店页面已离开支持的来源，停止查询')
    return state
  }
  const wait = async (predicate, message, command, timeout = 18000) => {
    const until = Date.now() + timeout
    while (true) {
      try { const state = await inspect(command); if (predicate(state)) return state }
      catch (error) { if (!/Execution context was destroyed|Cannot find context|Inspected target navigated/i.test(error.message)) throw error }
      if (Date.now() >= until) throw new Error(message)
      await pause(350, undefined, { signal: run.signal })
    }
  }
  const click = async point => {
    run.signal.throwIfAborted()
    for (const type of ['mousePressed', 'mouseReleased']) await browser.cdp.send(tab.id, 'Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 })
  }
  const type = async (field, text) => {
    await inspect({ action: 'focus', field })
    await browser.cdp.send(tab.id, 'Input.insertText', { text })
    await wait(state => normalized(state[field]) === normalized(text), '站点没有接受搜索文字', { action: 'inspect', field, text })
  }
  const choose = async (field, text, required) => {
    const command = { action: 'inspect', field, text }
    let state
    try { state = await wait(state => state.candidates.length > 0, '没有找到明确匹配的地点，请使用站点可识别的城市名', command, 3500) }
    catch (error) { if (!required && error.message.startsWith('没有找到明确匹配')) return ''; throw error }
    if (state.candidates.length !== 1) throw new Error('地点存在多个同名匹配，请补充城市/地址，或在站点手动选择后采集')
    const match = state.candidates[0]
    await click(match)
    return match.detail
  }
  const submit = async predicate => {
    const state = await inspect()
    if (!state.controlsReady) throw new Error('没有匹配酒店搜索按钮')
    await click(state.button)
    return wait(next => (next.url !== state.url || next.documentTime !== state.documentTime) && predicate(next), '搜索条件没有在结果页生效，停止返回酒店；请检查站点输入和日期')
  }
  try {
    await browser.cdp.attach(tab.id)
    await wait(state => state.controlsReady && state.readyState !== 'loading', '酒店搜索页尚未就绪，请检查浏览器')
    await type('city', normalizeCity(query.city))
    await choose('city', normalizeCity(query.city), true)
    await submit(state => state.controlsReady && normalizeCity(new URL(state.url).searchParams.get('cityName') || '') === normalizeCity(query.city))
    await type('address', query.address)
    const selectedLocation = await choose('address', query.address, false)
    const state = await submit(state => state.controlsReady && state.readyState === 'complete' && checkHotelConditions(state, query))
    // Read and verify under the same browser lease; no AI chooses or clicks.
    const collection = await collectAttachedPage({ ...tab, url: state.url }, SOURCES[0], run, contract, browser)
    const final = await inspect()
    if (!checkHotelConditions(final, query)) throw new Error('采集期间酒店搜索条件发生变化，已丢弃本次结果')
    const params = new URL(final.url).searchParams
    const locationMode = selectedLocation && params.get('optionId') && params.get('searchType') !== 'CT' ? 'poi' : 'keyword'
    const budget = filterDisplayBudget(collection, query.maxPrice)
    collection.search = { requested: query, conditionsVerified: true, locationMode, selectedLocation,
      city: final.city, address: final.address, checkInText: final.checkInText, checkOutText: final.checkOutText,
      guests: final.guests, budgetExcluded: budget.excluded, budgetUnverified: budget.unverified }
    collection.warnings.push('按站点当前显示的房间和入住人数查询；最终房型、税费和退订条件仍须在详情页核对。')
    if (locationMode === 'keyword') collection.warnings.push('地址仅作为关键词查询，未完成坐标定位，不能保证附近半径或距离排序。')
    if (['ok', 'partial'].includes(collection.status)) collection.message = `已按「${query.city} · ${query.address}」查询，采集到 ${collection.records.length} 条酒店记录。`
    run.signal.throwIfAborted()
    return validateModel(contract, 'collection', collection)
  } finally { await browser.cdp.release(tab.id).catch(() => {}) }
}
