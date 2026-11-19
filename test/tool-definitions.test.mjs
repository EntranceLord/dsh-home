// Tool wiring: the official defineTool helper is injected, so a stub captures
// each definition and exercises its execute body against the fake service.
import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyPlanner, applyPlannerOp } from '../src/planner.mjs'
import { planToolDefinitions } from '../src/tool-definitions.mjs'

const NOW = new Date(2026, 10, 19, 12, 0, 0).getTime()

function service() {
  let doc = emptyPlanner()
  let note = ''
  let seq = 0
  return {
    getPlanner: () => ({ planner: doc, storage: { writable: true, status: 'ok' } }),
    applyPlanner(op) {
      const { doc: next } = applyPlannerOp(doc, op, { now: NOW, makeId: () => `t${++seq}` })
      doc = next
      return { planner: doc, storage: { writable: true, status: 'ok' } }
    },
    getNote: () => note,
    setNote: value => { note = value; return value },
  }
}

function stubDefineTool(spec) {
  return spec
}

function toolsWithAction(definitions) {
  return definitions.filter(definition => definition.parameters.action !== undefined)
}

test('four plan tools with stable names and text output', () => {
  const definitions = planToolDefinitions(stubDefineTool, service())
  assert.deepEqual(definitions.map(definition => definition.name), ['plan_read', 'plan_item', 'plan_habit', 'plan_note'])
  for (const definition of definitions) {
    assert.equal(typeof definition.description, 'string')
    assert.equal(definition.output.schema.type, 'string')
    assert.equal(typeof definition.execute, 'function')
    assert.equal(typeof definition.parameters, 'object')
  }
  assert.equal(toolsWithAction(definitions).length, 3, 'plan_read takes no action')
})

test('tool execute bodies drive the real planner ops', async () => {
  const tools = Object.fromEntries(planToolDefinitions(stubDefineTool, service()).map(definition => [definition.name, definition]))
  const created = await tools.plan_item.execute({ action: 'add', title: 'Купить хлеб', day: '2026-11-19' })
  assert.match(created, /Created task it_/u)
  const briefing = await tools.plan_read.execute({ day: '2026-11-19' })
  assert.match(briefing, /Купить хлеб/u)
  const note = await tools.plan_note.execute({ action: 'write', text: 'Идея\nТекст' })
  assert.match(note, /Saved/u)
  assert.equal(await tools.plan_note.execute({ action: 'read' }), 'Идея\nТекст')
})
