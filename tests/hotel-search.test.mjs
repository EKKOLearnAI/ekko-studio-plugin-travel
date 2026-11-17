import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateHotelQuery, checkHotelConditions, filterDisplayBudget } from '../src/hotel-search.mjs'
const query = { city: '杭州', address: '杭州东站', checkIn: '2026-11-18', checkOut: '2026-11-19' }
const state = (changes = {}) => ({ url: 'https://hotels.ctrip.com/hotels/list/?cityName=杭州&searchWord=杭州东站&checkin=2026-11-18&checkout=2026-11-19&curr=CNY', city: '杭州', address: '杭州东站', checkInText: '11月18日(周三)', checkOutText: '11月19日(周四)', ...changes })
test('hotel queries require real ordered dates and use the Beijing day boundary', () => {
  const now = new Date('2026-11-17T16:05:00Z')
  assert.equal(validateHotelQuery({ ...query, city: ' 杭州 ' }, now).city, '杭州')
  for (const changes of [{ city: ' ' }, { address: ' ' }, { checkIn: '2026-11-17' }, { checkIn: '2026-02-30' }, { checkIn: '2026-1-18' }, { checkOut: query.checkIn }, { checkOut: '2027-01-20' }]) {
    assert.throws(() => validateHotelQuery({ ...query, ...changes }, now))
  }
})
test('a hotel query requires both the actual result URL and visible form conditions to match', () => {
  assert.equal(checkHotelConditions(state(), query), true)
  assert.equal(checkHotelConditions(state({ city: '杭州市' }), query), true)
  for (const changes of [{ city: '上海' }, { address: '' }, { checkInText: '11月17日' }, { checkOutText: '12月19日' }, { url: 'https://hotels.ctrip.com/hotels/list/?cityName=杭州' }, { url: state().url.replace('hotels.ctrip.com', 'evil.test') }, { url: state().url.replace('杭州东站', '西湖') }, { url: state().url.replace('CNY', 'JPY') }]) assert.equal(checkHotelConditions(state(changes), query), false)
})
test('budget filtering never presents uncertain, conditional or total prices as verified nightly prices', () => {
  const result = { records: [
    { title: 'within', price: { amountMinor: 29900, basis: 'starting' } },
    { title: 'above', price: { amountMinor: 49900, basis: 'per_night' } },
    { title: 'unknown', price: { basis: 'unknown' } },
    { title: 'conditional', price: { amountMinor: 19900, basis: 'conditional' } },
    { title: 'total', price: { amountMinor: 99900, basis: 'total' } },
  ], warnings: [] }
  assert.deepEqual(filterDisplayBudget(result, 300), { excluded: 1, unverified: 3 })
  assert.deepEqual(result.records.map(row => row.title), ['within', 'unknown', 'conditional', 'total'])
  assert.match(result.warnings[0], /不代表全站或最终成交价/)
})
