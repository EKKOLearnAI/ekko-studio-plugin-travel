import { setTimeout as pause } from 'node:timers/promises'
import { validateModel } from '../sdk/harness/contracts.mjs'
import { parsePrice } from './clean.mjs'
import { publicUrl } from './sources.mjs'
import { transportExpression, flightCityExpression, revealFlightCards } from './transport-page.mjs'

const norm = s => String(s || '').replace(/\s+/g, '').replace(/市$/, '')
const city = label => label.replace(/\([A-Z]{3}\)$/, '').trim()
const cityCode = label => label.match(/\(([A-Z]{3})\)$/)?.[1] || ''
export function validateTransportQuery(input, mode, now = new Date()) {
  const q = { mode, from: input.from.trim(), to: input.to.trim(), departureDate: input.departureDate, limit: input.limit ?? 20,
    ...(mode === 'train' ? { highSpeedOnly: input.highSpeedOnly ?? true } : { directOnly: input.directOnly ?? true, cabin: input.cabin ?? 'economy' }) }
  const date = q.departureDate
  if (!q.from || !q.to || norm(q.from) === norm(q.to)) throw new Error('请提供不同的出发地和目的地')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('出发日期必须是有效的 YYYY-MM-DD')
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  if (date < today) throw new Error('出发日期不能早于今天（北京时间）')
  if ((Date.parse(date) - Date.parse(today)) / 86400000 > 365) throw new Error('本版仅查询未来一年内的出发日期；实际预售范围以站点为准')
  return q
}
export function transportConditions(page, q, codes) {
  const url = new URL(page.url), p = url.searchParams
  if (q.mode === 'train') return url.hostname === 'trains.ctrip.com' && url.pathname === '/webapp/train/list'
    && p.get('ticketType') === '0' && norm(p.get('dStation')) === norm(q.from) && norm(p.get('aStation')) === norm(q.to)
    && p.get('dDate') === q.departureDate && norm(page.fromLabel) === norm(q.from) && norm(page.toLabel) === norm(q.to)
    && page.dateLabel === q.departureDate && page.tripLabel === '单程'
  return url.hostname === 'flights.ctrip.com' && url.pathname === `/online/list/oneway-${codes.from.toLowerCase()}-${codes.to.toLowerCase()}`
    && p.get('depdate') === q.departureDate && p.get('cabin') === (q.cabin === 'economy' ? 'y' : 'y_s_c_f')
    && p.get('adult') === '1' && p.get('child') === '0' && p.get('infant') === '0'
    && norm(city(page.fromLabel)) === norm(q.from) && norm(city(page.toLabel)) === norm(q.to)
    && cityCode(page.fromLabel) === codes.from && cityCode(page.toLabel) === codes.to
    && page.dateLabel === q.departureDate && page.tripLabel === '单程'
    && (q.cabin === 'economy' ? page.cabinLabel === '经济舱' : page.cabinLabel === '不限舱等')
}
export function ticketPrice(raw, currency, starting = false) {
  if (!raw || currency !== 'CNY') return { raw, basis: 'unknown' }
  const numeric = /^\d+(?:\.\d{1,2})?$/.test(raw.trim())
  const parsed = parsePrice(numeric ? `¥${raw}` : raw)
  return { ...parsed, raw, basis: parsed.amountMinor === undefined ? 'unknown' : parsed.basis === 'conditional' || /学生|领券/.test(raw) ? 'conditional' : starting || parsed.basis === 'starting' ? 'starting' : 'per_seat' }
}
export function seatAvailability(raw) {
  if (/未开售|未起售/.test(raw)) return 'not_on_sale'
  if (/抢|无票|售罄|暂无余票|停售|(?:^|\D)0张/.test(raw)) return 'unavailable'
  if (/有票|\d+张|预订/.test(raw)) return 'available'
  return 'unknown'
}
export function cleanTransport(page, q, tabId, conditionsVerified, now = Date.now()) {
  const result = { schemaVersion: 1, mode: q.mode, source: q.mode === 'train' ? 'ctrip-trains' : 'ctrip-flights', tabId,
    url: publicUrl(page.url), pageTitle: page.title, collectedAt: now, status: 'partial', message: '', requested: q, conditionsVerified,
    observed: { from: page.fromLabel, to: page.toLabel, departureDate: page.dateLabel, cabin: page.cabinLabel },
    loadedCount: page.loadedCount, matchedCount: page.matchedCount, truncated: page.matchedCount > page.rows.length,
    records: [], warnings: [], diagnostics: { invalidRows: 0, excerpt: page.excerpt } }
  if (page.blocking) { result.status = page.blocking; result.message = '站点需要登录、验证或拒绝访问，请在原页面检查。'; return result }
  if (/预售期|尚未开售|未开售/.test(page.excerpt) && !page.rows.length) { result.status = 'not_on_sale'; result.message = '页面提示该日期尚未开售或超出预售范围。'; return result }
  if (!conditionsVerified) { result.status = 'layout_changed'; result.message = '查询条件未能与结果页核对，未返回交通记录。'; return result }
  const seen = new Set()
  for (const row of page.rows) {
    const dep = row.departureTime.match(/\b\d{2}:\d{2}\b/)?.[0], arr = row.arrivalTime.match(/\b\d{2}:\d{2}\b/)?.[0]
    if (!row.serviceCodes.length || !row.serviceCodes.every(Boolean) || !dep || !arr || !row.departurePlace || !row.arrivalPlace) { result.diagnostics.invalidRows++; continue }
    const key = [row.serviceCodes.join('+'), row.departurePlace, row.arrivalPlace, dep].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    result.records.push({ serviceCodes: row.serviceCodes, provider: row.provider, departurePlace: row.departurePlace,
      arrivalPlace: row.arrivalPlace, departureTime: dep, arrivalTime: arr, arrivalDayText: row.arrivalDayText,
      durationText: row.durationText, connectionType: row.connectionType, connectionText: row.connectionText, cabinText: row.cabinText,
      price: ticketPrice(row.priceText, row.currency, q.mode === 'train'), feeInclusion: /不含/.test(row.feeText) ? 'excluded' : /含/.test(row.feeText) ? 'included' : 'unknown',
      conditionsText: row.conditionsText, seats: row.seats.map(seat => ({ name: seat.name, availability: seatAvailability(seat.availabilityText),
        availabilityText: seat.availabilityText, ...(seat.availabilityText.match(/(\d+)张/) ? { remaining: Number(seat.availabilityText.match(/(\d+)张/)[1]) } : {}), price: ticketPrice(seat.priceText, row.currency) })),
      rawText: row.rawText, url: result.url })
  }
  if (!result.records.length) {
    result.status = (page.loadedCount > 0 && page.matchedCount === 0) || /暂无.*(?:车次|航班)|没有.*(?:车次|航班)|未找到.*(?:车次|航班)/.test(page.excerpt) ? 'empty' : 'layout_changed'
    result.message = result.status === 'empty' ? '页面明确没有匹配的班次或航班。' : '未匹配可用的交通记录，请检查页面结构。'
  } else result.message = `已核对${q.from} → ${q.to} · ${q.departureDate}，提取 ${result.records.length} 条${q.mode === 'train' ? '列车' : '航班'}记录。`
  result.warnings.push('仅涵盖当前页面已加载记录，不保证全量结果或最低价；结果保留查询时间。')
  result.warnings.push(q.mode === 'train' ? '“抢票”标为不可直接购买，不代表有余票；席别价与网页起价分别保留。' : '单程 1 成人；列表展示价未完整核实机建燃油、行李及退改条件，不自动叠加税费。')
  return result
}

export async function searchTransport(input, mode, run, contract, browser = run.host.browser) {
  const q = validateModel(contract, 'transport-query', validateTransportQuery(input, mode))
  run.signal.throwIfAborted()
  const tab = await browser.tabs.create(mode === 'train' ? buildTrainUrl(q) : 'https://flights.ctrip.com/online/channel/domestic')
  const evaluate = async (expression, model) => {
    run.signal.throwIfAborted()
    const response = await browser.cdp.send(tab.id, 'Runtime.evaluate', { expression, returnByValue: true })
    if (response.exceptionDetails || !Object.hasOwn(response.result || {}, 'value')) throw new Error('交通页面脚本执行失败，请检查站点页面')
    return validateModel(contract, model, response.result.value)
  }
  const wait = async (fn, message, timeout = 25000) => {
    const until = Date.now() + timeout
    while (true) {
      try { const value = await fn(); if (value) return value }
      catch (error) { if (!/Execution context was destroyed|Cannot find context|Inspected target navigated/i.test(error.message)) throw error }
      if (Date.now() >= until) throw new Error(message)
      await pause(350, undefined, { signal: run.signal })
    }
  }
  try {
    await browser.cdp.attach(tab.id)
    let codes
    if (mode === 'flight') {
      const read = command => evaluate(flightCityExpression(validateModel(contract, 'flight-city-command', command)), 'flight-city-state')
      await wait(async () => { const s = await read({ action: 'inspect' }); if (s.blocking) throw new Error('机票页面需要人工验证'); return s.ready && s }, '机票城市选择尚未就绪')
      codes = {}
      for (const field of ['from', 'to']) {
        let state = await read({ action: 'inspect' }), label = state[`${field}Label`]
        if (norm(city(label)) !== norm(q[field]) || !cityCode(label)) {
          await read({ action: 'focus', field })
          for (const type of ['keyDown', 'keyUp']) await browser.cdp.send(tab.id, 'Input.dispatchKeyEvent', { type, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
          await browser.cdp.send(tab.id, 'Input.insertText', { text: q[field] })
          await wait(async () => { const s = await read({ action: 'inspect', field, text: q[field] }); return s.candidateCount > 0 && s }, '没有匹配的机票城市，请输入城市中文名称')
          await read({ action: 'choose', field, text: q[field] })
          state = await wait(async () => { const s = await read({ action: 'inspect' }); return norm(city(s[`${field}Label`])) === norm(q[field]) && cityCode(s[`${field}Label`]) && s }, '站点没有接受城市选择')
          label = state[`${field}Label`]
        }
        codes[field] = cityCode(label)
      }
      run.signal.throwIfAborted()
      await browser.cdp.send(tab.id, 'Page.navigate', { url: buildFlightUrl(q, codes) })
      const initial = await wait(async () => {
        const s = await evaluate(transportExpression(q), 'transport-page')
        return s.blocking || (s.readyState === 'complete' && (s.loadedCount || /暂无.*航班|没有.*航班|未找到.*航班|未开售/.test(s.excerpt))) ? s : false
      }, '机票结果页尚未加载')
      if (!initial.blocking && initial.loadedCount) {
        run.signal.throwIfAborted()
        const response = await browser.cdp.send(tab.id, 'Runtime.evaluate', { expression: `(${revealFlightCards.toString()})()`, returnByValue: true, awaitPromise: true })
        if (response.exceptionDetails) throw new Error('航班号加载失败，请查看原始页面')
        validateModel(contract, 'flight-reveal-state', response.result?.value)
      }
    }
    let stableSince = 0, key = ''
    const page = await wait(async () => {
      const s = await evaluate(transportExpression(q), 'transport-page')
      if (s.blocking) return s
      if (s.readyState === 'complete' && !s.rows.length && /预售期|尚未开售|未开售/.test(s.excerpt)) return s
      const verified = transportConditions(s, q, codes)
      const terminal = s.rows.length || (s.loadedCount > 0 && s.matchedCount === 0) || /暂无.*(?:车次|航班)|没有.*(?:车次|航班)|未找到.*(?:车次|航班)/.test(s.excerpt)
      if (!verified || s.readyState !== 'complete' || !terminal) return false
      const nextKey = `${s.url}|${s.loadedCount}|${s.matchedCount}`
      if (nextKey !== key) { key = nextKey; stableSince = Date.now(); return false }
      return Date.now() - stableSince >= 600 && s
    }, '交通结果未加载或查询条件没有生效，请查看原页面')
    const verified = transportConditions(page, q, codes)
    const result = validateModel(contract, 'transport-result', cleanTransport(page, q, tab.id, verified))
    if (verified) {
      const final = await evaluate(transportExpression(q), 'transport-page')
      if (!transportConditions(final, q, codes)) throw new Error('采集期间出发地、目的地或日期发生变化，已丢弃结果')
    }
    run.signal.throwIfAborted()
    return result
  } finally { await browser.cdp.release(tab.id).catch(() => {}) }
}
export function buildTrainUrl(q) {
  const url = new URL('https://trains.ctrip.com/webapp/train/list')
  for (const [key, value] of Object.entries({ ticketType: '0', dStation: q.from, aStation: q.to, dDate: q.departureDate, rDate: '', trainsType: '', hubCityName: '', highSpeedOnly: '0' })) url.searchParams.set(key, value)
  return url.href
}
export function buildFlightUrl(q, codes) {
  if (!/^[A-Z]{3}$/.test(codes.from) || !/^[A-Z]{3}$/.test(codes.to)) throw new Error('机票城市代码无效')
  const url = new URL(`https://flights.ctrip.com/online/list/oneway-${codes.from.toLowerCase()}-${codes.to.toLowerCase()}`)
  for (const [key, value] of Object.entries({ depdate: q.departureDate, cabin: q.cabin === 'economy' ? 'y' : 'y_s_c_f', adult: '1', child: '0', infant: '0' })) url.searchParams.set(key, value)
  return url.href
}
