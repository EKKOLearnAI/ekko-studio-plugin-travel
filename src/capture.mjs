// Runs inside the selected tab. No cookies, browser storage, form values or page globals.
export function captureDocument(config) {
  const clean = (value, max = 12000) => String(value || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
  const visible = el => !!el && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none'
  const first = (el, selectors) => selectors.map(selector => el.querySelector(selector)).find(visible)
  const seen = new Set(), blocks = []
  for (const selector of config.selectors) for (const el of document.querySelectorAll(selector)) {
    if (blocks.length >= 40 || seen.has(el) || !visible(el)) continue
    seen.add(el)
    const title = first(el, config.titleSelectors)
    if (!title) continue
    const links = [...el.querySelectorAll('a[href]')]
    const link = links.find(a => /\/(?:explore|discovery\/item|travels|i\/|hotel)/i.test(a.getAttribute('href') || '')) || links[0]
    let priceText = clean(first(el, config.priceSelectors)?.innerText, 300)
    if (config.id === 'ctrip') {
      const current = [...el.querySelectorAll('[aria-label^="Current price "]')].filter(visible)
      const original = [...el.querySelectorAll('[aria-label^="Original price "]')].filter(visible)
      if (current.length === 1) {
        // Keep the explicit current amount plus visible qualification text.
        // Other amounts (crossed-out prices and coupon savings) are not quotes.
        const amount = current[0].getAttribute('aria-label').slice('Current price '.length)
        const conditions = priceText.replace(/[¥￥]\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g, '')
        priceText = clean(`${amount}\n${conditions}`, 300)
      } else if (current.length > 1) priceText = clean(`价格待定（多个当前价）\n${priceText}`, 300)
      else if (original.length) priceText = clean(`暂无报价（仅展示原价）\n${priceText}`, 300)
    }
    blocks.push({ title: clean(title.innerText, 300), text: clean(el.innerText, 4000), url: link?.href || location.href,
      priceText, selector })
  }
  const article = first(document, ['.ctd_content', '.gs_article', '.travels-article', '.article-content', '#noteContainer .desc', '.note-content .desc', '.note-scroller .desc', '.vc_article'])
  const heading = first(document, ['.ctd_head h2', '.ctd_head h1', '#detail-title', '.note-content .title', 'article h1', 'h1'])
  const links = [...document.querySelectorAll('a[href]')].filter(visible)
    .filter(a => /\/(?:travels\/[^/]+\/\d+\.html|i\/\d+\.html|explore\/[a-z0-9]+|discovery\/item\/[a-z0-9]+)/i.test(a.getAttribute('href') || ''))
    .map(a => ({ title: clean(a.innerText || a.getAttribute('title') || a.querySelector('img')?.alt, 300), url: a.href })).filter(a => a.title.length >= 6).slice(0, 60)
  return { url: location.href, title: clean(document.title, 500), readyState: document.readyState,
    bodyText: clean(document.body?.innerText, 24000), blocks, links,
    article: { title: clean(heading?.innerText || document.title, 300), text: clean(article?.innerText, 20000),
      images: article ? [...article.querySelectorAll('img')].map(img => img.currentSrc || img.src).filter(src => /^https:\/\//.test(src)).slice(0, 12) : [] },
  }
}
export const captureExpression = source => `(${captureDocument.toString()})(${JSON.stringify({ id: source.id, selectors: source.selectors, titleSelectors: source.titleSelectors, priceSelectors: source.priceSelectors })})`
