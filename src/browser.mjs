import { SOURCES, sourceForUrl, assertSourceUrl, publicUrl } from './sources.mjs'
import { captureExpression } from './capture.mjs'
import { cleanSnapshot } from './clean.mjs'
import { hotelAccessibilityBlocks } from './accessibility.mjs'
import { validateModel } from '../sdk/harness/contracts.mjs'
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
  await browser.cdp.attach(tab.id)
  try {
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
  } finally { await browser.cdp.release(tab.id).catch(() => {}) }
}
