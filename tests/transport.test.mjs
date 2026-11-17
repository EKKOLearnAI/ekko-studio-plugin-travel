import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateModel } from '../sdk/harness/contracts.mjs'
import { validateTransportQuery, buildTrainUrl, buildFlightUrl, transportConditions, cleanTransport, ticketPrice, seatAvailability } from '../src/transport.mjs'
import { sourceForUrl, publicUrl } from '../src/sources.mjs'
const contract = JSON.parse(readFileSync(new URL('../contracts/plugin.json', import.meta.url)))
const now = new Date('2026-11-17T16:05:00Z')
const train = validateTransportQuery({ from: '上海', to: '杭州', departureDate: '2026-11-20' }, 'train', now)
const flight = validateTransportQuery({ from: '上海', to: '北京', departureDate: train.departureDate }, 'flight', now)
const page = (changes = {}) => ({ url: buildTrainUrl(train), title: '合成车票页', readyState: 'complete', blocking: '', fromLabel: '上海', toLabel: '杭州', dateLabel: train.departureDate, tripLabel: '单程', cabinLabel: '', heading: '', loadedCount: 1, matchedCount: 1, rows: [], excerpt: '', ...changes })
const row = (changes = {}) => ({ serviceCodes: ['G100'], provider: '铁路', departurePlace: '上海虹桥', arrivalPlace: '杭州东', departureTime: '08:00', arrivalTime: '09:00', arrivalDayText: '', durationText: '1小时', connectionType: 'direct', connectionText: '', cabinText: '', priceText: '57', currency: 'CNY', conditionsText: '', feeText: '', seats: [{ name: '二等座', availabilityText: '二等座(抢)', priceText: '57' }, { name: '一等座', availabilityText: '一等座2张', priceText: '91' }], rawText: '合成列车', ...changes })
test('transport dates use the Beijing boundary, validate dates and preserve explicit defaults', () => {
  assert.equal(train.highSpeedOnly, true); assert.equal(flight.directOnly, true); assert.equal(flight.cabin, 'economy')
  for (const changes of [{ from: ' ' }, { to: '上海市' }, { departureDate: '2026-11-17' }, { departureDate: '2027-02-30' }, { departureDate: '2028-01-01' }]) assert.throws(() => validateTransportQuery({ ...train, ...changes }, 'train', now))
  assert.throws(() => validateModel(contract, 'train-query', { from: '上海', to: '杭州', departureDate: '2026-11-20', limit: 51 }))
})
test('traffic query verification checks URL and rendered fields, including aggregate airport codes', () => {
  assert.equal(transportConditions(page(), train), true)
  for (const changes of [{ dateLabel: '2026-11-21' }, { toLabel: '杭州东' }, { tripLabel: '往返' }, { url: buildTrainUrl(train).replace('trains.ctrip.com', 'evil.test') }]) assert.equal(transportConditions(page(changes), train), false)
  const codes = { from: 'SHA', to: 'BJS' }
  const p = page({ url: buildFlightUrl(flight, codes), fromLabel: '上海(SHA)', toLabel: '北京(BJS)', cabinLabel: '经济舱' })
  assert.equal(transportConditions(p, flight, codes), true)
  assert.equal(transportConditions({ ...p, toLabel: '北京大兴国际机场(PKX)' }, flight, codes), false)
  assert.equal(transportConditions({ ...p, url: p.url.replace('adult=1', 'adult=2') }, flight, codes), false)
  assert.equal(transportConditions({ ...p, cabinLabel: '不限舱等' }, flight, codes), false)
  assert.throws(() => buildFlightUrl(flight, { from: 'PVG/xxx', to: 'BJS' }))
  assert.equal(sourceForUrl(p.url).id, 'ctrip-flights')
  assert.equal(sourceForUrl(buildTrainUrl(train)).id, 'ctrip-trains')
  const safe = publicUrl(p.url + '&auth_secret=do-not-return')
  assert.ok(safe.includes('depdate=')); assert.ok(!safe.includes('auth_secret'))
})
test('seat availability never treats ticket grabbing as stock and prices remain per class', () => {
  for (const text of ['抢票', '无座(抢)', '暂无余票，成功率高', '二等座0张', '停售']) assert.equal(seatAvailability(text), 'unavailable')
  assert.equal(seatAvailability('2张'), 'available'); assert.equal(seatAvailability('未开售'), 'not_on_sale')
  const r = cleanTransport(page({ rows: [row(), row(), row({ departurePlace: '上海松江' })] }), train, 'test', true)
  validateModel(contract, 'transport-result', r)
  assert.equal(r.records.length, 2)
  assert.equal(r.records[0].price.basis, 'starting')
  assert.equal(r.records[0].seats[0].availability, 'unavailable')
  assert.equal(r.records[0].seats[1].remaining, 2)
  assert.equal(r.records[0].seats[1].price.amountMinor, 9100)
  assert.equal(r.records[0].seats[1].price.basis, 'per_seat')
})
test('only clear ticket amounts are parsed, with membership and unknown fees preserved', () => {
  assert.deepEqual(ticketPrice('¥427起 普通会员可享', 'CNY'), { raw: '¥427起 普通会员可享', basis: 'conditional', amountMinor: 42700, currency: 'CNY' })
  assert.equal(ticketPrice('¥427 ¥103', 'CNY').amountMinor, undefined)
  assert.equal(ticketPrice('427', '').amountMinor, undefined)
  const r = cleanTransport(page({ rows: [row({ serviceCodes: ['CA1000'], priceText: '¥490起', seats: [] })] }), flight, 'test', true)
  assert.equal(r.records[0].feeInclusion, 'unknown')
})
test('unverified, blocked, presale, filter-empty and layout failures remain distinct', () => {
  assert.equal(cleanTransport(page({ rows: [row()] }), train, 'test', false).records.length, 0)
  assert.equal(cleanTransport(page({ blocking: 'verification_required', rows: [row()] }), train, 'test', true).status, 'verification_required')
  assert.equal(cleanTransport(page({ excerpt: '该日期超出预售期', loadedCount: 0 }), train, 'test', false).status, 'not_on_sale')
  assert.equal(cleanTransport(page({ matchedCount: 0 }), train, 'test', true).status, 'empty')
  assert.equal(cleanTransport(page({ loadedCount: 0, matchedCount: 0 }), train, 'test', true).status, 'layout_changed')
  const invalid = cleanTransport(page({ rows: [row({ serviceCodes: [] })] }), train, 'test', true)
  assert.equal(invalid.status, 'layout_changed'); assert.equal(invalid.diagnostics.invalidRows, 1)
})
