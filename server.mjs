import { readFileSync } from 'node:fs'
import { assertContracts, registerRpc, validateModel } from './sdk/harness/contracts.mjs'
import { SOURCES } from './src/sources.mjs'
import { listTabs, openPage, collectPage } from './src/browser.mjs'
import { searchHotels } from './src/hotel-search.mjs'
import { searchTransport } from './src/transport.mjs'
const contract = assertContracts(JSON.parse(readFileSync(new URL('./contracts/plugin.json', import.meta.url), 'utf8')))

/** @param {import('@ekko-studio/plugin-sdk').PluginContext} ctx */
export function apply(ctx) {
  const traffic = mode => async (input, run) => {
    const result = await searchTransport(input, mode, run, contract)
    run.signal.throwIfAborted()
    if (result.conditionsVerified && ['partial', 'empty'].includes(result.status)) await run.state.profile.set('last-transport-v1', validateModel(contract, 'transport-result', result))
    return result
  }
  const methods = {
    'search-trains': traffic('train'),
    'search-flights': traffic('flight'),
    'last-transport': async (_input, run) => {
      const result = await run.state.profile.get('last-transport-v1')
      return result === undefined ? { present: false } : { present: true, result: validateModel(contract, 'transport-result', result) }
    },
    'list-sources': async () => ({ sources: SOURCES.map(({ id, name, kind, home }) => ({ id, name, kind, home })) }),
    'list-tabs': (_input, run) => listTabs(run),
    'open-page': (input, run) => openPage(input, run),
    'search-hotels': async (input, run) => {
      const result = await searchHotels(input, run, contract)
      run.signal.throwIfAborted()
      await run.state.profile.set('last-collection-v1', validateModel(contract, 'collection', result))
      return result
    },
    'collect-page': async (input, run) => {
      const result = await collectPage(input, run, contract)
      run.signal.throwIfAborted()
      await run.state.profile.set('last-collection-v1', validateModel(contract, 'collection', result))
      return result
    },
    'last-result': async (_input, run) => {
      const result = await run.state.profile.get('last-collection-v1')
      return result === undefined ? { present: false } : { present: true, result: validateModel(contract, 'collection', result) }
    },
  }
  for (const [name, handler] of Object.entries(methods)) registerRpc(ctx, contract, name, handler)
  for (const [name, rpcName, description, readOnly] of [
    ['list_pages', 'list-tabs', '列出 Studio 内置浏览器中支持的旅游站点页面。', true],
    ['open_page', 'open-page', '在内置浏览器创建旅游站点标签页，供用户登录或调试。', false],
    ['collect_page', 'collect-page', '使用固定脚本采集、清洗和校验旅游页面。明确返回登录、验证、阻断和部分数据状态，不调用 AI，不保证完整报价。', false],
    ['search_hotels', 'search-hotels', '按城市、地址/商圈/地标、入住和离店日期查携程酒店。固定脚本填写并核对条件；可按已采集展示价筛预算。未定位的地址明确标为关键词查询，不保证附近距离或最终成交价。', false],
    ['search_trains', 'search-trains', '按出发地、目的地、日期查携程列车。默认仅 G/D/C 动车高铁；返回具体车站、时间、席别票价和余票原文，抢票不视为有票。仅查询已加载记录。', false],
    ['search_flights', 'search-flights', '按城市、日期查携程国内单程 1 成人机票。默认经济舱直飞；站点确认城市全部机场，返回航班号、机场、时刻、展示价及税费未知状态。仅查询已加载记录。', false],
  ]) {
    const definition = contract.tools[name]
    ctx.extensions.tools.register({ name, description, readOnly, inputSchema: contract.models[definition.input],
      async execute(input, run) {
        try {
          validateModel(contract, definition.input, input)
          const data = await methods[rpcName](input, run)
          // The managed MCP bridge prioritizes content. Put the actual JSON
          // there as well as data so models receive records, not just a summary.
          return validateModel(contract, definition.output, { ok: !data.status || ['ok', 'partial'].includes(data.status) || (data.status === 'empty' && data.conditionsVerified === true), content: JSON.stringify(data), data })
        } catch (error) {
          const message = String(error?.message || error).slice(0, 1000)
          return validateModel(contract, definition.output, { ok: false, content: message, error: message })
        }
      },
    })
  }
}
