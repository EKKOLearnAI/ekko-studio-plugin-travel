import { publicUrl } from './sources.mjs'
export const cleanText = (value, max = 12000) => String(value || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
export function parsePrice(value) {
  const raw = cleanText(value, 300), unknown = { raw, basis: 'unknown' }
  if (!raw || /售罄|无房|暂无报价|价格待定/.test(raw)) return unknown
  const matches = [...raw.matchAll(/[¥￥]\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?![\d.])/g)]
  if (matches.length !== 1 || /\d\s*[-~～至]\s*[¥￥]?\s*\d/.test(raw)) return unknown
  const amount = Number(matches[0][1].replace(/,/g, ''))
  if (!(amount > 0 && amount < 1000000)) return unknown
  const basis = /券后|会员|新客|登录享/.test(raw) ? 'conditional' : /起/.test(raw) ? 'starting' : /总价|合计/.test(raw) ? 'total' : /每晚|\/晚|晚均/.test(raw) ? 'per_night' : 'unknown'
  return { raw, basis, amountMinor: Math.round(amount * 100), currency: 'CNY' }
}
export function cleanSnapshot(snapshot, source, tabId, collectedAt = Date.now()) {
  const text = cleanText(snapshot.bodyText, 24000), title = cleanText(snapshot.title, 500)
  const result = { schemaVersion: 1, source: source.id, tabId, url: publicUrl(snapshot.url), pageTitle: title,
    collectedAt, status: 'layout_changed', message: '尚未匹配正文或数据卡片，请检查页面结构。', records: [], warnings: [],
    diagnostics: { readyState: snapshot.readyState, matchedBlocks: snapshot.blocks.length, matchedLinks: snapshot.links.length,
      articleCharacters: snapshot.article.text.length, excerpt: text.slice(0, 1600) } }
  const stop = (status, message) => ({ ...result, status, message })
  if (/403\s*Forbidden|Access\s*Denied|访问被拒绝/i.test(`${title}\n${text}`)) return stop('blocked', '站点拒绝访问；保留当前页面供人工检查。')
  if (/安全验证|访问验证|完成验证|滑动.*验证|验证码验证|访问过于频繁|异常访问/.test(text)) return stop('verification_required', '页面要求验证，请手动完成后重新采集。')
  if (new URL(snapshot.url).hostname === 'passport.ctrip.com' || /登录后查看搜索结果|请登录后查看|登录后查看全文/.test(text)) return stop('login_required', '请在内置浏览器登录后重新采集。')
  if (snapshot.readyState === 'loading' || !text || /^(?:please wait|加载中|正在加载)[.。…\s]*$/i.test(text)) return stop('loading', '页面尚在加载，稍后重新采集。')
  if (source.kind === 'guide' && snapshot.article.text.length >= 80) {
    result.records.push({ kind: 'guide', title: cleanText(snapshot.article.title, 300), url: result.url,
      text: cleanText(snapshot.article.text, 20000), images: snapshot.article.images.map(publicUrl).filter(Boolean), price: { raw: '', basis: 'unknown' } })
    if (snapshot.article.images.length) result.warnings.push('图片尚未执行 OCR；正文不包含图片独有的信息。')
  } else {
    for (const block of snapshot.blocks) {
      if (!block.title.trim() || !block.text) continue
      result.records.push({ kind: source.kind === 'guide' ? 'guide_link' : source.kind, title: cleanText(block.title, 300), url: publicUrl(block.url),
        text: cleanText(block.text, 4000), images: [], price: parsePrice(block.priceText) })
    }
    if (source.kind === 'guide' && !result.records.length) for (const link of snapshot.links) result.records.push({ kind: 'guide_link', title: cleanText(link.title, 300), url: publicUrl(link.url), text: '', images: [], price: { raw: '', basis: 'unknown' } })
  }
  const seen = new Set()
  result.records = result.records.filter(row => { const key = `${row.url}\n${row.title}`; if (seen.has(key)) return false; seen.add(key); return true }).slice(0, 40)
  if (result.records.length) {
    const linksOnly = result.records.every(row => row.kind === 'guide_link')
    result.status = linksOnly || source.kind !== 'guide' ? 'partial' : 'ok'
    result.message = `脚本已提取 ${result.records.length} 条${linksOnly ? '攻略链接' : '记录'}。`
    if (linksOnly) result.warnings.push('当前只有列表摘要；需打开原文再采集完整攻略。')
    if (source.kind !== 'guide') result.warnings.push('这是页面展示报价；日期、房型、人数、税费和退订规则未形成完整可比报价。')
  } else if (/暂无(?:相关)?(?:结果|内容|酒店)|未找到(?:相关)?(?:结果|内容|酒店)|没有找到相关/.test(text)) {
    result.status = 'empty'; result.message = '页面明确显示没有匹配结果。'
  }
  return result
}
