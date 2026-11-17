// Query-result DOM only: no passenger details, cookies, storage or page globals.
export function captureTransportPage(query) {
  const clean = (s, max = 3000) => String(s || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
  const text = (root, selector) => clean(root?.querySelector(selector)?.textContent)
  const body = document.body?.innerText || ''
  const blocking = /403\s*Forbidden|Access\s*Denied|访问被拒绝/i.test(body) ? 'blocked'
    : /安全验证|访问验证|完成验证|访问过于频繁|滑动.*验证/.test(body) ? 'verification_required'
    : /passport\.ctrip\.com/.test(location.hostname) || /请登录后查询|登录后查看/.test(body) ? 'login_required' : ''
  let rows = [], fromLabel = '', toLabel = '', dateLabel = '', cabinLabel = '', tripLabel = '', heading = '', loadedCount = 0, matchedCount = 0
  if (query.mode === 'train') {
    fromLabel = document.querySelector('#label-departStation')?.value || ''
    toLabel = document.querySelector('#label-arriveStation')?.value || ''
    heading = clean(document.querySelector('h1,h2')?.innerText, 600)
    dateLabel = heading.match(/\d{4}-\d{2}-\d{2}/)?.[0] || ''
    tripLabel = heading.includes('单程') ? '单程' : ''
    const cards = [...document.querySelectorAll('section[role="product"] > .list-item')]
    loadedCount = cards.length
    const matched = cards.filter(c => !query.highSpeedOnly || /^[GDC]\d/.test(text(c, '.checi')))
    matchedCount = matched.length
    rows = matched.slice(0, query.limit).map(card => {
      let detail = card.nextElementSibling
      while (detail?.tagName === 'STYLE') detail = detail.nextElementSibling
      if (!detail?.matches('.list-open')) detail = null
      const availability = [...card.querySelectorAll('.surplus-list li')].map(e => clean(e.textContent, 150))
      const offers = detail ? [...detail.querySelectorAll('.list-seat-select > li')].map(e => {
        const name = text(e, '.seat-type')
        return { name, availabilityText: availability.find(s => s.startsWith(name)) || text(e, 'button'), priceText: text(e, '.price') }
      }) : availability.map(s => ({ name: s.replace(/(?:有票|\d+张|\(抢\)|（抢）|无票).*$/, ''), availabilityText: s, priceText: '' }))
      const price = card.querySelector('.price')
      const yuan = price && (/¥|￥/.test(getComputedStyle(price, '::before').content) || /¥|￥/.test(price.textContent))
      return { serviceCodes: [text(card, '.checi').match(/^[A-Z]?\d{1,5}/)?.[0] || ''], provider: '铁路',
        departurePlace: text(card, '.from .station'), arrivalPlace: text(card, '.to .station'),
        departureTime: text(card, '.from .time'), arrivalTime: text(card, '.to .time'), arrivalDayText: text(card, '.to .day'),
        durationText: text(card, '.haoshi'), connectionType: 'direct', connectionText: '', cabinText: '',
        priceText: clean(price?.textContent, 300), currency: yuan ? 'CNY' : '', conditionsText: '', feeText: '',
        seats: offers.slice(0, 10), rawText: clean(card.textContent + '\n' + (detail?.textContent || '')) }
    })
  } else {
    const root = document.querySelector('.modify-search-v3') || document
    fromLabel = root.querySelector('input[name="owDCity"]')?.value || ''
    toLabel = root.querySelector('input[name="owACity"]')?.value || ''
    dateLabel = root.querySelector('.depart-date input')?.value || ''
    cabinLabel = clean(root.querySelector('.form-select-v3')?.innerText, 100).replace(/\p{Co}/gu, '').trim()
    tripLabel = clean(root.querySelector('.form-select-radio-group li.active')?.innerText, 100).replace(/\p{Co}/gu, '').trim()
    const cards = [...document.querySelectorAll('.root-flights .flight-item.domestic')]
    loadedCount = cards.length
    const describe = card => {
      const planes = [...card.querySelectorAll('.flight-airline .plane-No')]
      const stops = clean(card.querySelector('.arrow-box')?.innerText, 300)
      const connection = /经停/.test(stops) ? 'stopover' : /中转|通程|转机/.test(stops) || planes.length > 1 ? 'connection' : planes.length === 1 ? 'direct' : 'unknown'
      return { planes, stops, connection }
    }
    const matched = cards.filter(c => !query.directOnly || describe(c).connection === 'direct')
    matchedCount = matched.length
    rows = matched.slice(0, query.limit).map(card => {
      const { planes, stops, connection } = describe(card)
      const codes = [...new Set(planes.flatMap(e => [...e.textContent.matchAll(/\b[A-Z0-9]{2}\d{3,4}[A-Z]?\b/g)].map(m => m[0])))].slice(0, 4)
      const priceNode = card.querySelector('.flight-operate .flight-price span.price')
      const amount = clean(priceNode?.textContent, 100)
      const tags = [...card.querySelectorAll('.flight-tags .tag,.flight-tags [data-testid]')].map(e => clean(e.textContent, 200))
      const conditions = tags.filter(t => /会员|新客|首单|学生|券后|领券/.test(t)).join(' ')
      const caption = text(card, '.flight-operate .sub-price-detail')
      return { serviceCodes: codes, provider: text(card, '.airline-name'), departurePlace: text(card, '.depart-box .airport'),
        arrivalPlace: text(card, '.arrive-box .airport'), departureTime: text(card, '.depart-box .time'),
        arrivalTime: text(card, '.arrive-box .time'), arrivalDayText: text(card, '.arrive-box .time .day'),
        durationText: text(card, '.flight-total-time'), connectionType: connection, connectionText: stops, cabinText: caption,
        priceText: clean(`${amount}${text(card, '.flight-price .qi')} ${conditions}`, 500), currency: /¥|￥/.test(amount) ? 'CNY' : '',
        conditionsText: clean(tags.join(' '), 600), feeText: /(?:含|不含)(?:税|机建|燃油)/.test(caption) ? caption : '', seats: [], rawText: clean(card.textContent) }
    })
  }
  return { url: location.href, title: clean(document.title, 500), readyState: document.readyState, blocking,
    fromLabel, toLabel, dateLabel, cabinLabel, tripLabel, heading, loadedCount, matchedCount, rows, excerpt: clean(body, 2400) }
}
export const transportExpression = query => `(${captureTransportPage.toString()})(${JSON.stringify(query)})`

export function flightCityPage(command) {
  const norm = s => String(s || '').replace(/\s+/g, '').replace(/市$/, '')
  const visible = e => e && e.getClientRects().length && e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== 'hidden'
  const root = document.querySelector('.modify-search-v3 .search-form')
  const from = root?.querySelector('input[name="owDCity"]'), to = root?.querySelector('input[name="owACity"]')
  const input = command.field === 'from' ? from : to
  const expected = norm(command.text)
  const candidates = root ? [...root.querySelectorAll('[data-u_key="poi_select_item"],[data-u_key="poi_select_city"]')].filter(visible).filter(e => {
    const label = e.querySelector('.code.city')?.textContent || (e.getAttribute('data-u_key') === 'poi_select_city' ? e.getAttribute('title') : '')
    return !!expected && norm(label) === expected
  }) : []
  if (command.action === 'focus') {
    if (!visible(input)) throw new Error('机票城市输入框尚未就绪')
    input.scrollIntoView({ block: 'center', inline: 'center' }); input.focus(); input.select()
  }
  if (command.action === 'choose') {
    if (candidates.length !== 1) throw new Error('未找到唯一城市匹配；请使用城市中文名，不要混用机场名称')
    candidates[0].click()
  }
  return { url: location.href, readyState: document.readyState, ready: !!visible(from) && !!visible(to),
    fromLabel: from?.value || '', toLabel: to?.value || '', candidateCount: candidates.length,
    blocking: /安全验证|完成验证|访问过于频繁/.test(document.body?.innerText || '') ? 'verification_required' : '' }
}
export const flightCityExpression = command => `(${flightCityPage.toString()})(${JSON.stringify(command)})`

// Flight numbers are lazy-rendered when a card enters the viewport. Inspect a
// bounded set of DOM cards; never expand fares or click reservation controls.
export async function revealFlightCards() {
  const before = { x: scrollX, y: scrollY }
  const cards = [...document.querySelectorAll('.root-flights .flight-item.domestic')].slice(0, 50)
  for (const card of cards) {
    card.scrollIntoView({ block: 'center', inline: 'nearest' })
    await new Promise(resolve => setTimeout(resolve, 180))
  }
  scrollTo(before.x, before.y)
  return { visited: cards.length }
}
