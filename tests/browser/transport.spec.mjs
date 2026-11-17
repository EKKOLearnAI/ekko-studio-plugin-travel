import { test, expect } from '@playwright/test'
import { apply } from '../../server.mjs'
const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 3 * 86400000))
const query = mode => ({ from: '上海', to: mode === 'train' ? '杭州' : '北京', departureDate: day() })
// Synthetic pages model the inspected public DOM, never captured account data.
function trainFixture(url, options) {
  const p = new URL(url).searchParams
  const card = code => `<div class="list-item"><span class="checi">${code}</span><div class="from"><b class="time">08:00</b><b class="station">上海虹桥</b></div><div class="to"><b class="time">09:00</b><b class="station">杭州东</b></div><span class="haoshi">1时</span><span class="price">57</span><ul class="surplus-list"><li>二等座(抢)</li><li>一等座2张</li></ul></div><style>.price:before{content:'¥'}</style><div class="list-open"><ul class="list-seat-select"><li><b class="seat-type">二等座</b><b class="price">57</b><button>抢票</button></li><li><b class="seat-type">一等座</b><b class="price">91</b><button>预订</button></li></ul></div>`
  return `<!doctype html><meta charset="utf-8"><title>合成列车页</title><input id="label-departStation" value="${p.get('dStation')}"><input id="label-arriveStation" value="${p.get('aStation')}"><h2>${p.get('dStation')}-${p.get('aStation')} 单程 ${p.get('dDate')}</h2>${options.blocked ? '<p>请完成安全验证</p>' : options.presale ? '<p>该日期超出预售期</p>' : `<section role="product">${card('G100')}${card('K100')}</section>`}`
}
function flightFixture(url) {
  const u = new URL(url), result = u.pathname.includes('/list/'), [from, to] = result ? u.pathname.split('oneway-')[1].split('-').map(s => s.toUpperCase()) : ['XMN', 'CAN']
  const names = { SHA: '上海', BJS: '北京', XMN: '厦门', CAN: '广州' }
  const card = (code, number, tags = '', legs = 1) => `<div class="flight-item domestic"><div class="flight-airline"><b class="airline-name">合成航空</b><div class="plane" data-codes="${code}" data-legs="${legs}"></div></div><div class="depart-box"><b class="time">08:00</b><span class="airport">浦东国际机场T1</span></div><div class="arrow-box">${legs > 1 ? '通程泉州 5h10m' : ''}</div><div class="arrive-box"><b class="time">10:00<span class="day"> </span></b><span class="airport">大兴国际机场</span></div><div class="flight-operate"><div class="flight-price"><span class="price"><dfn>¥</dfn>${number}</span><span class="qi">起</span></div><div class="sub-price-detail">经济舱</div></div><div class="flight-tags">${tags}</div><button onclick="window.bookingClicked=true">订票</button></div>`
  return `<!doctype html><meta charset="utf-8"><title>合成机票页</title><style>.flight-item{height:700px}.modify-search-v3{padding:20px}input{height:30px}.address,li{padding:12px}</style><div class="modify-search-v3"><div class="search-form"><input name="owDCity" value="${names[from]}(${from})"><input name="owACity" value="${names[to]}(${to})"><div id="suggestions"></div><div class="depart-date"><input value="${u.searchParams.get('depdate') || day()}"></div><div class="form-select-v3">${u.searchParams.get('cabin') === 'y_s_c_f' ? '不限舱等' : '经济舱'}</div><ul class="form-select-radio-group"><li class="active">单程</li></ul></div></div>${result ? `<div class="root-flights">${card('KN1000', 427, '<b class="tag">已减¥103</b><b class="tag">普通会员可享</b>')}${card('CA1000/MU1000', 490, '<b class="tag">景点玩乐95折立减券</b>')}${card('MF1000/MF1001', 370, '', 2)}</div>` : ''}<script>
    const target=document.querySelector('#suggestions');
    for (const input of document.querySelectorAll('input[name]')) input.addEventListener('input', event=>{
      if(!event.isTrusted)return;target.replaceChildren();const name=input.value;if(!name)return;
      const code=({上海:'SHA',北京:'BJS'})[name];if(!code)return;
      target.innerHTML='<li data-u_key="poi_select_item"><span class="city">'+name+'某机场</span></li><div data-u_key="poi_select_item" class="address"><span class="code city">'+name+'</span><span>所有机场</span><span>'+code+'</span></div>';
      target.firstChild.onclick=()=>{input.value=name+'某机场(XXX)';target.replaceChildren()};
      target.lastChild.onclick=()=>{input.value=name+'('+code+')';target.replaceChildren()};
    });
    const observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){const el=e.target;const plane=el.querySelector('.plane');if(plane&&!plane.children.length){if(plane.dataset.legs==='2')plane.innerHTML=plane.dataset.codes.split('/').map(c=>'<b class="plane-No">'+c+'</b>').join('');else plane.innerHTML='<b class="plane-No">'+plane.dataset.codes+'</b>'}}});
    document.querySelectorAll('.flight-item').forEach(e=>observer.observe(e));
    </script>`
}
async function runtime(context, options = {}) {
  await context.route('https://trains.ctrip.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: trainFixture(route.request().url(), options) }))
  await context.route('https://flights.ctrip.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: flightFixture(route.request().url()) }))
  const rpc = new Map(), tools = new Map(), storage = new Map(), calls = [], pages = new Map(), sessions = new Map(), controller = new AbortController()
  let lastPage, changed = false, captures = 0
  const browser = { tabs: {
    create: async url => { const p = await context.newPage(); await p.goto(url); const id = `tab-${pages.size}`; pages.set(id, p); sessions.set(id, await context.newCDPSession(p)); lastPage = p; return { id, title: await p.title(), url: p.url(), loading: false } },
    list: async () => ({ tabs: [...pages].map(([id, p]) => ({ id, title: '合成交通页', url: p.url(), loading: false })) }),
  }, cdp: {
    attach: async () => { calls.push('attach'); return { cursor: 0, sessions: [] } },
    release: async () => { calls.push('release'); return { ok: true } },
    send: async (id, method, params) => {
      calls.push(method); const r = await sessions.get(id).send(method, params)
      if (method === 'Runtime.evaluate' && params.expression.startsWith('(function captureTransportPage') && r.result?.value?.rows.length) captures++
      if (options.changeDuringCapture && !changed && captures === 3) { changed = true; await pages.get(id).evaluate(() => document.querySelector('#label-arriveStation').value = '其他站') }
      if (options.abortDuringCapture && method === 'Runtime.evaluate' && params.expression.startsWith('(function captureTransportPage') && r.result?.value?.rows.length) controller.abort()
      return r
    },
  } }
  const run = { identity: { userId: 1, profile: 'test' }, signal: controller.signal, host: { browser }, state: { profile: { get: async k => storage.get(k), set: async (k, v) => storage.set(k, v) } } }
  apply({ extensions: { rpc: { register: (name, handler) => rpc.set(name, handler) }, tools: { register: tool => tools.set(tool.name, tool) } } })
  return { call: (name, input = null) => rpc.get(name)(input, run), tool: (name, input) => tools.get(name).execute(input, run), storage, calls, controller, get page() { return lastPage } }
}
test('train MCP executes fixed CDP query, filters G/D/C and preserves distinct seat prices and no-stock state', async ({ context }) => {
  const host = await runtime(context), result = await host.tool('search_trains', query('train'))
  expect(result.ok).toBe(true);expect(JSON.parse(result.content)).toEqual(result.data)
  expect(result.data).toMatchObject({ conditionsVerified: true, loadedCount: 2, matchedCount: 1 })
  expect(result.data.records).toHaveLength(1)
  expect(result.data.records[0].seats).toMatchObject([{ availability: 'unavailable', price: { amountMinor: 5700 } }, { availability: 'available', remaining: 2, price: { amountMinor: 9100 } }])
  expect(host.storage.get('last-transport-v1')).toEqual(result.data)
  expect(host.storage.has('last-collection-v1')).toBe(false)
  expect(host.calls.at(-1)).toBe('release')
})
test('flight MCP selects aggregate cities, lazy-loads flight numbers, avoids discount prices and excludes connections', async ({ context }) => {
  const host = await runtime(context)
  const response = await host.tool('search_flights', query('flight'))
  expect(response.ok).toBe(true)
  const r = JSON.parse(response.content)
  expect(r).toEqual(response.data)
  expect(r.records).toHaveLength(2)
  expect(r.records.every(record => record.feeInclusion === 'unknown')).toBe(true)
  expect(host.storage.get('last-transport-v1')).toEqual(r)
  expect(r.conditionsVerified).toBe(true);expect(r.records[0].price).toMatchObject({ amountMinor: 42700, basis: 'conditional' })
  expect(r.records[1].price).toMatchObject({ amountMinor: 49000, basis: 'starting' })
  expect(r.records[1].serviceCodes).toEqual(['CA1000', 'MU1000'])
  expect(new URL(host.page.url()).pathname).toBe('/online/list/oneway-sha-bjs')
  expect(await host.page.evaluate(() => window.bookingClicked)).toBeUndefined()
})
test('flight all-cabin connections retain each leg and never use layover as total duration', async ({ context }) => {
  const host = await runtime(context), r = await host.call('search-flights', { ...query('flight'), cabin: 'all', directOnly: false })
  expect(r.records).toHaveLength(3)
  expect(r.observed.cabin).toBe('不限舱等')
  expect(r.records[2]).toMatchObject({ connectionType: 'connection', serviceCodes: ['MF1000', 'MF1001'], durationText: '' })
  expect(new URL(host.page.url()).searchParams.get('cabin')).toBe('y_s_c_f')
})
test('blocked and presale pages have explicit states and do not overwrite successful storage', async ({ context }) => {
  const blocked = await runtime(context, { blocked: true }), result = await blocked.tool('search_trains', query('train'))
  expect(result.ok).toBe(false);expect(result.data.status).toBe('verification_required');expect(blocked.storage.size).toBe(0)
  expect(blocked.calls.at(-1)).toBe('release')
})
test('presale state returns without fabricated records', async ({ context }) => {
  const host = await runtime(context, { presale: true }), r = await host.call('search-trains', query('train'))
  expect(r.status).toBe('not_on_sale');expect(r.records).toEqual([]);expect(host.storage.size).toBe(0)
})
test('abort during search releases the lease and never saves data', async ({ context }) => {
  const host = await runtime(context, { abortDuringCapture: true })
  await expect(host.call('search-trains', query('train'))).rejects.toThrow()
  expect(host.calls.at(-1)).toBe('release');expect(host.storage.size).toBe(0)
})
test('conditions changed after a stable capture discard results and preserve prior storage', async ({ context }) => {
  const host = await runtime(context, { changeDuringCapture: true })
  await expect(host.call('search-trains', query('train'))).rejects.toThrow('采集期间')
  expect(host.storage.size).toBe(0);expect(host.calls.at(-1)).toBe('release')
})
test('traffic dates fail concretely before opening tabs, and generic collection directs traffic to query tools', async ({ context }) => {
  const host = await runtime(context)
  const r = await host.tool('search_trains', { ...query('train'), departureDate: '2020-01-01' })
  expect(r.ok).toBe(false);expect(r.content).toContain('不能早于今天');expect(host.calls).toEqual([])
  const valid = await host.call('search-trains', query('train'))
  await expect(host.call('collect-page', { tabId: valid.tabId })).rejects.toThrow('search_trains / search_flights')
})
