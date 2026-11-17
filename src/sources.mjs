export const SOURCES = [
  { id: 'ctrip', name: '携程酒店', kind: 'hotel', home: 'https://hotels.ctrip.com/hotels/hangzhou17', host: 'ctrip.com', selectors: ['[data-testid="hotel-card"]', '.hotel-card', '.hotel-item', '[class*="hotelCard"]', '[class*="hotel-card"]'], titleSelectors: ['[class*="hotelName"]', '[class*="hotel-name"]', '.name'], priceSelectors: ['[class*="sale-price"]', '[class*="salePrice"]', '[class*="price"]'] },
  { id: 'xiaohongshu', name: '小红书图文', kind: 'guide', home: 'https://www.xiaohongshu.com/search_result?keyword=%E6%9D%AD%E5%B7%9E%E6%97%85%E6%B8%B8%E6%94%BB%E7%95%A5&source=web_explore_feed&type=51', host: 'xiaohongshu.com', selectors: ['section.note-item', '.note-item'], titleSelectors: ['.title', '[class*="title"]'], priceSelectors: [] },
  { id: 'meituan', name: '美团（入口待验证）', kind: 'deal', home: 'https://hz.meituan.com/jiudian/', host: 'meituan.com', selectors: ['.hotel-item', '.poi-item', '.deal-tile'], titleSelectors: ['.poi-name', '.hotel-name', '.title', 'h3'], priceSelectors: ['.price'] },
  { id: 'ctrip-guide', name: '携程攻略', kind: 'guide', home: 'https://you.ctrip.com/travels/hangzhou14/', host: 'ctrip.com', selectors: ['.journalslist li', '.journals-item'], titleSelectors: ['dt', 'h3', '.title'], priceSelectors: [] },
  { id: 'mafengwo', name: '马蜂窝', kind: 'guide', home: 'https://m.mafengwo.cn/', host: 'mafengwo.cn', selectors: ['.tn-item', '.travel-item'], titleSelectors: ['.tn-title', 'h2', 'h3'], priceSelectors: [] },
  { id: 'ctrip-trains', name: '携程动车 / 火车票', kind: 'train', home: 'https://trains.ctrip.com/', host: 'trains.ctrip.com' },
  { id: 'ctrip-flights', name: '携程机票', kind: 'flight', home: 'https://flights.ctrip.com/online/channel/domestic', host: 'flights.ctrip.com' },
]
export function sourceForUrl(value) {
  let url
  try { url = new URL(value) } catch { return undefined }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined
  if (url.hostname === 'you.ctrip.com') return SOURCES.find(s => s.id === 'ctrip-guide')
  if (url.hostname === 'trains.ctrip.com') return SOURCES.find(s => s.id === 'ctrip-trains')
  if (url.hostname === 'flights.ctrip.com') return SOURCES.find(s => s.id === 'ctrip-flights')
  return SOURCES.find(s => s.id !== 'ctrip-guide' && (url.hostname === s.host || url.hostname.endsWith(`.${s.host}`)))
}
export function assertSourceUrl(value, id) {
  if (sourceForUrl(value)?.id !== id) throw new Error('地址必须是所选旅游来源的 HTTPS 页面')
}
export function publicUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return ''
    url.username = ''; url.password = ''; url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (!/^(keyword|cityId|cityName|destName|searchWord|searchType|searchValue|optionId|directSearch|checkIn|checkOut|adult|crn|listFilters|curr|locale|type|source|ticketType|dStation|aStation|dDate|rDate|trainsType|hubCityName|highSpeedOnly|depdate|cabin|child|infant)$/i.test(key)) url.searchParams.delete(key)
    return url.href.slice(0, 4096)
  } catch { return '' }
}
