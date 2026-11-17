import { setTimeout as delay } from 'node:timers/promises'
import { validateModel } from '../sdk/harness/contracts.mjs'
import { sourceForUrl, publicUrl } from './sources.mjs'
import { guideExpression, followGuideLink, GUIDE_CONFIG } from './guide-page.mjs'

export const GUIDE_SOURCES = Object.keys(GUIDE_CONFIG)
export function guideSearchUrl(source, query) {
  const url = new URL({ 'ctrip-guide': 'https://you.ctrip.com/globalsearch/', mafengwo: 'https://www.mafengwo.cn/search/q.php', xiaohongshu: 'https://www.xiaohongshu.com/search_result' }[source])
  url.searchParams.set(source === 'mafengwo' ? 'q' : 'keyword', query)
  if (source === 'xiaohongshu') { url.searchParams.set('source', 'web_explore_feed'); url.searchParams.set('type', '51') }
  return url.href
}
export function guideDate(raw = '', evidence = 'unknown') {
  const result = { raw: String(raw).trim().slice(0, 150), evidence: raw ? evidence : 'unknown' }
  const m = result.raw.match(/\b(20\d{2})[-年/.](\d{1,2})[-月/.](\d{1,2})/)
  if (m) {
    const value = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
    const date = new Date(value)
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value) result.date = value
  }
  return result
}
const actions = {
  layout_changed: '当前 Agent 使用 Studio 浏览器查看该标签页的新快照/截图，确认正文区域后人工读取或更新站点适配；也可查询其他来源。不要把此状态报告为没有攻略，不要无限重试。',
  login_required: '请用户在当前内置浏览器完成登录，然后重试原工具；不要索取 Cookie。',
  verification_required: '请用户在浏览器完成验证后重试；不要重复请求或绕过验证。',
  blocked: '该来源被站点阻断，可查询其他来源，或由用户检查当前页面。',
  unavailable: '内容已删除、不可用或入口失效。返回搜索页选择另一条，必要时更新入口。',
  loading: '页面尚未完成加载。稍后可重试一次；持续无内容则请 Agent 检查页面。',
  query_mismatch: '页面搜索条件与请求不一致；检查页面搜索框后重新查询，不使用当前推荐列表回答。',
  browser_error: '检查 Studio 浏览器连接、权限及标签页数量；保留已有页面，不自动关闭用户标签页。',
  cancelled: '操作已取消；未保存本次结果。',
  timeout: '操作超时；检查当前页面或模型服务，避免反复自动重试。',
}
const base = (status, message, extra = {}) => ({ schemaVersion: 1, status, message, collectedAt: Date.now(), records: [], warnings: [], nextAction: actions[status] || '', ...extra })
const good = r => ['ok', 'partial', 'empty'].includes(r.status)
export function normalizeGuide(snapshot, source, tabId, query, limit = 10) {
  const r = base('layout_changed', '页面待适配：没有找到可信的正文或结果链接。', { source, tabId, url: publicUrl(snapshot.url), diagnostics: { method: snapshot.article.method, matchedLinks: snapshot.rows.length, articleCharacters: snapshot.article.text.length, excerpt: snapshot.excerpt } })
  const fail = (status, message) => ({ ...r, status, message, nextAction: actions[status] || '' })
  if (query !== undefined) { r.query = query; r.conditionsVerified = false }
  if (snapshot.gate) return fail(snapshot.gate, { blocked: '站点拒绝访问。', verification_required: '站点要求完成验证。', login_required: '站点要求登录。', unavailable: '页面或内容不可用。' }[snapshot.gate])
  if (sourceForUrl(snapshot.url)?.id !== source) return fail('query_mismatch', '页面已离开所选来源。')
  if (snapshot.readyState === 'loading' || !snapshot.excerpt.trim()) return fail('loading', '页面尚未加载出可见内容。')
  if (query !== undefined) {
    const u = new URL(snapshot.url), expected = new URL(guideSearchUrl(source, query))
    r.conditionsVerified = u.pathname.replace(/\/$/, '') === expected.pathname.replace(/\/$/, '') && u.searchParams.get(source === 'mafengwo' ? 'q' : 'keyword') === query && (!snapshot.inputValues.length || snapshot.inputValues.includes(query))
    if (!r.conditionsVerified) return fail('query_mismatch', '没有核对到请求的搜索关键词。')
  }
  const article = snapshot.article
  const dates = (raw, published = '', modified = '') => ({
    published: guideDate(published || (!/编辑|更新|修改/.test(raw) ? raw : ''), published ? 'metadata' : 'visible'),
    modified: guideDate(modified || (/编辑|更新|修改/.test(raw) ? raw : ''), modified ? 'metadata' : 'visible'),
  })
  if (query === undefined && snapshot.detailKind && article.method !== 'none' && (article.text.length >= 40 || article.images.length)) {
    r.records = [{ kind: snapshot.detailKind, title: article.title, url: r.url, text: article.text, ...dates(article.dateRaw, article.publishedMeta, article.modifiedMeta), images: article.images.map(({ index, url, alt, visible }) => ({ index, url: publicUrl(url), alt, visible })), extraction: article.method, truncated: article.truncated }]
    r.status = article.truncated || article.images.length || article.imagesPending || !article.text || article.method !== 'site_dom' ? 'partial' : 'ok'
    r.message = '已提取当前可见正文；正文不包含图片独有的文字。'
    if (article.images.length) r.warnings.push('图片尚未识别；调用 recognize_guide_image 读取当前完整可见图片。轮播图需逐张切换，不能声称已读完全部图片。')
    if (article.imagesPending) r.warnings.push('部分正文图片尚未加载或加载失败，未计入图片列表；稍后重新 read_guide，不能当作没有图片。')
    if (article.truncated) r.warnings.push('正文超过长度上限，只返回前 20000 字符。')
    if (article.method !== 'site_dom') r.warnings.push('站点专用定位未命中，已使用页面语义结构提取；请核对正文范围。')
    if (source === 'ctrip-guide' && snapshot.detailKind === 'travelogue') r.warnings.push('携程旧游记为存量内容，页面公告说明该业务已停止运维；不能把采集时间当作攻略更新日期。')
  } else if (query !== undefined || !snapshot.detailKind) {
    r.records = snapshot.rows.slice(0, limit).filter(row => sourceForUrl(row.url)?.id === source || source === 'ctrip-guide' && row.selectionTitle && !row.url).map(row => ({ kind: row.kind, title: row.title, url: publicUrl(row.url), ...(row.selectionTitle ? { selectionTitle: row.selectionTitle } : {}), text: row.text, ...dates(row.dateRaw || row.text.match(/发表于\s*20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/)?.[0] || ''), images: [], extraction: 'link_semantics', truncated: true }))
    if (r.records.length) { r.status = 'partial'; r.message = `已提取 ${r.records.length} 条来源链接/摘要，需用 read_guide 打开原文。`; r.warnings.push('只包含已加载且可见的前几条结果；列表摘要不是完整攻略。') }
    else if (snapshot.empty && query !== undefined && r.conditionsVerified) { r.status = 'empty'; r.message = '已核对关键词，页面明确显示无匹配结果。' }
  }
  if (good(r)) r.nextAction = r.records.length && (query !== undefined || !snapshot.detailKind) ? '调用 read_guide，传入本次 tabId 和选中记录的 url；工具使用页内原链接打开，小红书令牌留在浏览器内。' : ''
  if (r.records.some(row => row.selectionTitle)) r.nextAction = '携程部分卡片没有公开 href。当前 Agent 使用 Studio 浏览器按 selectionTitle 定位并点击对应结果，核对打开的页面后调用 read_guide；不要猜测景点或目的地 ID。'
  return r
}

// A semantic AX article is a final fallback. Never flatten the whole page into
// an article: links, navigation and comments would otherwise become攻略正文.
export function accessibilityArticle(nodes, title) {
  const map = new Map(nodes.map(n => [n.nodeId, n]))
  for (const root of nodes.filter(n => !n.ignored && n.role?.value === 'article')) {
    const parts = [], visited = new Set(), stack = [root]; let heading = ''
    while (stack.length && visited.size < 4000) {
      const n = stack.pop(); if (!n || visited.has(n.nodeId) || n.ignored) continue; visited.add(n.nodeId)
      const role = n.role?.value, name = n.name?.value || ''
      if (['navigation','contentinfo','dialog','link','button'].includes(role)) continue
      if (role === 'heading' && !heading) heading = name
      if (role === 'StaticText') parts.push(name)
      for (const id of [...(n.childIds || [])].reverse()) stack.push(map.get(id))
    }
    const text = [...new Set(parts)].join('\n')
    if (text.length >= 160 && heading && title.includes(heading.slice(0, 12))) return { title: heading.slice(0,300), text: text.slice(0,20000), truncated: text.length > 20000 }
  }
}
export async function bounded(promise, signal) {
  signal.throwIfAborted()
  let onAbort
  try { return await Promise.race([promise, new Promise((_, reject) => { onAbort = () => reject(signal.reason); signal.addEventListener('abort', onAbort, { once: true }); if (signal.aborted) onAbort() })]) }
  finally { signal.removeEventListener('abort', onAbort) }
}
async function evaluate(browser, tabId, expression, signal) {
  const response = await bounded(browser.cdp.send(tabId, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }), signal)
  if (response.exceptionDetails || !response.result || !Object.hasOwn(response.result, 'value')) throw new Error('页面执行失败')
  return response.result.value
}
export async function captureAttachedGuide(browser, tabId, source, contract, signal) {
  const snapshot = validateModel(contract, 'guide-snapshot', await evaluate(browser, tabId, guideExpression(source), signal))
  if (!snapshot.gate && snapshot.detailKind && snapshot.article.method === 'none') {
    const ax = await bounded(browser.cdp.send(tabId, 'Accessibility.getFullAXTree', {}), signal)
    const a = accessibilityArticle(ax.nodes || [], snapshot.title)
    if (a) Object.assign(snapshot.article, a, { method: 'accessibility' })
  }
  return validateModel(contract, 'guide-snapshot', snapshot)
}
export function isGuideDetail(url, source) {
  if (sourceForUrl(url)?.id !== source) return false
  const p = new URL(url).pathname
  if (source === 'ctrip-guide') return /^\/(?:travels|sight)\/[^/]+\/\d+\.html$/i.test(p) || /^\/place\/[^/]+\.html$/i.test(p)
  if (source === 'mafengwo') {
    const q = new URL(url).searchParams
    return /^\/(?:i|poi)\/\d+\.html$/.test(p) || /^\/(?:gonglve\/(?:ziyouxing|mdd)|travel-scenic-spot\/mafengwo)\/\d+\.html$/.test(p) || /^\/mdd\/route\/\d+_\d+\.html$/.test(p) || p === '/mmobile/wanfaguide/' && /^\d+$/.test(q.get('gid') || '') || p === '/nb/public/sharejump.php' && q.get('type') === '7' && /^\d+$/.test(q.get('id') || '')
  }
  return /^\/(?:explore|search_result|discovery\/item)\/[a-z0-9]+$/i.test(p)
}
export async function runGuide(operation, input, run, contract, options = {}) {
  const browser = run.host.browser, signal = AbortSignal.any([run.signal, AbortSignal.timeout(options.timeoutMs || 20000)])
  let tab, attached = false, source = input.source
  try {
    signal.throwIfAborted()
    if (operation === 'search_guides') {
      const query = input.query.trim()
      if (!query) return base('invalid_input', '搜索词不能为空。')
      const url = guideSearchUrl(source, query)
      if (input.tabId) {
        tab = (await bounded(browser.tabs.list(), signal)).tabs.find(t => t.id === input.tabId)
        if (!tab || sourceForUrl(tab.url)?.id !== source) return base('invalid_input', '复用标签页必须属于所选攻略来源。')
      } else tab = await bounded(browser.tabs.create(url), signal)
      await bounded(browser.cdp.attach(tab.id), signal); attached = true
      if (input.tabId) await bounded(browser.cdp.send(tab.id, 'Page.navigate', { url }), signal)
    } else {
      tab = (await bounded(browser.tabs.list(), signal)).tabs.find(t => t.id === input.tabId)
      source = sourceForUrl(tab?.url)?.id
      if (!tab || !GUIDE_SOURCES.includes(source)) return base('invalid_input', '请选择三种攻略来源之一的现有标签页。')
      if (input.url && !isGuideDetail(input.url, source)) return base('invalid_input', '详情链接必须属于当前来源的攻略、景点或目的地页面。')
      await bounded(browser.cdp.attach(tab.id), signal); attached = true
      if (input.url) {
        const followed = await evaluate(browser, tab.id, `(${followGuideLink.toString()})(${JSON.stringify(input.url)})`, signal)
        if (!followed) return base('unavailable', '原链接已不在当前结果页，请重新搜索后选择。', { source, tabId: tab.id })
      }
    }
    let output
    for (let i = 0; i < (options.attempts || 12); i++) {
      signal.throwIfAborted()
      const snapshot = await captureAttachedGuide(browser, tab.id, source, contract, signal)
      output = normalizeGuide(snapshot, source, tab.id, operation === 'search_guides' ? input.query.trim() : undefined, input.limit || 10)
      // Navigation can briefly leave the old document available.
      if (input.url && !snapshot.gate) {
        const actual = new URL(snapshot.url), target = new URL(input.url)
        const redirectedNote = source === 'mafengwo' && target.pathname === '/nb/public/sharejump.php' && actual.pathname === `/i/${target.searchParams.get('id')}.html`
        const sameNote = source === 'xiaohongshu' && isGuideDetail(actual.href, source) && actual.pathname.split('/').at(-1) === target.pathname.split('/').at(-1)
        const same = actual.pathname === target.pathname && ['id','gid','aggregate_id'].every(k => actual.searchParams.get(k) === target.searchParams.get(k))
        if (!same && !redirectedNote && !sameNote) output = base('loading', '正在打开选择的原文。', { source, tabId: tab.id })
      }
      if (!['loading','query_mismatch','layout_changed'].includes(output.status) && !(operation === 'read_guide' && good(output) && snapshot.article.imagesPending)) break
      if (i < (options.attempts || 12)-1) await delay(options.pollMs ?? 400, null, { signal })
    }
    signal.throwIfAborted()
    validateModel(contract, 'guide-result', output)
    if (good(output)) await bounded(run.state.profile.set('last-guide-v1', output), signal)
    return output
  } catch {
    return base(signal.aborted ? run.signal.aborted ? 'cancelled' : 'timeout' : 'browser_error', signal.aborted ? '攻略操作已取消或超时。' : '无法完成浏览器采集，请检查连接、权限和当前页面。', { ...(source ? { source } : {}), ...(tab ? { tabId: tab.id } : {}) })
  } finally { if (attached) await browser.cdp.release(tab.id).catch(() => {}) }
}
