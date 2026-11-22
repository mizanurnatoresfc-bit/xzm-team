// Tests of the "Update Report" parser. Run:  npm run test:parser
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseReport, stripInitial } from '../src/lib/reportParser.ts'

const SAMPLE = readFileSync(new URL('./fixtures/update_report.txt', import.meta.url), 'utf8').trim()

const expectSample = r => {
  assert.deepEqual(r.errors, [])
  assert.equal(r.ok, true)
  assert.equal(r.report.report_no, '744847')
  assert.equal(r.report.manager_code, '6865')
  assert.equal(r.report.reported_at, '2026-11-16T20:37:00')
  assert.equal(r.report.report_date, '2026-11-16')
  assert.equal(r.report.collected, 332668)
  assert.equal(r.report.delivery_charge, 230)
  assert.equal(r.report.declared_lists, 8)
  assert.equal(r.report.declared_parcels, 190)
  assert.deepEqual(r.sums, { lists: 8, parcels: 190, amount: 332438 })
  assert.deepEqual(r.checks.map(c => [c.key, c.ok]), [['amount', true], ['parcels', true], ['lists', true]])
  assert.deepEqual(r.report.lists.map(l => l.list_no),
    ['11440804', '11450821', '11451178', '11451319', '11451593', '11451749', '11452413', '11453411'])
  assert.deepEqual(r.report.lists.map(l => l.rider_code), [null, '44174', '35541', '16052', '42207', '27147', '68272', '46880'])
  assert.deepEqual(r.report.lists.map(l => l.parcels), [8, 27, 37, 31, 22, 31, 32, 2])
  assert.deepEqual(r.report.lists.map(l => l.amount), [43490, 20789, 44054, 26503, 38320, 77127, 45555, 36600])
}

test('the sample: 8 lists, 190 parcels, 332,438 + 230 = 332,668, all three checks pass', () => {
  const r = parseReport(SAMPLE)
  expectSample(r)
  assert.equal(r.report.hub_text, 'Gurudaspur (Natore)')
  assert.equal(r.report.manager_name, 'MD. RASHED MIAH')
  assert.equal(r.report.total_parcels, 190)
  assert.equal(r.report.total_amount, 332438)
})

test('the letter before a name is dropped; Point delivery has no rider', () => {
  const { lists } = parseReport(SAMPLE).report
  assert.deepEqual(lists.map(l => l.rider_name),
    [null, 'Md Sazib Ali', 'amirul islam', 'Jony Ahamed', 'Saykot kumar', 'ASHIK UJJAMAN', 'Md Rahenur Islam', 'Hasibul Islam'])
  assert.deepEqual(lists.map(l => l.point), [true, false, false, false, false, false, false, false])
  assert.equal(stripInitial('M Md Sazib Ali'), 'Md Sazib Ali')
  assert.equal(stripInitial('Md Sazib Ali'), 'Md Sazib Ali')
  assert.equal(stripInitial('r Rahim'), 'Rahim')
  assert.equal(stripInitial('M Rahim'), 'M Rahim')   // not the avatar letter: kept
})

test('the same text as one line', () => {
  const r = parseReport(SAMPLE.replace(/\n/g, ' '))
  expectSample(r)
  assert.equal(r.report.hub_text, 'Gurudaspur (Natore)')
  assert.equal(r.report.manager_name, 'MD. RASHED MIAH')
})

test('one line, hub without a bracket: a known hub name splits hub and manager', () => {
  const r = parseReport(SAMPLE.replace('Gurudaspur (Natore)', 'Natore Sadar').replace(/\n/g, ' '), { hubNames: ['Natore', 'Natore Sadar'] })
  assert.equal(r.ok, true)
  assert.equal(r.report.hub_text, 'Natore Sadar')
  assert.equal(r.report.manager_name, 'MD. RASHED MIAH')
})

test('tabs between the columns, and every cell on its own line', () => {
  const tabbed = SAMPLE.split('\n').map(l => (l.startsWith('#') ? l.replace(/ (?=#\d|\d+ |[\d.]+%|—|৳|Submitted)/g, '\t') : l)).join('\r\n')
  assert.ok(tabbed.includes('\t'))
  expectSample(parseReport(tabbed))
  const cells = SAMPLE.split('\n').map(l => (l.startsWith('#') ? l.replace(/ (?=#\d|\d+ |[\d.]+%|—|৳|Submitted)/g, '\n') : l)).join('\n\n')
  expectSample(parseReport(cells))
})

test('Bengali digits and no ৳ sign are still read', () => {
  const bn = SAMPLE.replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[d])
  expectSample(parseReport(bn))
  expectSample(parseReport(SAMPLE.replace(/৳/g, '')))
})

test('one digit changed in an amount: the money check fails', () => {
  const r = parseReport(SAMPLE.replace('৳20,789.00', '৳20,788.00'))
  assert.equal(r.ok, false)
  assert.deepEqual(r.checks.map(c => c.ok), [false, true, true])
  assert.equal(r.checks[0].expected, 332668)
  assert.equal(r.checks[0].got, 332667)
})

test('one digit changed in COLLECTED, in a parcel count, in the list count', () => {
  assert.deepEqual(parseReport(SAMPLE.replace('৳332,668.00', '৳332,669.00')).checks.map(c => c.ok), [false, true, true])
  const p = parseReport(SAMPLE.replace('#44174 27 ', '#44174 28 '))
  assert.deepEqual(p.checks.map(c => c.ok), [true, false, true])
  assert.deepEqual([p.checks[1].expected, p.checks[1].got], [190, 191])
  const l = parseReport(SAMPLE.replace('8 lists', '9 lists'))
  assert.deepEqual(l.checks.map(c => c.ok), [true, true, false])
  assert.equal(parseReport(SAMPLE.replace('8 lists', '9 lists')).ok, false)
})

test('a list missing from the paste fails all three checks', () => {
  const r = parseReport(SAMPLE.split('\n').filter(l => !l.startsWith('#11453411')).join('\n'))
  assert.equal(r.ok, false)
  assert.deepEqual(r.checks.map(c => c.ok), [false, false, false])
})

test('text that is not a report, a broken list, a list twice: errors, never ok', () => {
  assert.equal(parseReport('').ok, false)
  assert.equal(parseReport('hello world').report, null)
  const broken = parseReport(SAMPLE.replace('#44174 27 58.7% ৳20,789.00', '#44174'))
  assert.equal(broken.ok, false)
  assert.ok(broken.errors.some(e => e.includes('11450821')))
  const twice = parseReport(SAMPLE.replace('#11451178', '#11450821'))
  assert.equal(twice.ok, false)
  assert.ok(twice.errors.some(e => e.includes('দুইবার')))
  const noCharge = parseReport(SAMPLE.replace('DELIVERY CHARGES PAID ৳230.00\n', ''))
  assert.equal(noCharge.ok, false)
})

test('paisa are added exactly', () => {
  const r = parseReport(SAMPLE.replace('৳20,789.00', '৳20,789.10').replace('৳44,054.00', '৳44,054.20').replace('৳332,668.00', '৳332,668.30'))
  assert.equal(r.ok, true)
  assert.equal(r.sums.amount, 332438.3)
})
