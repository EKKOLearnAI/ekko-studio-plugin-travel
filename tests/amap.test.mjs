import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, stat, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../server.mjs'
import { registerAmapTools } from '../src/amap.mjs'
import { AMAP_KEY_RECORD } from '../src/amap-key.mjs'
const contract = JSON.parse(readFileSync(new URL('../contracts/plugin.json', import.meta.url), 'utf8'))
const KEY = 'a'.repeat(32), OTHER_KEY = 'b'.repeat(32)
const point = (location = '116.397499,39.908722') => ({ location, coordinateSystem: 'gcj02' })
const routeInput = (mode = 'driving') => ({ mode, origin: point(), destination: point('116.410000,39.920000') })
const regeo = () => ({ status: '1', infocode: '10000', regeocode: { formatted_address: '北京市东城区测试地址', addressComponent: { province: '北京市', city: [], citycode: '010', district: '东城区', adcode: '110101', township: [], streetNumber: { street: '测试路', number: '1号' } } } })
const path = () => ({ status: '1', count: '1', route: { paths: [{ distance: '1200', cost: { duration: '600', tolls: '0' }, steps: [{ instruction: '沿测试路向东行驶', road_name: '测试路', step_distance: '1200', cost: { duration: '600' }, navi: { action: '直行' } }] }] } })
const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
async function setup(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'travel-amap-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const stores = new Map(), calls = [], tools = new Map()
  let responder = url => url.pathname.endsWith('/regeo') ? regeo() : path()
  const fetchImpl = async (url, init) => {
    calls.push({ url: new URL(url), init })
    assert.equal(url.origin, 'https://restapi.amap.com'); assert.equal(init.redirect, 'error')
    const response = await responder(new URL(url), init)
    return response instanceof Response ? response : json(response)
  }
  const context = (userId = 1, profile = 'default', signal = new AbortController().signal) => {
    const id = JSON.stringify([userId, profile]); if (!stores.has(id)) stores.set(id, new Map())
    const store = stores.get(id)
    return { identity: { userId, profile }, signal, state: { profile: { get: async key => store.get(key), set: async (key, value) => store.set(key, value), delete: async key => store.delete(key) } } }
  }
  const ctx = { paths: { dataDir: dir }, extensions: { tools: { register: tool => tools.set(tool.name, tool) } } }
  const reload = () => registerAmapTools(ctx, contract, { fetchImpl, ...options })
  reload()
  const call = (name, input, run = context()) => tools.get(name).execute(input, run)
  const save = async (key = KEY, run = context()) => {
    const result = await call('configure_amap', { action: 'save', key }, run)
    assert.equal(result.ok, true, result.content); assert.equal(result.data.configured, true)
    return result
  }
  return { dir, tools, context, calls, stores, call, save, reload, respond(fn) { responder = fn }, store(user = 1, profile = 'default') { return stores.get(JSON.stringify([user, profile])) } }
}

test('server registers maps without any UI, and missing key returns actionable host clarification without I/O', async t => {
  const registered = new Map()
  apply({ extensions: { rpc: { register() {} }, tools: { register: tool => registered.set(tool.name, tool) } } })
  assert.equal(registered.size, 13)
  const h = await setup(t)
  for (const [name, input] of [['configure_amap', { action: 'status' }], ['reverse_geocode', point()], ['plan_route', routeInput()]]) {
    const r = await h.call(name, input)
    assert.equal(r.ok, false); assert.equal(r.data.status, 'needs_configuration')
    assert.equal(r.data.clarification.nextTool, 'configure_amap')
    assert.match(r.data.clarification.instructions, /宿主澄清/)
    assert.match(r.data.clarification.instructions, /取消、超时/)
    assert.deepEqual(JSON.parse(r.content), r.data)
  }
  assert.equal(h.calls.length, 0); assert.equal(h.store().size, 0); assert.deepEqual(await readdir(h.dir), [])
})

test('key is validated, encrypted, reusable after reload and isolated by user/Profile', async t => {
  const h = await setup(t), saved = await h.save()
  assert.ok(!JSON.stringify(saved).includes(KEY))
  const envelope = h.store().get(AMAP_KEY_RECORD)
  assert.ok(!JSON.stringify(envelope).includes(KEY)); assert.equal(envelope.version, 1)
  assert.equal((await readFile(join(h.dir, 'amap-key-encryption-v1'))).length, 32)
  assert.equal((await stat(join(h.dir, 'amap-key-encryption-v1'))).mode & 0o777, 0o600)
  h.reload()
  const status = await h.call('configure_amap', { action: 'status' })
  assert.equal(status.data.configured, true); assert.equal(h.calls.length, 1)
  const found = await h.call('reverse_geocode', point())
  assert.equal(found.ok, true); assert.equal(h.calls.at(-1).url.searchParams.get('key'), KEY)
  for (const run of [h.context(2), h.context(1, 'work')]) assert.equal((await h.call('reverse_geocode', point(), run)).data.status, 'needs_configuration')
  const other = h.context(2)
  h.store(2).set(AMAP_KEY_RECORD, envelope)
  assert.equal((await h.call('reverse_geocode', point(), other)).data.status, 'storage_error')
  assert.equal(h.calls.length, 2)
})

test('failed key replacement preserves old key and clearing affects only current Profile', async t => {
  const h = await setup(t); await h.save(); await h.save(OTHER_KEY, h.context(1, 'work'))
  const previous = h.store().get(AMAP_KEY_RECORD)
  h.respond(() => ({ status: '0', infocode: '10001', info: `INVALID_USER_KEY ${OTHER_KEY}` }))
  const r = await h.call('configure_amap', { action: 'save', key: OTHER_KEY })
  assert.equal(r.data.status, 'authentication_error'); assert.ok(!JSON.stringify(r).includes(OTHER_KEY))
  assert.deepEqual(h.store().get(AMAP_KEY_RECORD), previous)
  assert.equal((await h.call('configure_amap', { action: 'clear' })).data.configured, false)
  assert.equal(h.store().size, 0); assert.equal(h.store(1, 'work').size, 1)
})

test('invalid inputs and absent coordinate systems fail before any network or credential write', async t => {
  const h = await setup(t)
  for (const [name, input] of [
    ['configure_amap', { action: 'save' }], ['configure_amap', { action: 'status', key: KEY }],
    ['configure_amap', { action: 'save', key: 'cancelled' }], ['reverse_geocode', { location: '116,39' }],
    ['reverse_geocode', point('190,39')], ['reverse_geocode', point('116,99')], ['reverse_geocode', point('116,39|117,40')],
    ['geocode_address', { address: '  ' }], ['plan_route', { ...routeInput(), mode: 'flying' }],
    ['plan_route', { ...routeInput(), origin: { address: '车站', ...point() } }],
    ['plan_route', { ...routeInput(), destination: { location: '116,39' } }],
    ['plan_route', { ...routeInput(), origin: { ...point(), city: '上海' } }],
    ['plan_route', { ...routeInput(), userId: 2 }],
  ]) assert.equal((await h.call(name, input)).data.status, 'invalid_input', name)
  assert.equal(h.calls.length, 0); assert.equal(h.store().size, 0)
})

test('WGS84 reverse geocoding converts longitude/latitude before lookup and normalizes empty address fields', async t => {
  const h = await setup(t); await h.save()
  h.respond(url => url.pathname.endsWith('/convert') ? { status: '1', locations: '116.4,39.91' } : regeo())
  const r = await h.call('reverse_geocode', { location: '116.39749991,39.90872291', coordinateSystem: 'wgs84' })
  assert.equal(r.ok, true); assert.equal(r.data.address.location, '116.4,39.91')
  assert.equal(r.data.address.city, ''); assert.equal(r.data.address.coordinateSystem, 'gcj02')
  assert.equal(h.calls[1].url.pathname, '/v3/assistant/coordinate/convert')
  assert.equal(h.calls[1].url.searchParams.get('locations'), '116.3975,39.908723')
  assert.equal(h.calls[1].url.searchParams.get('coordsys'), 'gps')
  assert.equal(h.calls[2].url.searchParams.get('location'), '116.4,39.91')
  assert.ok(!JSON.stringify(r).includes(KEY))
})

test('driving returns seconds/meters/tolls and complete instructions through MCP JSON', async t => {
  const h = await setup(t); await h.save()
  const r = await h.call('plan_route', routeInput())
  assert.equal(r.ok, true); assert.deepEqual(JSON.parse(r.content), r.data)
  assert.equal(r.data.routes[0].distanceMeters, 1200); assert.equal(r.data.routes[0].durationSeconds, 600)
  assert.equal(r.data.routes[0].tollsYuan, 0); assert.equal(r.data.routes[0].steps[0].instruction, '沿测试路向东行驶')
  assert.equal(h.calls.at(-1).url.pathname, '/v5/direction/driving')
  assert.equal(h.calls.at(-1).url.searchParams.get('show_fields'), 'cost,navi')
  assert.equal(h.calls.at(-1).url.searchParams.get('strategy'), '32')
})

test('walking resolves address and converts mixed GPS endpoint; absent cost remains unknown', async t => {
  const h = await setup(t); await h.save()
  h.respond(url => {
    if (url.pathname.endsWith('/geo')) return { status: '1', geocodes: [{ formatted_address: '北京市测试地标', location: '116.4,39.91', level: '兴趣点', citycode: '010' }] }
    if (url.pathname.endsWith('/convert')) return { status: '1', locations: '116.41,39.92' }
    const body = path(); body.route.paths[0].cost = { duration: [], tolls: '' }; body.route.paths[0].steps[0].instruction = '步行到测试路口'; return body
  })
  const r = await h.call('plan_route', { mode: 'walking', origin: { address: '测试地标', city: '北京' }, destination: { location: '116.405,39.915', coordinateSystem: 'wgs84' }, limit: 2 })
  assert.equal(r.ok, true); assert.equal(r.data.origin.formattedAddress, '北京市测试地标')
  assert.equal(r.data.routes[0].durationSeconds, undefined); assert.equal(r.data.routes[0].tollsYuan, undefined)
  const url = h.calls.at(-1).url
  assert.equal(url.pathname, '/v5/direction/walking'); assert.equal(url.searchParams.get('alternative_route'), '2')
  assert.equal(url.searchParams.get('origin'), '116.4,39.91'); assert.equal(url.searchParams.get('destination'), '116.41,39.92')
  assert.equal(h.calls[1].url.searchParams.get('city'), '北京')
})

test('transit resolves city codes, preserves alternate lines, transfers, entrances and walking legs', async t => {
  const h = await setup(t); await h.save()
  const busline = (name, from, to) => ({ name, type: '地铁线路', departure_stop: { name: from }, arrival_stop: { name: to }, via_num: '2', via_stops: [{ name: '中间站' }], start_time: '0600', end_time: '2300' })
  h.respond(url => url.pathname.endsWith('/regeo') ? regeo() : { status: '1', count: '1', route: { transits: [{ distance: '5000', cost: { duration: '1800', transit_fee: '6' }, segments: [
    { walking: { steps: [{ instruction: '步行到入口', distance: '200', duration: '180' }] }, bus: { buslines: [busline('1号线', '甲站', '乙站'), busline('支线', '甲站', '乙站')] }, entrance: { name: 'A口' }, exit: { name: 'B口' } },
    { walking: { distance: '100', steps: [] }, bus: { buslines: [busline('2号线', '乙站', '丙站')] }, cost: { transit_fee: '2' } },
  ] }] } })
  const r = await h.call('plan_route', routeInput('transit'))
  assert.equal(r.ok, true, r.content)
  assert.equal(h.calls.at(-1).url.searchParams.get('city1'), '010'); assert.equal(h.calls.at(-1).url.searchParams.get('city2'), '010')
  assert.equal(h.calls.at(-1).url.searchParams.get('AlternativeRoute'), '3')
  const route = r.data.routes[0]
  assert.equal(route.transfers, 1); assert.equal(route.fareYuan, 6)
  assert.deepEqual(route.steps.map(s => s.mode), ['walking', 'transit', 'walking', 'transit'])
  assert.equal(route.steps[1].lines.length, 2); assert.equal(route.steps[1].entrance, 'A口'); assert.equal(route.steps[1].exit, 'B口')
  assert.equal(route.steps[3].lines[0].arrivalStop, '丙站')
})

test('ambiguous and coarse addresses ask for clarification without routing or selecting first match', async t => {
  const h = await setup(t); await h.save()
  const candidate = { formatted_address: '同名广场', location: '116.4,39.91', level: '兴趣点' }
  for (const candidates of [[candidate, { ...candidate, location: '117,40' }], [{ ...candidate, level: '市' }], []]) {
    h.respond(() => ({ status: '1', geocodes: candidates }))
    const before = h.calls.length
    const r = await h.call('plan_route', { ...routeInput(), origin: { address: '广场' } })
    assert.equal(r.data.status, 'needs_clarification'); assert.equal(r.data.candidates.length, candidates.length)
    assert.equal(h.calls.length, before + 1); assert.equal(h.calls.at(-1).url.pathname, '/v3/geocode/geo')
  }
})

test('empty route success is distinguished from missing or malformed response data', async t => {
  const h = await setup(t); await h.save()
  h.respond(() => ({ status: '1', count: '0', route: { paths: [] } }))
  let r = await h.call('plan_route', routeInput())
  assert.equal(r.ok, true); assert.equal(r.data.status, 'empty'); assert.deepEqual(r.data.routes, [])
  for (const body of [{ status: '1', count: '1' }, { status: '1', route: { paths: [{ distance: '10', steps: [] }] } }, { status: '1', route: { paths: [{ distance: '10', steps: [{}] }] } }]) {
    h.respond(() => body); r = await h.call('plan_route', routeInput()); assert.equal(r.data.status, 'invalid_response'); assert.equal(r.ok, false)
  }
})

test('upstream errors are categorized without leaking key or provider error text', async t => {
  const h = await setup(t); await h.save()
  for (const [code, expected] of [['10001', 'authentication_error'], ['10009', 'authentication_error'], ['10005', 'permission_denied'], ['10007', 'permission_denied'], ['10003', 'rate_limited'], ['20000', 'upstream_error']]) {
    h.respond(() => ({ status: '0', infocode: code, info: `sensitive ${KEY}` }))
    const r = await h.call('reverse_geocode', point())
    assert.equal(r.data.status, expected); assert.ok(!JSON.stringify(r).includes(KEY)); assert.ok(!JSON.stringify(r).includes('sensitive'))
  }
  h.respond(() => { throw new Error(`fetch failed https://restapi.amap.com/?key=${KEY}`) })
  assert.ok(!JSON.stringify(await h.call('reverse_geocode', point())).includes(KEY))
  h.respond(() => new Response('too many', { status: 429 }))
  assert.equal((await h.call('reverse_geocode', point())).data.status, 'rate_limited')
  h.respond(() => new Response(`not JSON ${KEY}`))
  assert.equal((await h.call('reverse_geocode', point())).data.status, 'invalid_response')
})

test('oversized responses, timeouts and cancellation fail without saving credentials', async t => {
  const h = await setup(t, { timeoutMs: 25 })
  h.respond(() => new Response('x'.repeat(2000001)))
  assert.equal((await h.call('configure_amap', { action: 'save', key: KEY })).data.status, 'invalid_response')
  h.respond((_url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })))
  // Keep an event-loop handle alive because AbortSignal.timeout is unref'ed by Node.
  const keeper = setTimeout(() => {}, 1000)
  try { assert.equal((await h.call('configure_amap', { action: 'save', key: KEY })).data.status, 'timeout') } finally { clearTimeout(keeper) }
  const controller = new AbortController(); controller.abort()
  const before = h.calls.length
  assert.equal((await h.call('configure_amap', { action: 'save', key: KEY }, h.context(1, 'default', controller.signal))).data.status, 'cancelled')
  assert.equal(h.calls.length, before); assert.equal(h.store().size, 0)
})

test('abort after upstream validation never overwrites a previous credential', async t => {
  const h = await setup(t); await h.save(); const previous = h.store().get(AMAP_KEY_RECORD)
  const controller = new AbortController()
  h.respond(() => { controller.abort(); return regeo() })
  const r = await h.call('configure_amap', { action: 'save', key: OTHER_KEY }, h.context(1, 'default', controller.signal))
  assert.equal(r.data.status, 'cancelled'); assert.deepEqual(h.store().get(AMAP_KEY_RECORD), previous)
})

test('geocoding distinguishes exact, empty and truncated ambiguous matches', async t => {
  const h = await setup(t); await h.save()
  const candidate = { formatted_address: '北京市测试站', location: '116.4,39.91', level: '兴趣点', citycode: '010' }
  h.respond(() => ({ status: '1', geocodes: [candidate] }))
  let r = await h.call('geocode_address', { address: '测试站', city: '北京' })
  assert.equal(r.ok, true); assert.equal(r.data.candidates[0].coordinateSystem, 'gcj02')
  h.respond(() => ({ status: '1', geocodes: [] }))
  r = await h.call('geocode_address', { address: '未知地点' })
  assert.equal(r.ok, true); assert.equal(r.data.status, 'empty')
  h.respond(() => ({ status: '1', geocodes: Array.from({ length: 12 }, () => candidate) }))
  r = await h.call('geocode_address', { address: '测试站' })
  assert.equal(r.data.status, 'needs_clarification'); assert.equal(r.data.candidates.length, 10)
  assert.equal(r.data.truncated, true); assert.equal(r.data.clarification.nextTool, 'geocode_address')
})

test('transit railway and taxi legs remain explicit, and unrecognized segments fail instead of disappearing', async t => {
  const h = await setup(t); await h.save()
  const body = { status: '1', count: '1', route: { transits: [{ distance: '10000', segments: [
    { railway: { name: '城际铁路', trip: 'C100', departure_stop: { name: '甲站' }, arrival_stop: { name: '乙站' }, time: '600', distance: '9000' } },
    { taxi: { startname: '乙站', endname: '终点', distance: '1000', drivetime: '300', price: '10' } },
  ] }] } }
  h.respond(url => url.pathname.endsWith('/regeo') ? regeo() : body)
  let r = await h.call('plan_route', routeInput('transit'))
  assert.equal(r.ok, true); assert.deepEqual(r.data.routes[0].steps.map(step => step.mode), ['railway', 'taxi'])
  assert.equal(r.data.routes[0].steps[0].serviceCode, 'C100'); assert.equal(r.data.routes[0].steps[1].fareYuan, 10)
  body.route.transits[0].segments.push({ unknown_new_mode: { distance: '2000' } })
  r = await h.call('plan_route', routeInput('transit'))
  assert.equal(r.ok, false); assert.equal(r.data.status, 'invalid_response')
})

test('malformed validation responses and damaged encrypted state never silently replace a key', async t => {
  const h = await setup(t)
  h.respond(() => ({ status: '1' }))
  assert.equal((await h.call('configure_amap', { action: 'save', key: KEY })).data.status, 'invalid_response')
  assert.equal(h.store().size, 0)
  h.respond(() => regeo()); await h.save()
  const envelope = h.store().get(AMAP_KEY_RECORD)
  h.store().set(AMAP_KEY_RECORD, { ...envelope, tag: Buffer.alloc(16).toString('base64') })
  assert.equal((await h.call('reverse_geocode', point())).data.status, 'storage_error')
  h.store().set(AMAP_KEY_RECORD, envelope)
  await rm(join(h.dir, 'amap-key-encryption-v1')); h.reload()
  assert.equal((await h.call('reverse_geocode', point())).data.status, 'storage_error')
  assert.deepEqual(await readdir(h.dir), [])
  assert.deepEqual(h.store().get(AMAP_KEY_RECORD), envelope)
})

test('route limit marks omitted alternatives without truncating selected navigation steps', async t => {
  const h = await setup(t); await h.save()
  const body = path(); body.route.paths = Array.from({ length: 4 }, () => body.route.paths[0])
  h.respond(() => body)
  const r = await h.call('plan_route', { ...routeInput(), limit: 2 })
  assert.equal(r.ok, true); assert.equal(r.data.truncated, true); assert.equal(r.data.routes.length, 2)
  assert.equal(r.data.routes[1].steps[0].instruction, '沿测试路向东行驶')
})
