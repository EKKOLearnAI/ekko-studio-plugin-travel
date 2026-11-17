/** @param {HTMLElement} root @param {import('@ekko-studio/plugin-sdk').ClientContext} ctx */
export async function mount(root, ctx) {
  const controller = new AbortController()
  const statusNames = { ok: '正文已提取', partial: '部分数据', login_required: '需要登录', verification_required: '需要验证', blocked: '访问受限', loading: '页面加载中', empty: '暂无结果', layout_changed: '待适配页面' }
  root.innerHTML = `<style>
    *{box-sizing:border-box}body{margin:0}button,input,select{font:inherit}button,select,input{border:1px solid var(--border-color, #cbd5e1);border-radius:9px;padding:10px 12px;background:var(--theme-input-bg,transparent);color:inherit}button{cursor:pointer}button:disabled{opacity:.5;cursor:wait}button.primary{background:var(--primary-color,#078477);color:white;border-color:transparent}a{color:var(--primary-color,#078477);overflow-wrap:anywhere}.travel{max-width:1180px;margin:auto;padding:24px;color:var(--text-color,#172b3a);font:14px/1.65 var(--font-family,system-ui)}h1,h2,h3,p{margin:0}h1{font-size:28px;letter-spacing:-.7px}h2{font-size:17px}h3{font-size:16px}.muted{color:var(--text-color-secondary,#64748b)}.eyebrow{font-size:11px;letter-spacing:2px;text-transform:uppercase}.head{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-bottom:24px}.tag{border:1px solid var(--border-color,#cbd5e1);border-radius:30px;padding:4px 12px;white-space:nowrap;font-size:12px}.layout{display:grid;grid-template-columns:310px minmax(0,1fr);gap:20px;align-items:start}.panel,.record{border:1px solid var(--border-color,#cbd5e1);border-radius:14px;padding:20px;background:var(--theme-card-bg,transparent)}.panel+ .panel{margin-top:18px}label{display:block;font-size:12px;margin:16px 0 6px}select,input{width:100%}.row{display:flex;gap:9px;margin-top:14px;flex-wrap:wrap}.row button{flex:1}.notice{margin:14px 0;padding:12px;border-left:3px solid var(--primary-color,#078477);background:var(--theme-input-bg,transparent);white-space:pre-wrap}.empty{text-align:center;padding:58px 22px}.empty strong{display:block;font-size:18px;margin-bottom:10px}.stats{display:flex;gap:20px;margin:15px 0 20px;flex-wrap:wrap}.stats strong{font-size:22px;display:block}.records{display:grid;gap:12px}.record{padding:16px}.record p{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:10px;max-height:270px;overflow:auto}.record .price{font-weight:650;font-size:20px;margin-top:8px}.record a{font-size:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:430px;overflow:auto;font:12px/1.65 ui-monospace,monospace}details{margin-top:18px}summary{cursor:pointer}.error{color:var(--error-color,#bd362f)}[hidden]{display:none!important}@media(max-width:760px){.travel{padding:16px}.layout{grid-template-columns:1fr}.head{align-items:flex-start}h1{font-size:24px}.tag{font-size:10px}.panel{padding:16px}}
  </style><main class="travel">
    <header class="head"><div><p class="eyebrow muted">TRAVEL WORKSPACE</p><h1>输入地点，查找酒店</h1><p class="muted">按城市、地址或地标查询携程酒店，也可整理图文攻略。</p></div><span class="tag">查询调试版 · 0.2.1</span></header>
    <div class="layout"><aside><form class="panel" id="travel-hotel-form"><h2>按地址找酒店</h2><label for="travel-city">城市</label><input id="travel-city" required maxlength="80" placeholder="例如：杭州"><label for="travel-address">地址 / 商圈 / 地标</label><input id="travel-address" required maxlength="200" placeholder="例如：杭州东站、武林广场"><label for="travel-check-in">入住日期</label><input id="travel-check-in" type="date" required><label for="travel-check-out">离店日期</label><input id="travel-check-out" type="date" required><label for="travel-max-price">展示价上限（元，可选）</label><input id="travel-max-price" type="number" min="1" max="99999" step="0.01" placeholder="例如：300"><div class="row"><button class="primary" id="travel-search" type="submit">查找酒店</button></div><p class="muted" style="margin-top:12px">地址未定位时会标明关键词查询。价格和入住条件以携程详情页为准。</p></form>
    <section class="panel"><h2>打开数据来源</h2><label for="travel-source">来源</label><select id="travel-source"></select><label for="travel-url">网页地址（可选）</label><input id="travel-url" type="url" placeholder="留空使用来源默认入口"><div class="row"><button id="travel-open">在内置浏览器打开</button></div><p class="muted" style="margin-top:12px">需要登录时，在浏览器完成登录后回来采集。</p></section>
    <section class="panel"><h2>采集已有页面</h2><label for="travel-tab">旅游站点标签页</label><select id="travel-tab"></select><div class="row"><button id="travel-refresh">刷新</button><button class="primary" id="travel-collect">采集并清洗</button></div><p class="muted" style="margin-top:12px">只读取支持的旅游网页。每次结果保留来源和采集时间。</p></section></aside>
    <section class="panel"><div class="head" style="margin-bottom:0"><h2>采集结果</h2><span id="travel-status" class="tag">等待采集</span></div><p id="travel-error" class="notice error" role="alert" hidden></p><div id="travel-result" aria-live="polite"><div class="empty muted"><strong>先选择一个旅游网页</strong>酒店列表、图文攻略、登录状态都会返回明确结果。</div></div></section></div></main>`
  const $ = id => root.querySelector(`#travel-${id}`)
  let sources = [], tabs = [], busy = false
  const dateInBeijing = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  $('check-in').min = dateInBeijing(new Date()); $('check-in').value = $('check-in').min
  $('check-out').min = dateInBeijing(new Date(Date.now() + 86400000)); $('check-out').value = $('check-out').min
  function setBusy(value) { busy = value; for (const el of root.querySelectorAll('button,select,input')) el.disabled = value; $('collect').textContent = value ? '处理中…' : '采集并清洗'; $('search').textContent = value ? '处理中…' : '查找酒店' }
  async function action(fn) {
    if (busy || controller.signal.aborted) return
    $('error').hidden = true; setBusy(true)
    try { await fn() } catch (error) { if (!controller.signal.aborted) { $('error').textContent = error.message || String(error); $('error').hidden = false } }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  function option(select, value, text) { const el = document.createElement('option'); el.value = value; el.textContent = text; select.append(el) }
  async function refresh(preferred) {
    const selected = preferred || $('tab').value
    const value = await ctx.rpc.call('list-tabs', {})
    if (controller.signal.aborted) return
    tabs = value.tabs; $('tab').replaceChildren()
    if (!tabs.length) option($('tab'), '', '请先打开一个旅游来源')
    for (const tab of tabs) option($('tab'), tab.id, `${tab.title || tab.source}${tab.loading ? ' · 加载中' : ''}`)
    if (tabs.some(tab => tab.id === selected)) $('tab').value = selected
  }
  function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el }
  function show(result) {
    if (controller.signal.aborted) return
    $('status').textContent = statusNames[result.status] || result.status
    const target = $('result'); target.replaceChildren()
    target.append(node('p', result.message, 'notice'))
    if (result.search) {
      const search = result.search
      target.append(node('p', `${search.city} · ${search.address}｜${search.requested.checkIn} 至 ${search.requested.checkOut}｜${search.locationMode === 'poi' ? '已选择站点地点' : '仅关键词匹配'}${search.guests ? `｜${search.guests}` : ''}`, 'notice'))
    }
    const stats = node('div', undefined, 'stats')
    for (const [number, label] of [[result.records.length, '条已提取记录'], [new Date(result.collectedAt).toLocaleTimeString(), '本次采集时间']]) { const item = node('div'); item.append(node('strong', String(number)), node('span', label, 'muted')); stats.append(item) }
    target.append(stats)
    const sourceLink = node('a', result.pageTitle || '查看原始页面'); sourceLink.href = result.url; sourceLink.target = '_blank'; sourceLink.rel = 'noopener noreferrer'; target.append(sourceLink)
    for (const warning of result.warnings) target.append(node('p', warning, 'notice muted'))
    const records = node('div', undefined, 'records')
    for (const row of result.records) {
      const card = node('article', undefined, 'record'); card.append(node('h3', row.title))
      if (row.price.raw) card.append(node('div', row.price.raw, 'price'))
      if (result.search?.requested.maxPrice !== undefined && (row.price.amountMinor === undefined || !['starting', 'per_night'].includes(row.price.basis))) card.append(node('p', '价格口径不明确，预算待核实', 'muted'))
      if (row.text) card.append(node('p', row.text))
      const a = node('a', '查看来源页面'); a.href = row.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; card.append(a); records.append(card)
    }
    target.append(records)
    for (const [label, value] of [['查看结构化数据', result], ['页面诊断', result.diagnostics]]) { const details = node('details'); details.append(node('summary', label), node('pre', JSON.stringify(value, null, 2))); target.append(details) }
  }
  $('source').addEventListener('change', () => { $('url').value = ''; $('url').placeholder = sources.find(source => source.id === $('source').value)?.home || '' }, { signal: controller.signal })
  $('refresh').addEventListener('click', () => action(() => refresh()), { signal: controller.signal })
  $('open').addEventListener('click', () => action(async () => { const url = $('url').value.trim(); const tab = await ctx.rpc.call('open-page', { source: $('source').value, ...(url ? { url } : {}) }); await refresh(tab.id) }), { signal: controller.signal })
  $('collect').addEventListener('click', () => action(async () => { if (!$('tab').value) throw new Error('请先打开或选择旅游页面'); show(await ctx.rpc.call('collect-page', { tabId: $('tab').value })) }), { signal: controller.signal })
  $('hotel-form').addEventListener('submit', event => {
    event.preventDefault()
    const city = $('city').value.trim(), address = $('address').value.trim(), checkIn = $('check-in').value, checkOut = $('check-out').value, budget = $('max-price').value
    void action(async () => {
      if (!city || !address) throw new Error('请填写城市和地址、商圈或地标')
      if (!checkIn || !checkOut || checkOut <= checkIn) throw new Error('离店日期必须晚于入住日期')
      $('status').textContent = '正在查询'; $('result').replaceChildren(node('p', '正在按地点查询并核对日期，请保持酒店页面可用。', 'notice'))
      const result = await ctx.rpc.call('search-hotels', { city, address, checkIn, checkOut, ...(budget ? { maxPrice: Number(budget) } : {}) })
      show(result); await refresh(result.tabId)
    })
  }, { signal: controller.signal })
  ctx.lifecycle.add(() => { controller.abort(); root.replaceChildren() })
  await action(async () => {
    const [directory, last] = await Promise.all([ctx.rpc.call('list-sources'), ctx.rpc.call('last-result')])
    if (controller.signal.aborted) return
    sources = directory.sources
    for (const source of sources) option($('source'), source.id, source.name)
    await refresh()
    if (last.present) show(last.result)
  })
}
