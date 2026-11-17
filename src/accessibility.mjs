/** Fixed Ctrip accessibility adapter. Original prices are never used as current quotes. */
export function hotelAccessibilityBlocks(rawNodes, url) {
  const nodes = rawNodes.filter(node => !node.ignored).map(node => ({ role: node.role?.value ?? node.role, name: node.name?.value ?? node.name ?? '' }))
  const names = new Set(nodes.filter(node => node.role === 'group' && node.name.startsWith('Photo gallery for ')).map(node => node.name.slice(18)))
  const blocks = []
  for (let index = 0; index < nodes.length && blocks.length < 40; index++) {
    const node = nodes[index]
    if (node.role !== 'StaticText' || !names.has(node.name)) continue
    const fields = []
    for (let next = index + 1; next < Math.min(index + 18, nodes.length); next++) {
      if (names.has(nodes[next].name) || nodes[next].role === 'group') break
      fields.push(nodes[next].name)
    }
    const current = fields.filter(value => /^Current price [¥￥]/.test(value))
    blocks.push({ title: node.name.slice(0, 300), text: [node.name, ...fields].join('\n').slice(0, 4000), url,
      priceText: current.length === 1 ? `${current[0].replace('Current price ', '')}${fields.includes('起') ? '起' : ''}` : '', selector: 'accessibility:hotel-name+Current price' })
  }
  return blocks
}
