// Serialized into the hotel tab. Only visible form controls and nearby matches
// are read; no page globals, cookies, hidden application state or account fields.
export function inspectHotelPage(command) {
  const normalize = text => String(text || '').replace(/\s+/g, '').trim()
  const visible = el => {
    if (!el || !el.getClientRects().length) return false
    const style = getComputedStyle(el), rect = el.getBoundingClientRect()
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
  }
  const inputs = [...document.querySelectorAll('input')].filter(visible)
  const city = inputs.find(el => el.placeholder === '目的地')
  const address = inputs.find(el => el.placeholder.includes('位置/品牌/酒店'))
  const checkIn = inputs.find(el => el.id === 'checkInInput')
  const checkOut = inputs.find(el => el.id === 'checkOutInput')
  const body = document.body?.innerText || ''
  const blocking = /403\s*Forbidden|Access\s*Denied|访问被拒绝/i.test(body) ? 'blocked'
    : /安全验证|访问验证|完成验证|验证码验证|访问过于频繁/.test(body) ? 'verification_required'
    : location.hostname === 'passport.ctrip.com' || /请登录后查看|登录后查看搜索结果/.test(body) ? 'login_required' : ''
  const input = command.field === 'city' ? city : address
  if (command.action === 'focus') {
    if (location.hostname !== 'hotels.ctrip.com' || !input) throw new Error('未匹配酒店搜索输入框')
    input.scrollIntoView({ block: 'center', inline: 'nearest' }); input.focus(); input.select()
  }
  const candidates = []
  if (input && command.text && document.activeElement === input) {
    const anchor = input.getBoundingClientRect(), expected = normalize(command.text)
    for (const el of document.querySelectorAll('li,[role="option"],div,span,a')) {
      if (!visible(el) || normalize(el.innerText) !== expected) continue
      if ([...el.children].some(child => visible(child) && normalize(child.innerText) === expected)) continue
      const rect = el.getBoundingClientRect()
      let suggestionPanel
      for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect()
        if (['absolute', 'fixed'].includes(style.position) && bounds.top >= anchor.bottom - 20 && bounds.top <= anchor.bottom + 80) { suggestionPanel = parent; break }
      }
      if (!suggestionPanel) continue
      let partialHighlight = false
      // A matched <span> can be just the highlighted prefix of another place,
      // or part of a subtitle. Verify the complete line containing that span.
      for (let parent = el.parentElement; parent && parent !== suggestionPanel; parent = parent.parentElement) {
        const lines = (parent.innerText || '').split('\n').map(normalize).filter(Boolean)
        if (lines[0] !== expected) { partialHighlight = true; break }
        if (lines.length > 1) break
      }
      if (partialHighlight) continue
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2
      if (rect.top < anchor.bottom - 2 || rect.top > anchor.bottom + 600 || rect.left < Math.max(0, anchor.left - 450) || rect.left > anchor.right + 650 || x >= innerWidth || y >= innerHeight) continue
      if (candidates.some(item => Math.abs(item.x - x) < 5 && Math.abs(item.y - y) < 5)) continue
      let detail = el.innerText
      for (let parent = el.parentElement, count = 0; parent && count < 2; parent = parent.parentElement, count++) {
        const text = parent.innerText?.trim()
        if (text && text.length <= 180) detail = text
      }
      candidates.push({ label: String(el.innerText).trim().slice(0, 200), detail: detail.slice(0, 300), x, y })
      if (candidates.length >= 12) break
    }
  }
  const buttons = [...document.querySelectorAll('button,[role="button"]')].filter(visible)
  const searches = buttons.filter(el => normalize(el.getAttribute('aria-label') || el.innerText).replace(/\p{Co}/gu, '') === '搜索')
  // Responsive layouts wrap the hotel form vertically. Scope by its shared DOM
  // region, rather than coordinates that also risk selecting the global search.
  let region = city?.parentElement, button
  for (let depth = 0; region && region !== document.body && depth < 10; region = region.parentElement, depth++) {
    if (address && region.contains(address)) button = searches.find(el => region.contains(el))
    if (button) break
  }
  const rect = button?.getBoundingClientRect()
  return { url: location.href, documentTime: performance.timeOrigin, readyState: document.readyState, blocking,
    controlsReady: !!city && !!address && !!button, city: city?.value || '', address: address?.value || '',
    checkInText: checkIn?.value || '', checkOutText: checkOut?.value || '',
    guests: buttons.map(el => el.innerText).find(text => /间.*成人/.test(text))?.slice(0, 100) || '',
    button: { x: rect ? rect.left + rect.width / 2 : 0, y: rect ? rect.top + rect.height / 2 : 0 }, candidates }
}
export const hotelPageExpression = command => `(${inspectHotelPage.toString()})(${JSON.stringify(command)})`
