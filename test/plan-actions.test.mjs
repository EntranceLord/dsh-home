// Agent plan actions: pure functions over the home service. The fake service
// drives the real planner ops, so validation, defaults and id generation are
// the same code the UI route uses.
import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyPlanner, applyPlannerOp } from '../src/planner.mjs'
import { NOTES_MAX_BYTES, planHabit, planItem, planNote, planRead } from '../src/plan-actions.mjs'

const NOW = new Date(2026, 10, 19, 12, 0, 0).getTime() // 2026-11-19 local noon

function makeService({ writable = true, note = '' } = {}) {
  let doc = emptyPlanner()
  let text = note
  let seq = 0
  return {
    getPlanner: () => ({ planner: doc, storage: { writable, status: writable ? 'ok' : 'read-only' } }),
    applyPlanner(op) {
      if (!writable) throw new Error('planner is read-only')
      const { doc: next } = applyPlannerOp(doc, op, { now: NOW, makeId: () => `t${++seq}` })
      doc = next
      return { planner: doc, storage: { writable, status: 'ok' } }
    },
    getNote: () => text,
    setNote: value => { text = value; return value },
  }
}

test('plan_item: add, close, reopen, delete', () => {
  const service = makeService()
  assert.match(planItem(service, { action: 'add', title: 'Купить хлеб', day: '2026-11-19' }), /Created task it_/)
  const briefing = planRead(service, { day: '2026-11-19' })
  assert.match(briefing, /Купить хлеб/)
  const id = /it_\w+/u.exec(briefing)[0]
  assert.match(planItem(service, { action: 'done', id }), /Closed/u)
  assert.doesNotMatch(planRead(service, { day: '2026-11-19' }), /Купить хлеб/u)
  assert.match(planRead(service, { day: '2026-11-19', includeDone: true }), /\[x\]/u)
  assert.match(planItem(service, { action: 'done', id, done: false }), /Reopened/u)
  assert.match(planItem(service, { action: 'delete', id }), /Deleted/u)
  assert.doesNotMatch(planRead(service, { day: '2026-11-19' }), /Купить хлеб/u)
})

test('plan_item: an event requires a day, tasks do not', () => {
  const service = makeService()
  assert.throws(() => planItem(service, { action: 'add', kind: 'event', title: 'Созвон' }), /an event requires a day/u)
  assert.match(planItem(service, {
    action: 'add', kind: 'event', title: 'Созвон', day: '2026-11-19', start: '10:00', end: '11:00',
  }), /Created event/u)
})

test('plan_item: update applies a patch and rejects an empty patch', () => {
  const service = makeService()
  planItem(service, { action: 'add', title: 'Задача' })
  const id = /it_\w+/u.exec(planRead(service, { all: true }))[0]
  assert.match(planItem(service, { action: 'update', id, title: 'Новая', priority: 2 }), /Новая/u)
  assert.match(planRead(service, { all: true }), /Новая p2/u)
  assert.throws(() => planItem(service, { action: 'update', id }), /nothing to update/u)
  assert.throws(() => planItem(service, { action: 'done', id: 'it_missing' }), /no item/u)
})

test('plan_habit: add with weekdays, mark two days, streak', () => {
  const service = makeService()
  assert.match(planHabit(service, { action: 'add', title: 'Зарядка', weekdays: '1,3,5' }), /Created habit hb_/u)
  const id = /hb_\w+/u.exec(planRead(service, { day: '2026-11-19' }))[0]
  assert.match(planHabit(service, { action: 'mark', id, day: '2026-11-18' }), /Marked/u)
  assert.match(planHabit(service, { action: 'mark', id, day: '2026-11-19' }), /Marked/u)
  assert.match(planRead(service, { day: '2026-11-19' }), /\[x\] hb_\w+ Зарядка \(days 1,3,5\) streak 2/u)
  assert.match(planHabit(service, { action: 'mark', id, day: '2026-11-19', marked: false }), /Unmarked/u)
  assert.throws(() => planHabit(service, { action: 'add', title: 'x', weekdays: '9' }), /weekdays/u)
})

test('plan_note: write and read, and the 8 KiB cap', () => {
  const service = makeService()
  assert.equal(planNote(service, { action: 'read' }), '(empty)')
  assert.match(planNote(service, { action: 'write', text: 'Заголовок\nТело' }), /Saved \d+ bytes/u)
  assert.equal(planNote(service, { action: 'read' }), 'Заголовок\nТело')
  assert.throws(() => planNote(service, { action: 'write', text: 'x'.repeat(NOTES_MAX_BYTES + 1) }), /exceeds/u)
  assert.throws(() => planNote(service, { action: 'write' }), /text is required/u)
})

test('plan_read: a day filter, all mode, and the read-only marker', () => {
  const service = makeService()
  planItem(service, { action: 'add', title: 'Сегодня', day: '2026-11-19' })
  planItem(service, { action: 'add', title: 'Потом', day: '2026-11-20' })
  planItem(service, { action: 'add', title: 'Без даты' })
  const today = planRead(service, { day: '2026-11-19' })
  assert.match(today, /Сегодня/u)
  assert.doesNotMatch(today, /Потом/u)
  const all = planRead(service, { all: true })
  assert.match(all, /Потом/u)
  assert.match(all, /Без даты/u)
  const readOnly = makeService({ writable: false })
  assert.match(planRead(readOnly, { day: '2026-11-19' }), /\[read-only\]/u)
  assert.throws(() => planItem(readOnly, { action: 'add', title: 'x' }), /read-only/u)
})
