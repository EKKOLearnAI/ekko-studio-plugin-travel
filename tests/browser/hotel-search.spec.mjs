import { test, expect } from '@playwright/test'
import { apply } from '../../server.mjs'

const day = offset => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offset * 86400000))
const query = () => ({ city: '苏州', address: '苏州站', checkIn: day(1), checkOut: day(2), maxPrice: 300 })

// Deliberate synthetic site fixture with observed form attributes. It models
// suggestion selection, query navigation and React-style trusted input events.
function hotelFixture(url, { ambiguous = false, keywordOnly = false, blocked = false, narrow = false, destinationAlias = false, splitHighlights = false, stagedNavigation = false } = {}) {
  const params = new URL(url).searchParams
  const settings = { city: params.get('cityName') || params.get('destName') || '杭州', address: params.get('searchWord') || '',
    checkIn: params.get('checkin'), checkOut: params.get('checkout'), ambiguous, keywordOnly, destinationAlias, splitHighlights, stagedNavigation }
  return `<!doctype html><meta charset="utf-8"><title>合成酒店查询页</title>
    <style>body{margin:20px}header{display:flex;gap:20px;align-items:center}section{position:relative}input{width:130px;height:35px}#suggestions{position:absolute;z-index:3;top:65px;left:0;background:white}#suggestions div{padding:12px;min-width:140px;border:1px solid #ccc;cursor:pointer}article{margin-top:30px}</style>
    ${narrow ? '<style>header{flex-direction:column;align-items:stretch;width:400px}header>section{margin-bottom:35px}</style>' : ''}
    <nav><button aria-label="搜索">全站搜索</button></nav><header><section><label>目的地<input placeholder="目的地"></label><div id="suggestions"></div></section>
    <section><label>位置<input placeholder="位置/品牌/酒店 (选填)"></label><div id="places"></div></section>
    <input id="checkInInput"><input id="checkOutInput"><button>1间, 2成人, 0儿童</button><button id="submit" aria-label="搜索">&#xe601;搜索</button></header>
    <div id="hotels"></div>${blocked ? '<p>请完成安全验证</p>' : ''}<script>
    const settings=${JSON.stringify(settings)}, city=document.querySelector('input[placeholder="目的地"]'), address=document.querySelector('input[placeholder^="位置"]');
    let selectedCity=settings.city, selectedAddress=false;
    city.value=settings.city;address.value=settings.address;
    document.querySelector('#checkInInput').value=settings.checkIn;document.querySelector('#checkOutInput').value=settings.checkOut;
    function suggest(input, container, isCity) {
      let previous=input.value;
      container.style.cssText='position:absolute;z-index:3;top:65px;left:0;background:white';
      input.addEventListener('input',event=>{
        if (!event.isTrusted) return;
        if (input.value===previous) return; previous=input.value;
        container.replaceChildren();
        if (!input.value) return;
        if(!isCity&&settings.keywordOnly)return;
        for(let n=0;n<(isCity&&settings.ambiguous?2:1);n++){
          const option=document.createElement('div'); option.textContent=input.value;option.style.cssText='padding:12px;min-width:140px;border:1px solid #ccc;cursor:pointer';
          option.addEventListener('click',()=>{if(isCity)selectedCity=input.value;else selectedAddress=true;container.replaceChildren()});container.append(option);
        }
        if(settings.splitHighlights){
          const other=document.createElement('div'),title=document.createElement('div'),highlight=document.createElement('span'),description=document.createElement('div'),subHighlight=document.createElement('span');
          highlight.textContent=input.value;title.append(highlight,document.createTextNode('其他地标'));
          subHighlight.textContent=input.value;description.append(document.createTextNode('中国-浙江-'),subHighlight);other.append(title,description);container.append(other);
        }
      });
    }
    suggest(city,document.querySelector('#suggestions'),true);suggest(address,document.querySelector('#places'),false);
    document.querySelector('#submit').addEventListener('click',()=>{
      const next=new URL('https://hotels.ctrip.com/hotels/list/');
      next.searchParams.set('cityName',settings.destinationAlias?'':selectedCity);next.searchParams.set('destName',selectedCity);next.searchParams.set('cityId','14');
      next.searchParams.set('checkin',settings.checkIn);next.searchParams.set('checkout',settings.checkOut);
      next.searchParams.set('curr','CNY');
      if(address.value){next.searchParams.set('searchWord',address.value);next.searchParams.set('searchType',selectedAddress?'T':'CT');if(selectedAddress)next.searchParams.set('optionId','123');else next.searchParams.set('directSearch','1')}
      if(settings.stagedNavigation){history.pushState({},'',next.href);setTimeout(()=>location.reload(),300)}else location.href=next.href;
    });
    if(settings.address) for(const [name,price] of [['站前酒店','￥299起'],['超预算酒店','￥499起'],['未知报价酒店','暂无报价'],['条件报价酒店','会员券后￥199']]){
      const article=document.createElement('article');article.className='hotel-card';
      const title=document.createElement('h2');title.className='hotel-name';title.textContent=name;
      const amount=document.createElement('span');amount.className='sale-price';amount.textContent=price;article.append(title,amount);document.querySelector('#hotels').append(article)
    }
    </script>`
}
async function runtime(context, options = {}) {
  await context.route('https://hotels.ctrip.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: hotelFixture(route.request().url(), options) }))
  const methods = new Map(), tools = new Map(), storage = new Map(), calls = [], tabs = new Map()
  let session, hotelPage, captured = false
  const controller = new AbortController()
  const browser = { tabs: {
    list: async () => ({ tabs: [...tabs].map(([id, page]) => ({ id, title: '合成酒店页', url: page.url(), loading: false })) }),
    create: async url => { hotelPage = await context.newPage(); await hotelPage.goto(url); tabs.set('hotel-tab', hotelPage); session = await context.newCDPSession(hotelPage); return { id: 'hotel-tab', title: '合成酒店页', url: hotelPage.url(), loading: false } },
  }, cdp: {
    attach: async () => { calls.push('attach'); return { cursor: 0, sessions: [] } },
    release: async () => { calls.push('release'); return { ok: true } },
    send: async (_id, method, params) => {
      calls.push(method)
      const response = await session.send(method, params)
      if (method === 'Runtime.evaluate' && params.expression.includes('function captureDocument')) {
        captured = true
        if (options.changeDuringCapture) await hotelPage.evaluate(() => { document.querySelector('input[placeholder^="位置"]').value = '另一个地点' })
      }
      return response
    },
  } }
  const run = { identity: { userId: 7, profile: 'travel-test' }, signal: controller.signal, host: { browser }, state: { profile: { get: async key => storage.get(key), set: async (key, value) => storage.set(key, value) } } }
  apply({ extensions: { rpc: { register: (name, handler) => methods.set(name, handler) }, tools: { register: tool => tools.set(tool.name, tool) } } })
  return { call: (name, input) => methods.get(name)(input, run), tool: (name, input) => tools.get(name).execute(input, run), calls, storage, controller, get hotelPage() { return hotelPage }, get captured() { return captured } }
}

test('hotel MCP executes the real fixed CDP flow, verifies conditions and marks uncertain budget records', async ({ context }) => {
  const host = await runtime(context)
  const request = query()
  const response = await host.tool('search_hotels', request)
  expect(response.ok).toBe(true)
  const result = JSON.parse(response.content)
  expect(result).toEqual(response.data)
  expect(result.status).toBe('partial')
  expect(result.records).toHaveLength(3)
  expect(host.storage.get('last-collection-v1')).toEqual(result)
  expect(result.search).toMatchObject({ requested: request, conditionsVerified: true, locationMode: 'poi', budgetExcluded: 1, budgetUnverified: 2 })
  expect(new URL(host.hotelPage.url()).searchParams.get('cityName')).toBe('苏州')
  expect(result.url).toContain('searchWord=')
  expect(host.calls.filter(method => method === 'Input.insertText')).toHaveLength(2)
  expect(host.calls.at(-1)).toBe('release')
})

test('an unresolved address remains an explicit keyword query with no distance guarantee', async ({ context }) => {
  const host = await runtime(context, { keywordOnly: true })
  const result = await host.call('search-hotels', query())
  expect(result.search.locationMode).toBe('keyword')
  expect(result.warnings).toContain('地址仅作为关键词查询，未完成坐标定位，不能保证附近半径或距离排序。')
})

test('a wrapped form resolves complete titles and waits for the destination document after history changes', async ({ context }) => {
  const host = await runtime(context, { narrow: true, destinationAlias: true, splitHighlights: true, stagedNavigation: true })
  const result = await host.call('search-hotels', query())
  expect(result.search.conditionsVerified).toBe(true)
  expect(result.search.locationMode).toBe('poi')
  expect(result.search.guests).toContain('2成人')
  expect(host.calls.at(-1)).toBe('release')
})

test('searching the already-selected city refreshes controlled input suggestions', async ({ context }) => {
  const host = await runtime(context)
  const result = await host.call('search-hotels', { ...query(), city: '杭州', address: '杭州东站' })
  expect(result.search.city).toBe('杭州')
  expect(result.search.address).toBe('杭州东站')
  expect(host.calls).toContain('Input.dispatchKeyEvent')
})

test('ambiguous city suggestions do not silently pick a place or persist hotel results', async ({ context }) => {
  const host = await runtime(context, { ambiguous: true })
  await expect(host.call('search-hotels', query())).rejects.toThrow('多个同名匹配')
  expect(host.storage.size).toBe(0)
  expect(host.captured).toBe(false)
  expect(host.calls.at(-1)).toBe('release')
})

test('a location changed during collection discards results instead of saving the wrong hotel query', async ({ context }) => {
  const host = await runtime(context, { changeDuringCapture: true })
  await expect(host.call('search-hotels', query())).rejects.toThrow('条件发生变化')
  expect(host.storage.size).toBe(0)
  expect(host.calls.at(-1)).toBe('release')
})

test('cancellation before hotel search opens no browser and stores no result', async ({ context }) => {
  const host = await runtime(context)
  host.controller.abort()
  await expect(host.call('search-hotels', query())).rejects.toThrow()
  expect(host.calls).toEqual([])
  expect(host.hotelPage).toBeUndefined()
  expect(host.storage.size).toBe(0)
})

test('cancellation during a pending address lookup releases control and preserves storage', async ({ context }) => {
  const host = await runtime(context, { keywordOnly: true })
  const pending = host.call('search-hotels', query())
  const rejected = expect(pending).rejects.toThrow()
  await expect.poll(() => host.calls.filter(method => method === 'Input.insertText').length).toBe(2)
  host.controller.abort()
  await rejected
  expect(host.storage.size).toBe(0)
  expect(host.calls.at(-1)).toBe('release')
})

test('site verification stops hotel search before any typing or persistence', async ({ context }) => {
  const host = await runtime(context, { blocked: true })
  await expect(host.call('search-hotels', query())).rejects.toThrow('安全验证')
  expect(host.calls).not.toContain('Input.insertText')
  expect(host.storage.size).toBe(0)
  expect(host.calls.at(-1)).toBe('release')
})
