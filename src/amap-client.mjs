const ORIGIN = 'https://restapi.amap.com'
const PATHS = new Set(['/v3/geocode/geo', '/v3/geocode/regeo', '/v3/assistant/coordinate/convert', '/v5/direction/driving', '/v5/direction/walking', '/v5/direction/transit/integrated'])

export class AmapError extends Error {
  constructor(status, message, details = {}) { super(message); this.status = status; this.details = details }
}

export function coordinate(value, status = 'invalid_input') {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(value.trim())) throw new AmapError(status, '坐标须为“经度,纬度”，并明确坐标系。')
  const [lng, lat] = value.split(',').map(Number)
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) throw new AmapError(status, '经纬度超出有效范围。')
  return `${Number(lng.toFixed(6))},${Number(lat.toFixed(6))}`
}

export function createAmapClient(key, runSignal, { fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  return async (path, params) => {
    runSignal.throwIfAborted()
    if (!PATHS.has(path)) throw new AmapError('invalid_input', '不支持的高德接口。')
    const url = new URL(path, ORIGIN)
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value))
    url.searchParams.set('key', key); url.searchParams.set('output', 'JSON')
    const signal = AbortSignal.any([runSignal, AbortSignal.timeout(timeoutMs)])
    try {
      // Never follow a redirect with a credential-bearing URL or return that URL.
      const response = await fetchImpl(url, { signal, redirect: 'error', headers: { accept: 'application/json' } })
      if (!response.ok) {
        await response.body?.cancel()
        throw new AmapError(response.status === 429 ? 'rate_limited' : 'upstream_error', response.status === 429 ? '高德请求频率受限，请稍后重试。' : '高德服务暂时不可用，请稍后重试。')
      }
      const reader = response.body?.getReader()
      if (!reader) throw new AmapError('invalid_response', '高德返回了空响应。')
      const chunks = []; let size = 0
      try {
        while (true) {
          signal.throwIfAborted()
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 2000000) { await reader.cancel(); throw new AmapError('invalid_response', '高德响应过大，已停止解析。') }
          chunks.push(Buffer.from(value))
        }
      } finally { reader.releaseLock() }
      signal.throwIfAborted()
      let data
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new AmapError('invalid_response', '高德返回的数据不是有效 JSON。') }
      if (!data || typeof data !== 'object' || Array.isArray(data) || !['0', '1'].includes(data.status)) throw new AmapError('invalid_response', '高德返回的数据结构不符合接口约定。')
      if (data.status !== '1') {
        const code = String(data.infocode)
        if (['10001', '10009', '10013'].includes(code)) throw new AmapError('authentication_error', '高德 Key 无效、已删除或平台类型不匹配，请提供 Web 服务类型的 Key。')
        if (['10003', '10004', '10010', '10014', '10019', '10020', '10021', '10044'].includes(code)) throw new AmapError('rate_limited', '高德额度或请求频率受限，请检查配额或稍后重试。')
        if (['10002', '10005', '10006', '10007', '10008', '10012'].includes(code)) throw new AmapError('permission_denied', '高德服务权限、IP 白名单或签名配置不允许本次请求，请检查高德控制台配置。')
        throw new AmapError('upstream_error', '高德未能完成请求，请核对地点、服务范围及控制台配置。')
      }
      return data
    } catch (error) {
      if (runSignal.aborted) throw new AmapError(runSignal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled', runSignal.reason?.name === 'TimeoutError' ? '地图查询超时，请稍后重试。' : '地图查询已取消。')
      if (signal.aborted) throw new AmapError('timeout', '高德请求超时，请稍后重试。')
      if (error instanceof AmapError) throw error
      // Fetch/JSON/storage exceptions may include the key; never forward them.
      throw new AmapError('upstream_error', '无法连接高德服务，请稍后重试。')
    }
  }
}
