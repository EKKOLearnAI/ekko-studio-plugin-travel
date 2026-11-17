// Runs only in the selected, supported browser page. Never reads cookies,
// localStorage, application globals, hidden application state or arbitrary JS.
export function captureGuidePage(config) {
  const allowed = config.source === 'ctrip-guide' ? ['you.ctrip.com','passport.ctrip.com'].includes(location.hostname) : new RegExp(`(^|\\.)${config.source === 'mafengwo' ? 'mafengwo\\.cn' : 'xiaohongshu\\.com'}$`).test(location.hostname)
  if (location.protocol !== 'https:' || !allowed) throw new Error('页面已离开攻略来源')
  const trim = (s, n = 20000) => String(s || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n)
  const visible = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none' && getComputedStyle(e).opacity !== '0' && !e.closest('[hidden],[aria-hidden="true"]')
  const first = (root, selectors) => selectors.flatMap(s => [...root.querySelectorAll(s)]).find(visible)
  const skip = 'nav,footer,aside,script,style,noscript,[hidden],[aria-hidden="true"],[itemprop="comment"],[aria-label*="评论"],.comments-container,.comment-list,.comments-el,.recommend-container,[role="navigation"],[role="dialog"],[role="feed"]'
  const textOf = root => {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), parts = []; let node, length = 0, count = 0
    while ((node = walk.nextNode()) && count++ < 12000 && length < 30000) {
      const e = node.parentElement
      if (!e || e.closest(skip) || !visible(e)) continue
      const s = trim(node.textContent); if (s) { parts.push(s); length += s.length }
    }
    return trim(parts.join('\n'))
  }
  const publicLink = value => {
    try { const u = new URL(value, location.href); if (u.protocol === 'http:') u.protocol = 'https:'; if (u.protocol !== 'https:' || u.username || u.password || u.port) return ''; u.hash = ''; for (const k of [...u.searchParams.keys()]) if (!['q', 'keyword', 'type'].includes(k) && !(/(^|\.)mafengwo\.cn$/.test(u.hostname) && ['id','gid','aggregate_id'].includes(k) && /^\d+$/.test(u.searchParams.get(k)))) u.searchParams.delete(k); return u.href.slice(0, 4096) } catch { return '' }
  }
  const kindOf = value => {
    try {
      const u = new URL(value)
      if (config.source === 'ctrip-guide' && u.hostname === 'you.ctrip.com') {
        if (/^\/travels\/[^/]+\/\d+\.html$/i.test(u.pathname)) return 'travelogue'
        if (/^\/sight\/[^/]+\/\d+\.html$/i.test(u.pathname)) return 'attraction'
        if (/^\/place\/[^/]+\.html$/i.test(u.pathname)) return 'destination'
      }
      if (config.source === 'mafengwo' && /(^|\.)mafengwo\.cn$/.test(u.hostname)) {
        if (/^\/i\/\d+\.html$/.test(u.pathname)) return 'travelogue'
        if (u.pathname === '/nb/public/sharejump.php' && u.searchParams.get('type') === '7' && /^\d+$/.test(u.searchParams.get('id') || '')) return 'travelogue'
        if (/^\/mdd\/route\/\d+_\d+\.html$/.test(u.pathname) || u.pathname === '/mmobile/wanfaguide/' && /^\d+$/.test(u.searchParams.get('gid') || '')) return 'guide'
        if (/^\/(?:gonglve|localdeals)\/(?:ziyouxing|mdd)\/\d+\.html$/.test(u.pathname)) return 'guide'
        if (/^\/poi\/\d+\.html$/.test(u.pathname)) return 'attraction'
        if (/^\/travel-scenic-spot\/mafengwo\/\d+\.html$/.test(u.pathname)) return 'destination'
      }
      if (config.source === 'xiaohongshu' && /(^|\.)xiaohongshu\.com$/.test(u.hostname) && /^\/(explore|search_result|discovery\/item)\/[a-z0-9]+$/i.test(u.pathname)) return 'guide'
    } catch {}
    return ''
  }
  const body = trim(document.body?.innerText, 24000), title = trim(document.title, 500)
  const gateText = trim([...document.querySelectorAll('[role="dialog"],.login-container,.login-modal,.captcha-container')].filter(visible).map(e => e.innerText).join('\n'), 3000)
  let gate = ''
  if (/403\s*Forbidden|Access\s*Denied|访问被拒绝|请求被拦截/i.test(title + '\n' + body.slice(0, 800))) gate = 'blocked'
  else if (/安全验证|完成验证|滑动.{0,15}验证|访问过于频繁|异常访问|验证码验证/.test(gateText || body.slice(0, 1200))) gate = 'verification_required'
  else if (/^passport\./.test(location.hostname) || /^(?:账号|用户)?登录/.test(title) || /登录后(?:查看|浏览|搜索)|登录后继续|请先登录|手机号登录|扫码登录/.test(gateText) || /登录后查看全文|登录后查看搜索结果|请登录后查看/.test(body.slice(0, 1200))) gate = 'login_required'
  else if (/404|页面不存在|笔记不存在|内容已删除|内容无法展示/.test(title + '\n' + body.slice(0, 400))) gate = 'unavailable'
  const inputValues = [...document.querySelectorAll('input[type="search"],input[name="q"],input[name="keyword"],#search-input,#_allSearchKeyword,input[placeholder*="搜索"]')].filter(visible).map(e => trim(e.value, 120)).filter(Boolean).slice(0, 10)
  const rows = [], seen = new Set()
  // Current Ctrip search cards use JS click handlers without href. Return
  // their visible titles as browser selection handles; never guess a POI ID.
  if (config.source === 'ctrip-guide' && location.pathname === '/globalsearch/') {
    for (const card of [...document.querySelectorAll('a.guide-main-item')].filter(visible).slice(0, 20)) {
      const name = trim(first(card, ['.title'])?.innerText, 300)
      if (!name || card.getAttribute('href')) continue
      const section = card.closest('.travel-list-container')
      const label = trim(section?.querySelector('.travel-list-header-title-main')?.innerText, 100)
      // Only the destination and attraction sections, never hotel/deal cards.
      if (!/目的地|景点/.test(label)) continue
      rows.push({ title: name, url: '', kind: /景点/.test(label) ? 'attraction' : 'destination', text: trim(card.innerText, 1800), dateRaw: '', selectionTitle: name })
    }
  }
  for (const a of [...document.querySelectorAll('a[href]')].slice(0, 4000)) {
    if (!visible(a) || a.closest('nav,footer,[role="navigation"]')) continue
    const url = publicLink(a.href), kind = kindOf(url)
    if (!kind || seen.has(url)) continue
    const container = a.closest('.note-item,.tn-item,.journals-item,.journalslist li,.so-item,article,li,dl') || a
    const heading = first(a, ['.title','.head','.tn-title','h2','h3','dt']) || first(container, ['.title','.head','.tn-title','h2','h3','dt'])
    const name = trim(heading?.innerText || a.getAttribute('title') || a.innerText || a.querySelector('img')?.alt, 300)
    if (name.length < 2 || /^查看更多|^更多相关/.test(trim(a.innerText))) continue
    seen.add(url)
    rows.push({ title: name, url, kind, text: trim(container.innerText, 1800), dateRaw: trim(first(container, ['time','.date','.time','.publish-time','.foot .seg-info'])?.innerText, 150) })
    if (rows.length === 40) break
  }
  const detailKind = kindOf(publicLink(location.href))
  let article = { title: '', text: '', method: 'none', dateRaw: '', publishedMeta: '', modifiedMeta: '', images: [], imagesPending: false, truncated: false }
  if (detailKind && !gate) {
    const heading = first(document, ['#detail-title','.swiper-slide-active .guide > .title','.ctd_head h1','.ctd_head h2','.headtext h1','h1','[role="heading"][aria-level="1"]'])
    const articleTitle = trim(heading?.innerText || document.querySelector('meta[property="og:title"]')?.content || title.replace(/\s*[-_].{0,30}(小红书|马蜂窝|携程).*$/, ''), 300)
    const sets = [
      ['site_dom', config.articles],
      ['semantic_dom', ['[itemprop="articleBody"]','article','[role="article"]','main','[role="main"]']],
    ]
    let root
    for (const [method, selectors] of sets) {
      const candidates = [...new Set(selectors.flatMap(s => [...document.querySelectorAll(s)]))].filter(visible)
      const scored = candidates.map(e => {
        const text = textOf(e), linked = [...e.querySelectorAll('a')].filter(visible).reduce((sum, a) => sum + (a.innerText || '').length, 0)
        const enough = text.length >= (method === 'site_dom' ? 40 : 160)
        const associated = method === 'site_dom' || heading && (e.contains(heading) || e.matches('[itemprop="articleBody"]') && e.parentElement?.contains(heading))
        return { e, text, valid: enough && associated && linked / Math.max(text.length, 1) < 0.55 && !e.closest('.comment-list,.comments-container') }
      }).filter(c => c.valid).sort((a, b) => b.text.length - a.text.length)
      if (scored.length && articleTitle.length >= 2) { root = scored[0].e; article = { ...article, title: articleTitle, text: scored[0].text, method, truncated: scored[0].text.length >= 20000 }; break }
    }
    const scope = root?.closest('#noteContainer,article,.ctd_main,.view') || root?.parentElement
    const date = scope && first(scope, ['.travels_end span','time','.bottom-container .date','.note-content .date','.time','.publish-time','.vc_time','.ctd_content_controls'])
    article.dateRaw = trim(date?.getAttribute('datetime') || date?.innerText, 150)
    if (!article.dateRaw && scope) article.dateRaw = trim((scope.innerText || '').match(/(?:发表于|发布于|发布时间|编辑于|更新于)\s*[:：]?\s*\d{2,4}[-年/.]\d{1,2}(?:[-月/.]\d{1,2}日?)?(?:\s+\d{1,2}:\d{2})?/)?.[0], 150)
    article.publishedMeta = trim(document.querySelector('meta[property="article:published_time"],meta[itemprop="datePublished"]')?.content, 150)
    article.modifiedMeta = trim(document.querySelector('meta[property="article:modified_time"],meta[itemprop="dateModified"]')?.content, 150)
    if (config.source === 'ctrip-guide') article.dateRaw = trim(first(document, ['.travels_end span'])?.innerText || article.dateRaw, 150)
    // JSON-LD supplies dates only when its headline matches the visible article.
    for (const s of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 8)) {
      if ((s.textContent || '').length > 100000) continue
      try {
        const parsed = JSON.parse(s.textContent), values = Array.isArray(parsed) ? parsed : [parsed, ...(Array.isArray(parsed['@graph']) ? parsed['@graph'] : [])]
        for (const v of values) if (v && typeof v.headline === 'string' && trim(v.headline, 300) === articleTitle) { if (typeof v.datePublished === 'string') article.publishedMeta ||= trim(v.datePublished, 150); if (typeof v.dateModified === 'string') article.modifiedMeta ||= trim(v.dateModified, 150) }
      } catch {}
    }
    // Only content images, never avatars, comments, recommendations or site chrome.
    const imageRoot = config.source === 'xiaohongshu' ? first(document, ['#noteContainer .media-container','#noteContainer .note-slider','#noteContainer .swiper']) : root
    const imgs = imageRoot ? [...imageRoot.querySelectorAll('img')] : []
    article.imagesPending = imgs.some(img => visible(img) && (!img.complete || !img.naturalWidth))
    const imageSeen = new Set()
    for (const img of imgs) {
      const url = publicLink(img.currentSrc || img.src)
      if (!visible(img) || !url || imageSeen.has(url) || img.closest(skip) || img.naturalWidth < 160 || img.naturalHeight < 120) continue
      imageSeen.add(url)
      const r = img.getBoundingClientRect(), inside = r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.width >= 80 && r.height >= 80
      const clear = inside && [[.2,.2],[.5,.5],[.8,.8]].every(([x,y]) => { const hit = document.elementFromPoint(r.x+r.width*x,r.y+r.height*y); return hit === img || img.contains(hit) })
      article.images.push({ index: article.images.length, url, alt: trim(img.alt, 300), visible: !!clear, x: Math.max(0, r.x + scrollX), y: Math.max(0, r.y + scrollY), width: Math.max(0, r.width), height: Math.max(0, r.height) })
      if (article.images.length === 20) break
    }
    if (!article.text && imageRoot && article.images.length && articleTitle.length >= 2) article = { ...article, title: articleTitle, method: 'site_dom' }
  }
  return { url: publicLink(location.href), title, readyState: document.readyState, gate, excerpt: detailKind ? trim(article.text || title, 800) : body.slice(0, 800), empty: /暂无(?:相关)?(?:结果|内容|笔记)|未找到(?:相关)?(?:结果|内容)|没有找到相关/.test(body.slice(0, 3000)), inputValues, detailKind, rows: rows.slice(0, 40), article }
}

export const GUIDE_CONFIG = {
  'ctrip-guide': { source: 'ctrip-guide', articles: ['.travel-content-wrapper','.ctd_content','.gs_article','.travels-article','.article-content','.detailModule .moduleContent','.detailModule .introduce','.detailModule .description'] },
  mafengwo: { source: 'mafengwo', articles: ['.swiper-slide-active .guide-html','.day-list','.vc_article','.article-content','._j_content_box','.mfw-travelnotes','.summary'] },
  xiaohongshu: { source: 'xiaohongshu', articles: ['#noteContainer .desc','.note-content .desc','#detail-desc'] },
}
export const guideExpression = source => `(${captureGuidePage.toString()})(${JSON.stringify(GUIDE_CONFIG[source])})`

// Uses an existing public link as a handle; site-issued navigation tokens stay
// inside the browser and are neither exposed nor persisted by the plugin.
export function followGuideLink(url) {
  const target = new URL(url), a = [...document.querySelectorAll('a[href]')].find(a => {
    try { const u = new URL(a.href); return u.hostname === target.hostname && u.pathname === target.pathname && ['id','gid','aggregate_id'].every(k => u.searchParams.get(k) === target.searchParams.get(k)) && a.getClientRects().length > 0 } catch { return false }
  })
  if (!a && /xiaohongshu\.com$/.test(target.hostname)) return false
  const u = new URL(a?.href || url); u.protocol = 'https:'
  if (u.username || u.password || u.port) return false
  location.assign(u.href); return true
}
