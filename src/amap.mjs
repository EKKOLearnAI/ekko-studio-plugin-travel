import { validateModel } from '../sdk/harness/contracts.mjs'
import { AmapError, coordinate, createAmapClient } from './amap-client.mjs'
import { createKeyStore } from './amap-key.mjs'

const text = value => typeof value === 'string' ? value.trim().slice(0, 1000) : ''
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const list = value => Array.isArray(value) ? value : []
const number = value => (typeof value === 'number' || typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())) && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : undefined
function numeric(target, key, value) { const n = number(value); if (n !== undefined) target[key] = n }
const result = (status, message, extra = {}) => ({ schemaVersion: 1, source: 'amap', status, message, queriedAt: Date.now(), ...extra })
const configuration = message => result('needs_configuration', message, {
  configured: false, scope: 'user_profile', clarification: {
    question: '请提供高德开放平台“Web 服务”类型的 API Key，用于地址解析和路线规划；将按当前账号及 Profile 保存供后续复用。',
    nextTool: 'configure_amap', instructions: '当前 Agent 必须使用宿主澄清工具提问；Studio Coding Agent 使用 ekko_studio_clarify 和本轮 context_id。仅在用户实际提供 Key 后，以 action=save 和 key 调用 configure_amap，成功后重试原查询；不要回显 Key。取消、超时或后台无法澄清时停止，不猜测、不读取其他账号凭证。',
  },
})
function requireText(value, label) { if (!text(value)) throw new AmapError('invalid_input', `${label}不能为空。`); return value.trim() }
function endpointInput(point) {
  if (Boolean(point.address) === Boolean(point.location)) throw new AmapError('invalid_input', '起终点必须各自提供地址或坐标中的一种。')
  if (point.location) {
    coordinate(point.location)
    if (!['gcj02', 'wgs84'].includes(point.coordinateSystem)) throw new AmapError('invalid_input', '坐标须明确 coordinateSystem：gcj02 为高德坐标，wgs84 为 GPS 坐标。')
    if (point.city !== undefined) throw new AmapError('invalid_input', '坐标端点的城市由逆地址解析确定，不接受额外城市条件。')
  } else {
    requireText(point.address, '地址')
    if (point.coordinateSystem !== undefined) throw new AmapError('invalid_input', '地址端点不需要坐标系。')
    if (point.city !== undefined) requireText(point.city, '城市')
  }
}
async function gcjLocation(request, location, system) {
  const normalized = coordinate(location)
  if (system === 'gcj02') return normalized
  const data = await request('/v3/assistant/coordinate/convert', { locations: normalized, coordsys: 'gps' })
  return coordinate(data.locations, 'invalid_response')
}
function addressFields(value, location) {
  const component = object(value.addressComponent || value)
  return { location, coordinateSystem: 'gcj02', formattedAddress: text(value.formatted_address), province: text(component.province),
    city: text(component.city), district: text(component.district), cityCode: text(component.citycode), adcode: text(component.adcode),
    township: text(component.township), street: text(object(component.streetNumber).street || component.street),
    number: text(object(component.streetNumber).number || component.number) }
}
async function reverse(request, location) {
  const data = await request('/v3/geocode/regeo', { location, extensions: 'base' })
  if (!data.regeocode || Array.isArray(data.regeocode)) throw new AmapError('invalid_response', '高德未返回有效的逆地址解析结构。')
  return addressFields(data.regeocode, location)
}
async function geocode(request, input) {
  const data = await request('/v3/geocode/geo', { address: input.address.trim(), ...(input.city ? { city: input.city.trim() } : {}) })
  if (!Array.isArray(data.geocodes)) throw new AmapError('invalid_response', '高德未返回有效的地址候选列表。')
  return data.geocodes.map(row => ({ ...addressFields(row, coordinate(row.location, 'invalid_response')), level: text(row.level) }))
}
const coarse = place => !place.level || ['国家', '省', '市', '区县', '乡镇', '村庄', '热点商圈', '未知'].includes(place.level)
function uncertain(candidates, label) {
  return new AmapError('needs_clarification', `${label}未定位到唯一明确地点，请确认后再规划路线。`, {
    candidates: candidates.slice(0, 10), truncated: candidates.length > 10,
    clarification: { question: `请补充${label}的城市、详细地址或确认具体地点坐标。`, nextTool: 'plan_route', instructions: '使用宿主澄清工具确认地点；不要默认选择第一条或用城市中心代替目的地。' },
  })
}
async function resolveEndpoint(request, input, label, transit) {
  let place
  if (input.location) {
    const location = await gcjLocation(request, input.location, input.coordinateSystem)
    place = transit ? await reverse(request, location) : { location, coordinateSystem: 'gcj02', formattedAddress: '' }
  } else {
    const candidates = await geocode(request, input)
    if (candidates.length !== 1 || coarse(candidates[0])) throw uncertain(candidates, label)
    place = candidates[0]
  }
  if (transit && !/^\d{3,4}$/.test(place.cityCode || '')) {
    place = { ...place, ...await reverse(request, place.location) }
    if (!/^\d{3,4}$/.test(place.cityCode)) throw uncertain([place], label)
  }
  return place
}
function roadStep(row, mode) {
  const step = { mode, instruction: text(row.instruction), road: text(row.road_name || row.road), orientation: text(row.orientation), action: text(object(row.navi).action || row.action) }
  numeric(step, 'distanceMeters', row.step_distance ?? row.distance)
  numeric(step, 'durationSeconds', object(row.cost).duration ?? row.duration)
  if (!step.instruction) throw new AmapError('invalid_response', '高德路段缺少导航说明，未将不完整路线作为有效结果。')
  return step
}
function transitSteps(segments) {
  const steps = []; let boardings = 0
  for (const segment of segments) {
    const before = steps.length
    const walking = object(segment.walking)
    if (list(walking.steps).length) steps.push(...walking.steps.map(row => roadStep(row, 'walking')))
    else if (number(walking.distance) > 0) {
      const step = { mode: 'walking', instruction: '步行至下一换乘点（高德未提供逐路段指引）' }
      numeric(step, 'distanceMeters', walking.distance); numeric(step, 'durationSeconds', walking.duration); steps.push(step)
    }
    const lines = list(object(segment.bus).buslines)
    if (lines.length) {
      boardings++
      const alternatives = lines.map(line => {
        const item = { name: text(line.name), type: text(line.type), departureStop: text(object(line.departure_stop).name), arrivalStop: text(object(line.arrival_stop).name),
          viaStops: list(line.via_stops).map(stop => text(stop.name)).filter(Boolean), firstDeparture: text(line.start_time), lastDeparture: text(line.end_time) }
        if (!item.name || !item.departureStop || !item.arrivalStop) throw new AmapError('invalid_response', '高德公交路段缺少线路或上下车站信息。')
        numeric(item, 'stopCount', line.via_num); numeric(item, 'distanceMeters', line.distance); numeric(item, 'durationSeconds', line.duration)
        return item
      })
      const step = { mode: 'transit', instruction: `从${alternatives[0].departureStop}上车，乘坐${alternatives.map(item => item.name).join('或')}，在${alternatives[0].arrivalStop}下车。`,
        lines: alternatives, entrance: text(object(segment.entrance).name), exit: text(object(segment.exit).name) }
      numeric(step, 'fareYuan', object(segment.cost).transit_fee)
      steps.push(step)
    }
    const rail = object(segment.railway)
    if (text(rail.name) || text(rail.trip)) {
      boardings++
      const step = { mode: 'railway', instruction: `乘坐${text(rail.name) || text(rail.trip)}`, departureStop: text(object(rail.departure_stop).name), arrivalStop: text(object(rail.arrival_stop).name), serviceCode: text(rail.trip) }
      if (!step.departureStop || !step.arrivalStop) throw new AmapError('invalid_response', '高德铁路换乘路段缺少车站信息。')
      numeric(step, 'distanceMeters', rail.distance); numeric(step, 'durationSeconds', rail.time); steps.push(step)
    }
    const taxi = object(segment.taxi)
    if (number(taxi.distance) > 0) {
      const step = { mode: 'taxi', instruction: '此段需要乘坐出租车', departureStop: text(taxi.startname), arrivalStop: text(taxi.endname) }
      numeric(step, 'distanceMeters', taxi.distance); numeric(step, 'durationSeconds', taxi.drivetime); numeric(step, 'fareYuan', taxi.price); steps.push(step)
    }
    if (steps.length === before) throw new AmapError('invalid_response', '高德返回了无法解释的换乘路段，未省略该路段后拼接路线。')
  }
  return { steps, transfers: Math.max(0, boardings - 1) }
}
function routesFrom(data, mode, limit) {
  const raw = object(data.route)[mode === 'transit' ? 'transits' : 'paths']
  if (!Array.isArray(raw)) {
    if (String(data.count) === '0') return { routes: [], truncated: false }
    throw new AmapError('invalid_response', '高德未返回有效的路线列表。')
  }
  const routes = raw.slice(0, limit).map((path, i) => {
    const normalized = mode === 'transit' ? transitSteps(list(path.segments)) : { steps: list(path.steps).map(row => roadStep(row, mode)) }
    if (!normalized.steps.length || number(path.distance) === undefined) throw new AmapError('invalid_response', '高德路线缺少距离或出行步骤。')
    const route = { index: i + 1, ...normalized }
    numeric(route, 'distanceMeters', path.distance); numeric(route, 'durationSeconds', object(path.cost).duration)
    numeric(route, 'fareYuan', object(path.cost).transit_fee); numeric(route, 'tollsYuan', object(path.cost).tolls)
    if (mode === 'driving') route.restriction = text(path.restriction)
    return route
  })
  return { routes, truncated: raw.length > limit }
}

export function createAmapService(dataDir, contract, options = {}) {
  const keys = createKeyStore(dataDir, contract)
  return async (operation, input, run) => {
    let activeKey = ''
    // Bound the entire multi-request operation, as well as each HTTP call.
    const signal = AbortSignal.any([run.signal, AbortSignal.timeout(60000)])
    const current = { ...run, signal }
    try {
      signal.throwIfAborted()
      const definition = contract.tools[operation]
      try { validateModel(contract, definition.input, input) } catch { throw new AmapError('invalid_input', '地图工具参数不符合要求，请核对工具输入说明。') }
      if (operation === 'configure_amap') {
        if (input.action !== 'save' && input.key !== undefined) throw new AmapError('invalid_input', '只有 action=save 可以提供 Key。')
        if (input.action === 'clear') { await keys.clear(current); return result('ok', '已清除当前账号和 Profile 的高德 Key。', { configured: false, scope: 'user_profile' }) }
        if (input.action === 'save') {
          const key = typeof input.key === 'string' ? input.key.trim() : ''
          if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new AmapError('invalid_input', '请提供完整的高德 Web 服务 Key，不要填写示例、网址或说明文字。')
          activeKey = key
          const request = createAmapClient(key, signal, options)
          // A fixed public landmark checks geocoding permission without sending a user's location.
          const checked = await reverse(request, '116.397499,39.908722')
          if (!checked.formattedAddress) throw new AmapError('invalid_response', 'Key 验证请求未返回有效地址，未保存新配置。')
          const updatedAt = await keys.save(current, key)
          return result('ok', '高德 Key 已验证并保存，可继续原查询。', { configured: true, scope: 'user_profile', updatedAt })
        }
        const saved = await keys.read(current)
        return saved ? result('ok', '当前账号和 Profile 已配置高德 Key。', { configured: true, scope: 'user_profile', updatedAt: saved.updatedAt }) : configuration('尚未配置高德 Web 服务 Key。')
      }
      if (operation === 'geocode_address') { requireText(input.address, '地址'); if (input.city !== undefined) requireText(input.city, '城市') }
      if (operation === 'reverse_geocode') coordinate(input.location)
      if (operation === 'plan_route') { endpointInput(input.origin); endpointInput(input.destination) }
      const saved = await keys.read(current)
      if (!saved) return configuration('首次使用高德地图，请先通过澄清提供 Web 服务 Key。')
      activeKey = saved.key
      const request = createAmapClient(activeKey, signal, options)
      let output
      if (operation === 'geocode_address') {
        const candidates = await geocode(request, input)
        if (candidates.length > 1 || candidates.length === 1 && coarse(candidates[0])) {
          const error = uncertain(candidates, '地址'); error.details.clarification.nextTool = 'geocode_address'; throw error
        }
        output = result(candidates.length ? 'ok' : 'empty', candidates.length ? '地址已解析为高德坐标。' : '未找到匹配地址，请补充城市和详细地点。', { candidates, truncated: false })
      } else if (operation === 'reverse_geocode') {
        const location = await gcjLocation(request, input.location, input.coordinateSystem)
        const address = await reverse(request, location)
        output = result(address.formattedAddress ? 'ok' : 'empty', address.formattedAddress ? '坐标已解析为地址。' : '该坐标没有返回可用地址。', { address })
      } else if (operation === 'plan_route') {
        const origin = await resolveEndpoint(request, input.origin, '出发地', input.mode === 'transit')
        const destination = await resolveEndpoint(request, input.destination, '目的地', input.mode === 'transit')
        const limit = input.limit ?? 3
        const params = { origin: origin.location, destination: destination.location, show_fields: 'cost,navi' }
        if (input.mode === 'transit') Object.assign(params, { city1: origin.cityCode, city2: destination.cityCode, strategy: 0, AlternativeRoute: limit, nightflag: 1 })
        if (input.mode === 'walking') params.alternative_route = limit
        if (input.mode === 'driving') params.strategy = 32
        const data = await request(`/v5/direction/${input.mode === 'transit' ? 'transit/integrated' : input.mode}`, params)
        const normalized = routesFrom(data, input.mode, limit)
        output = result(normalized.routes.length ? 'ok' : 'empty', normalized.routes.length ? '已获取高德路线规划。' : '高德没有返回可用路线。', {
          mode: input.mode, origin, destination, ...normalized,
          warnings: ['距离、耗时和费用为高德查询时的估计，以现场道路、运营时刻和实际收费为准。', ...(input.mode === 'transit' ? ['包含夜班车候选；公交方案不保证车辆实时到站或车票有售，请核对运营时间。'] : []), ...(normalized.truncated ? ['仅返回前几条路线方案。'] : [])],
        })
      } else throw new AmapError('invalid_input', '未知地图操作。')
      signal.throwIfAborted()
      return JSON.parse(JSON.stringify(output).replaceAll(activeKey, '[redacted]'))
    } catch (error) {
      if (signal.aborted) return result(run.signal.aborted ? 'cancelled' : 'timeout', run.signal.aborted ? '地图操作已取消。' : '地图操作超时，请稍后重试。')
      if (!(error instanceof AmapError)) return result('upstream_error', '地图操作失败，请重试；未回传内部错误或凭证。')
      const output = result(error.status, error.message, error.details)
      if (error.status === 'authentication_error') output.clarification = configuration('').clarification
      return activeKey ? JSON.parse(JSON.stringify(output).replaceAll(activeKey, '[redacted]')) : output
    }
  }
}

export function registerAmapTools(ctx, contract, options = {}) {
  const execute = createAmapService(ctx.paths?.dataDir, contract, options)
  for (const name of ['configure_amap', 'geocode_address', 'reverse_geocode', 'plan_route']) {
    const definition = contract.tools[name]
    ctx.extensions.tools.register({ name, description: definition.description, readOnly: name !== 'configure_amap', inputSchema: contract.models[definition.input],
      async execute(input, run) {
        let data = await execute(name, input, run)
        try { validateModel(contract, 'amap-result', data) }
        catch { data = result('invalid_response', '地图结果不符合数据契约，未返回未经校验的数据。') }
        if (Buffer.byteLength(JSON.stringify(data), 'utf8') > 750000) data = result('invalid_response', '路线结果过大，请缩小查询范围或减少方案数量。')
        const ok = ['ok', 'empty'].includes(data.status)
        return validateModel(contract, definition.output, { ok, content: JSON.stringify(data), data, ...(!ok ? { error: data.message } : {}) })
      },
    })
  }
}
