import { readFileSync } from 'node:fs'
import { assertContracts, registerRpc, validateModel } from './sdk/harness/contracts.mjs'
import { SOURCES } from './src/sources.mjs'
import { listTabs, openPage, collectPage } from './src/browser.mjs'
import { searchHotels } from './src/hotel-search.mjs'
const contract = assertContracts(JSON.parse(readFileSync(new URL('./contracts/plugin.json', import.meta.url), 'utf8')))

/** @param {import('@ekko-studio/plugin-sdk').PluginContext} ctx */
export function apply(ctx) {
  const methods = {
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
  ]) {
    const definition = contract.tools[name]
    ctx.extensions.tools.register({ name, description, readOnly, inputSchema: contract.models[definition.input],
      async execute(input, run) {
        try {
          validateModel(contract, definition.input, input)
          const data = await methods[rpcName](input, run)
          return validateModel(contract, definition.output, { ok: !data.status || ['ok', 'partial'].includes(data.status), content: data.message || '操作已完成。', data })
        } catch (error) { return validateModel(contract, definition.output, { ok: false, content: '采集工具执行失败', error: String(error?.message || error).slice(0, 1000) }) }
      },
    })
  }
}
