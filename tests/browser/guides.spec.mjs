import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { captureGuidePage, GUIDE_CONFIG } from '../../src/guide-page.mjs'
import { normalizeGuide, runGuide } from '../../src/guides.mjs'
import { recognizeGuideImage } from '../../src/guide-ocr.mjs'
import { validateModel } from '../../sdk/harness/contracts.mjs'
const contract=JSON.parse(readFileSync(new URL('../../contracts/plugin.json',import.meta.url)))
const prose='第一天沿西湖步行到断桥，午后游览博物馆。第二天乘坐公交前往山脚，按现场开放时间安排行程。'.repeat(6)
async function pageAt(page,url,body){await page.route('https://**/*',r=>r.request().resourceType()==='document'?r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8">'+body}):r.abort());await page.goto(url)}
async function capture(page,source){return validateModel(contract,'guide-snapshot',await page.evaluate(captureGuidePage,GUIDE_CONFIG[source]))}
function runtime(page,context,models={}){const calls=[],storage=new Map([['last-guide-v1',{previous:true}]]),controller=new AbortController();let session;const run={signal:controller.signal,state:{profile:{set:async(k,v)=>storage.set(k,v)}},host:{models,browser:{tabs:{list:async()=>({tabs:[{id:'t',url:page.url()}]})},cdp:{attach:async()=>{calls.push('attach');session=await context.newCDPSession(page)},send:async(_id,m,p)=>{calls.push(m);return session.send(m,p)},release:async()=>{calls.push('release');await session?.detach()}}}}};return {run,calls,storage,controller}}
for(const [source,path,selector] of [['ctrip-guide','https://you.ctrip.com/travels/hangzhou14/123.html','travel-content-wrapper'],['mafengwo','https://www.mafengwo.cn/i/123.html','vc_article'],['xiaohongshu','https://www.xiaohongshu.com/explore/abc123','desc']]){
 test(`${source}: original layout, renamed CSS semantic fallback, hidden/comment isolation`,async({page})=>{
  await pageAt(page,path,`<title>杭州两日游</title><article id="noteContainer"><h1>杭州两日游</h1><div class="${selector}"><p>${prose}</p><p hidden>隐藏私密状态</p><div class="comment-list">评论日期 2020-01-01</div></div><time datetime="2026-11-01">2026-11-01</time></article><footer>网站导航</footer>`)
  const original=await capture(page,source);expect(original.article.method).toBe('site_dom');expect(original.article.text).not.toContain('私密');expect(original.article.text).not.toContain('评论')
  await page.evaluate(()=>{for(const e of document.querySelectorAll('[class]'))if(!e.classList.contains('comment-list'))e.className='redesign-2027'})
  const changed=await capture(page,source);expect(changed.article.method).toBe('semantic_dom');expect(changed.article.text).toContain('第一天');expect(changed.article.text).not.toContain('网站导航');expect(changed.article.text).not.toContain('评论日期')
 })
}
test('date JSON-LD metadata must match heading; edited month-day never becomes publication date',async({page})=>{
 await pageAt(page,'https://www.xiaohongshu.com/explore/abc123',`<title>杭州两日游</title><div id="noteContainer"><h1>杭州两日游</h1><div class="note-content"><p class="desc">${prose}</p><span class="date">编辑于 08-30</span></div></div><script type="application/ld+json">{"headline":"广告标题","datePublished":"2020-01-01","articleBody":"隐藏正文"}</script>`)
 const s=await capture(page,'xiaohongshu'),r=normalizeGuide(s,'xiaohongshu','t');expect(r.records[0].published.evidence).toBe('unknown');expect(r.records[0].modified.raw).toBe('编辑于 08-30');expect(r.records[0].modified.date).toBeUndefined();expect(r.records[0].text).not.toContain('隐藏正文')
})
test('search survives renamed cards, preserves token only for browser navigation, excludes foreign links',async({page,context})=>{
 await pageAt(page,'https://www.xiaohongshu.com/search_result?keyword=杭州',`<title>搜索</title><input id="search-input" value="杭州"><div class="changed"><a href="/search_result/abc123?xsec_token=private-navigation-token">杭州两日游</a><a href="https://evil.test/explore/abc123">冒牌攻略</a></div>`)
 const s=await capture(page,'xiaohongshu'),r=normalizeGuide(s,'xiaohongshu','t','杭州');expect(r.records).toHaveLength(1);expect(JSON.stringify(r)).not.toContain('private-navigation-token')
 const host=runtime(page,context);await page.unroute('https://**/*');let navigated='';await page.route('https://**/*',route=>{navigated=route.request().url();return route.fulfill({contentType:'text/html; charset=utf-8',body:`<title>杭州两日游</title><article><h1>杭州两日游</h1><p>${prose}</p></article>`})})
 const output=await runGuide('read_guide',{tabId:'t',url:r.records[0].url},host.run,contract,{pollMs:50});expect(output.status).toBe('partial');expect(navigated).toContain('private-navigation-token');expect(JSON.stringify(output)).not.toContain('private-navigation-token');expect(host.calls.at(-1)).toBe('release')
})
test('Ctrip no-href cards provide explicit browser handoff rather than guessed IDs',async({page})=>{
 await pageAt(page,'https://you.ctrip.com/globalsearch/?keyword=杭州',`<title>搜索</title><div class="travel-list-container"><span class="travel-list-header-title-main">目的地</span><div><a class="guide-main-item"><p class="title">杭州</p><p>Hangzhou</p></a></div></div><div class="travel-list-container"><span class="travel-list-header-title-main">住宿</span><a class="guide-main-item"><p class="title">杭州酒店</p></a></div>`)
 const r=normalizeGuide(await capture(page,'ctrip-guide'),'ctrip-guide','t','杭州');expect(r.records).toHaveLength(1);expect(r.records[0]).toMatchObject({selectionTitle:'杭州',url:''});expect(r.nextAction).toContain('不要猜测')
})
test('login overlay wins over existing article, persistent failure preserves last good result',async({page,context})=>{
 await pageAt(page,'https://www.mafengwo.cn/i/123.html',`<title>杭州攻略</title><article><h1>杭州攻略</h1><p>${prose}</p></article><div role="dialog">扫码登录后查看</div>`)
 const h=runtime(page,context),r=await runGuide('read_guide',{tabId:'t'},h.run,contract,{attempts:1});expect(r.status).toBe('login_required');expect(r.records).toEqual([]);expect(h.storage.get('last-guide-v1')).toEqual({previous:true});expect(h.calls.at(-1)).toBe('release')
})
test('unknown article layout does not turn recommendations or comment empty into a successful article',async({page,context})=>{
 await pageAt(page,'https://www.mafengwo.cn/i/123.html',`<title>杭州攻略</title><h1>杭州攻略</h1><div>${prose}</div><div>暂无相关内容</div>`)
 const h=runtime(page,context),r=await runGuide('read_guide',{tabId:'t'},h.run,contract,{attempts:1});expect(r.status).toBe('layout_changed');expect(r.records).toEqual([]);expect(h.storage.get('last-guide-v1')).toEqual({previous:true})
})
test('OCR crops only visible content image, passes no tools, and labels model text separately',async({page,context})=>{
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="400" height="250"><rect width="400" height="250" fill="white"/><text x="30" y="100" font-size="36">DAY 1 WEST LAKE</text></svg>'
 await page.route('https://www.mafengwo.cn/**',r=>r.request().resourceType()==='image'?r.fulfill({contentType:'image/svg+xml',body:svg}):r.fulfill({contentType:'text/html; charset=utf-8',body:`<title>杭州攻略</title><article><h1>杭州攻略</h1><div class="vc_article"><img src="/guide.svg" width="400" height="250"><p>${prose}</p></div></article>`}));await page.goto('https://www.mafengwo.cn/i/123.html')
 const requests=[],models={list:async()=>({data:[{id:'fixture/vision',responses_supported:true}]}),respond:async r=>{requests.push(r);return {status:'completed',output:[{type:'message',content:[{type:'output_text',text:'DAY 1 WEST LAKE'}]}]}}},h=runtime(page,context,models)
 const needs=await recognizeGuideImage({tabId:'t',imageIndex:0},h.run,contract);expect(needs.status).toBe('needs_model');expect(requests).toHaveLength(0)
 const r=await recognizeGuideImage({tabId:'t',imageIndex:0,model:'fixture/vision'},h.run,contract);expect(r.status).toBe('ok');expect(r.provenance).toBe('image_ocr');expect(r.text).toBe('DAY 1 WEST LAKE');expect(requests[0].input[0].content[1].image_url).toMatch(/^data:image\/jpeg;base64,/);expect(requests[0].tools).toBeUndefined();expect(requests[0].store).toBe(false);expect(JSON.stringify(r)).not.toContain('base64');expect(h.calls.at(-1)).toBe('release')
 await page.evaluate(()=>{const e=document.createElement('div');e.style='position:fixed;inset:0;background:white;z-index:999';document.body.append(e)})
 const hidden=await recognizeGuideImage({tabId:'t',imageIndex:0,model:'fixture/vision'},h.run,contract);expect(hidden.status).toBe('image_not_visible');expect(requests).toHaveLength(1)
})
test('Mafengwo redirects to passport are login failures, not loading; query IDs select the correct card',async({page,context})=>{
 await pageAt(page,'https://www.mafengwo.cn/search/q.php?q=杭州',`<title>搜索</title><a href="https://m.mafengwo.cn/nb/public/sharejump.php?type=7&id=111">杭州第一条游记</a><a href="https://m.mafengwo.cn/nb/public/sharejump.php?type=7&id=222">杭州第二条游记</a>`)
 const s=await capture(page,'mafengwo');expect(s.rows).toHaveLength(2)
 const h=runtime(page,context);await page.unroute('https://**/*');let selected='';await page.route('https://**/*',route=>{
  const url=route.request().url()
  if(url.includes('sharejump.php')){selected=url;return route.fulfill({status:302,headers:{location:'https://passport.mafengwo.cn/'}})}
  return route.fulfill({contentType:'text/html; charset=utf-8',body:'<title>账号登录 - 马蜂窝</title><h1>扫码登录</h1>'})
 })
 const r=await runGuide('read_guide',{tabId:'t',url:s.rows[1].url},h.run,contract,{pollMs:50});expect(selected).toContain('id=222');expect(r.status).toBe('login_required');expect(h.storage.get('last-guide-v1')).toEqual({previous:true});expect(h.calls.at(-1)).toBe('release')
})
test('Mafengwo itinerary excludes map and unrelated suggestions; Ctrip attraction selects introduction',async({page})=>{
 await pageAt(page,'https://www.mafengwo.cn/mdd/route/10156_110560.html',`<title>杭州三日游</title><h1>杭州三日游</h1><div class="map">其他地图内容</div><div class="day-list"><h3>D1 游玩攻略</h3><p>${prose}</p><h3>D2 交通攻略</h3><p>${prose}</p></div><aside>其他线路</aside>`)
 let s=await capture(page,'mafengwo');expect(s.article.method).toBe('site_dom');expect(s.article.text).toContain('D2');expect(s.article.text).not.toContain('地图');expect(s.article.text).not.toContain('其他线路')
 await page.unroute('https://**/*');await pageAt(page,'https://you.ctrip.com/sight/hangzhou14/49894.html',`<title>西湖风景名胜区</title><h1>西湖风景名胜区</h1><div class="detailModule"><div class="moduleTitle">介绍</div><div class="moduleContent"><p>${prose}</p></div></div><div class="commentDetail">顾客评论不属于景点介绍</div>`)
 s=await capture(page,'ctrip-guide');expect(s.detailKind).toBe('attraction');expect(s.article.method).toBe('site_dom');expect(s.article.text).not.toContain('顾客评论')
})
test('Mafengwo mobile guide selects active article rather than adjacent carousel chapters',async({page})=>{
 await pageAt(page,'https://m.mafengwo.cn/mmobile/wanfaguide/?gid=123&aggregate_id=456',`<title>杭城美食篇</title><div class="swiper-slide"><div class="guide"><div class="title">另一篇攻略</div><div class="guide-html">${prose.repeat(2)}</div></div></div><div class="swiper-slide swiper-slide-active"><div class="guide"><div class="title">杭州美食一天</div><div class="guide-html">${prose}</div></div></div>`)
 const s=await capture(page,'mafengwo');expect(s.article.title).toBe('杭州美食一天');expect(s.article.method).toBe('site_dom');expect(s.article.text).toBe(prose)
})
test('unrelated article recommendations cannot substitute for missing original body',async({page})=>{
 await pageAt(page,'https://www.mafengwo.cn/i/123.html',`<title>杭州攻略原文</title><h1>杭州攻略原文</h1><div>原文暂不可见</div><article><h2>推荐别处旅游</h2><p>${prose}</p></article>`)
 const r=normalizeGuide(await capture(page,'mafengwo'),'mafengwo','t');expect(r.status).toBe('layout_changed');expect(r.records).toEqual([])
})
test('late content images are awaited and never silently interpreted as no images',async({page,context})=>{
 await page.route('https://www.mafengwo.cn/**',r=>r.request().resourceType()==='image'?r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="250"><rect width="400" height="250" fill="white"/></svg>'}):r.fulfill({contentType:'text/html; charset=utf-8',body:`<title>杭州攻略</title><article><h1>杭州攻略</h1><div class="vc_article"><img width="400" height="250"><p>${prose}</p></div></article>`}));await page.goto('https://www.mafengwo.cn/i/123.html')
 await page.evaluate(()=>setTimeout(()=>document.querySelector('img').src='/late.svg',300))
 const h=runtime(page,context),r=await runGuide('read_guide',{tabId:'t'},h.run,contract,{pollMs:80})
 expect(r.status).toBe('partial');expect(r.records[0].images).toHaveLength(1);expect(h.calls.filter(x=>x==='Runtime.evaluate').length).toBeGreaterThan(1)
 await page.evaluate(()=>document.querySelector('img').removeAttribute('src'))
 const failed=await runGuide('read_guide',{tabId:'t'},h.run,contract,{attempts:1});expect(failed.warnings.join(' ')).toContain('不能当作没有图片')
})
