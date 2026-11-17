import { SOURCES, sourceForUrl, assertSourceUrl, publicUrl } from './sources.mjs'
import { captureExpression } from './capture.mjs'
import { cleanSnapshot } from './clean.mjs'
import { hotelAccessibilityBlocks } from './accessibility.mjs'
import { validateModel } from '../sdk/harness/contracts.mjs'
import { runGuide } from './guides.mjs'
export async function listTabs(run, browser = run.host.browser) {
  run.signal.throwIfAborted()
  const value = await browser.tabs.list()
  return { tabs: value.tabs.filter(tab => sourceForUrl(tab.url)).map(tab => ({ id: tab.id, title: tab.title.slice(0, 500), url: publicUrl(tab.url), source: sourceForUrl(tab.url).id, loading: tab.loading })) }
}
export async function openPage(input, run, browser = run.host.browser) {
  const source = SOURCES.find(source => source.id === input.source), url = input.url || source.home
  assertSourceUrl(url, source.id)
  run.signal.throwIfAborted()
  const tab = await browser.tabs.create(url)
  return { id: tab.id, title: tab.title.slice(0, 500), url: publicUrl(tab.url), source: source.id, loading: tab.loading }
}
export async function collectPage(input, run, contract, browser = run.host.browser) {
  run.signal.throwIfAborted()
  const tab = (await browser.tabs.list()).tabs.find(tab => tab.id === input.tabId)
  if (!tab) throw new Error('标签页不存在，请刷新标签页列表')
  const source = sourceForUrl(tab.url)
  if (!source) throw new Error('只能采集支持的旅游站点')
  if (['train', 'flight'].includes(source.kind)) throw new Error('交通页面请使用 search_trains / search_flights，提供出发地、目的地和日期后查询')
  if (source.kind === 'guide') {
    const result = await runGuide('read_guide', input, { ...run, host: { ...run.host, browser } }, contract)
    const known = contract.models.collection.properties.status.enum
    return validateModel(contract, 'collection', {
      schemaVersion: 1, source: source.id, tabId: tab.id, url: result.url || publicUrl(tab.url), pageTitle: tab.title?.slice(0, 500) || '',
      collectedAt: result.collectedAt, status: known.includes(result.status) ? result.status : 'layout_changed', message: result.message,
      records: result.records.map(row => ({ kind: row.extraction === 'link_semantics' ? 'guide_link' : 'guide', title: row.title, url: row.url, text: row.text, images: row.images.slice(0, 12).map(i => i.url), price: { raw: '', basis: 'unknown' } })),
      warnings: [...result.warnings, '攻略的日期证据、图片索引和接管说明请使用 read_guide。', ...(result.nextAction ? [result.nextAction] : [])],
      diagnostics: { readyState: 'complete', matchedBlocks: 0, matchedLinks: result.diagnostics?.matchedLinks || 0, articleCharacters: result.diagnostics?.articleCharacters || 0, excerpt: result.diagnostics?.excerpt || '' },
    })
  }
  await browser.cdp.attach(tab.id)
  try {
    return await collectAttachedPage(tab, source, run, contract, browser)
  } finally { await browser.cdp.release(tab.id).catch(() => {}) }
}
export async function collectAttachedPage(tab, source, run, contract, browser) {
  run.signal.throwIfAborted()
  const response = await browser.cdp.send(tab.id, 'Runtime.evaluate', { expression: captureExpression(source), returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails || !response.result || !Object.hasOwn(response.result, 'value')) throw new Error('页面脚本执行失败，请检查页面是否已经加载')
  const snapshot = validateModel(contract, 'page-snapshot', response.result.value)
  if (sourceForUrl(snapshot.url)?.id !== source.id) throw new Error('页面来源发生变化，请刷新后重新采集')
  if (source.id === 'ctrip' && snapshot.blocks.length === 0) {
    const tree = await browser.cdp.send(tab.id, 'Accessibility.getFullAXTree', {})
    if (Array.isArray(tree.nodes)) snapshot.blocks = hotelAccessibilityBlocks(tree.nodes, snapshot.url)
    validateModel(contract, 'page-snapshot', snapshot)
  }
  run.signal.throwIfAborted()
  return validateModel(contract, 'collection', cleanSnapshot(snapshot, source, tab.id))
}
