// Composite planner scenarios: the pause reschedule plus its calendar mark, and
// the finish that closes the task and hands back the open plan. The fake
// service drives the real planner ops, so ids, validation and day handling are
// the same code the UI route uses.
import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyPlanner, applyPlannerOp } from '../src/planner.mjs'
import { planItem, planRead, planScenario } from '../src/plan-actions.mjs'

const NOW = new Date(2026, 10, 19, 12, 0, 0).getTime() // 2026-11-19 local noon

function makeService({ writable = true } = {}) {
  let doc = emptyPlanner()
  let seq = 0
  return {
    getPlanner: () => ({ planner: doc, storage: { writable, status: writable ? 'ok' : 'read-only' } }),
    applyPlanner(op) {
      if (!writable) throw new Error('planner is read-only')
      const { doc: next } = applyPlannerOp(doc, op, { now: NOW, makeId: () => `t${++seq}` })
      doc = next
      return { planner: doc, storage: { writable, status: 'ok' } }
    },
  }
}

function addTask(service, title, day) {
  planItem(service, { action: 'add', title, ...(day === undefined ? {} : { day }) })
  const doc = service.getPlanner().planner
  return doc.items.at(-1)
}

test('pause: reschedules the task and marks the named time in the calendar', () => {
  const service = makeService()
  const task = addTask(service, 'Починить виджет', '2026-11-19')
  const result = planScenario(service, { action: 'pause', id: task.id, day: '2026-11-20', time: '10:00' })
  assert.match(result, new RegExp(`Paused ${task.id}: Починить виджет until 2026-11-20 10:00`))
  const doc = service.getPlanner().planner
  const moved = doc.items.find(item => item.id === task.id)
  assert.equal(moved.day, '2026-11-20')
  const event = doc.items.find(item => item.kind === 'event' && item.title === 'Продолжить: Починить виджет')
  assert.equal(event.day, '2026-11-20')
  assert.equal(event.start, '10:00')
  assert.equal(event.end, null)
  assert.match(result, new RegExp(`event ${event.id}`))
})

test('pause: without a time only the task date changes', () => {
  const service = makeService()
  const task = addTask(service, 'Задача', '2026-11-19')
  planScenario(service, { action: 'pause', id: task.id, day: '2026-11-21' })
  const doc = service.getPlanner().planner
  assert.equal(doc.items.filter(item => item.kind === 'event').length, 0)
  assert.equal(doc.items.find(item => item.id === task.id).day, '2026-11-21')
})

test('pause: an exact title reuses the open task instead of duplicating it', () => {
  const service = makeService()
  addTask(service, 'Черновик письма', '2026-11-19')
  planScenario(service, { action: 'pause', title: 'Черновик письма', day: '2026-11-22' })
  const doc = service.getPlanner().planner
  assert.equal(doc.items.length, 1)
  assert.equal(doc.items[0].day, '2026-11-22')
})

test('pause: an unknown title creates the task on the resume day', () => {
  const service = makeService()
  planScenario(service, { action: 'pause', title: 'Новая задача', day: '2026-11-23', time: '15:30' })
  const doc = service.getPlanner().planner
  const task = doc.items.find(item => item.kind === 'task')
  assert.equal(task.title, 'Новая задача')
  assert.equal(task.day, '2026-11-23')
  const event = doc.items.find(item => item.kind === 'event')
  assert.equal(event.start, '15:30')
})

test('pause: repeated pauses refresh the same resume event', () => {
  const service = makeService()
  const task = addTask(service, 'Задача', '2026-11-19')
  planScenario(service, { action: 'pause', id: task.id, day: '2026-11-20', time: '10:00' })
  planScenario(service, { action: 'pause', id: task.id, day: '2026-11-20', time: '11:00' })
  const events = service.getPlanner().planner.items.filter(item => item.kind === 'event')
  assert.equal(events.length, 1)
  assert.equal(events[0].start, '11:00')
})

test('pause: rejects a missing day, a bad time and an ambiguous title', () => {
  const service = makeService()
  const task = addTask(service, 'Задача')
  assert.throws(() => planScenario(service, { action: 'pause', id: task.id }), /day must be YYYY-MM-DD/u)
  assert.throws(() => planScenario(service, { action: 'pause', id: task.id, day: '2026-11-20', time: '25:00' }), /time must be HH:mm/u)
  assert.throws(() => planScenario(service, { action: 'pause', day: '2026-11-20' }), /needs id or title/u)
  addTask(service, 'Дубль')
  addTask(service, 'Дубль')
  assert.throws(() => planScenario(service, { action: 'pause', title: 'Дубль', day: '2026-11-20' }), /several items/u)
})

test('finish: closes the task and returns the open plan', () => {
  const service = makeService()
  const task = addTask(service, 'Готовое', '2026-11-19')
  addTask(service, 'Осталось', '2026-11-20')
  const result = planScenario(service, { action: 'finish', id: task.id })
  assert.match(result, new RegExp(`Closed ${task.id}`))
  assert.match(result, /Осталось/u)
  assert.equal(result.split('Готовое').length - 1, 1, 'the closed task is named once, not listed as open')
  const doc = service.getPlanner().planner
  assert.equal(doc.items.find(item => item.id === task.id).done, true)
})

test('finish: removes the resume event pause created, leaving unrelated events', () => {
  const service = makeService()
  const task = addTask(service, 'Задача с паузой', '2026-11-19')
  planItem(service, { action: 'add', kind: 'event', title: 'Созвон', day: '2026-11-20', start: '12:00' })
  planScenario(service, { action: 'pause', id: task.id, day: '2026-11-20', time: '10:00' })
  assert.equal(service.getPlanner().planner.items.filter(item => item.kind === 'event').length, 2)
  planScenario(service, { action: 'finish', id: task.id })
  const events = service.getPlanner().planner.items.filter(item => item.kind === 'event')
  assert.deepEqual(events.map(event => event.title), ['Созвон'])
})

test('finish: resolves an exact open title and reports unknown or missing input', () => {
  const service = makeService()
  addTask(service, 'Задача', '2026-11-19')
  assert.match(planScenario(service, { action: 'finish', title: 'Задача' }), /Closed/u)
  assert.throws(() => planScenario(service, { action: 'finish', title: 'Задача' }), /no open item/u)
  assert.throws(() => planScenario(service, { action: 'finish' }), /needs id or title/u)
})

test('plan_scenario: only pause and finish are accepted, and writes honour read-only', () => {
  const service = makeService()
  assert.throws(() => planScenario(service, { action: 'brief' }), /action must be pause or finish/u)
  const readOnly = makeService({ writable: false })
  assert.throws(() => planScenario(readOnly, { action: 'pause', title: 'x', day: '2026-11-20' }), /read-only/u)
  assert.match(planRead(service, { day: '2026-11-19' }), /Plan for 2026-11-19/u)
})
