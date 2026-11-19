/**
 * Tool definitions for the Home planner. The `defineTool` helper comes from the
 * official @deepseek-ai/dsh-tools package, which the host injects; callers pass
 * it in so this module stays free of official imports (and unit-testable).
 *
 * @module @vlln/dsh-home/tool-definitions
 */

import { planHabit, planItem, planNote, planRead, planScenario } from './plan-actions.mjs'

/** Every tool answers with compact plain text the model can relay as-is. */
const output = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
}

/**
 * Build the tool definitions against one home service.
 * @param defineTool the official `defineTool` helper
 * @param service home service (`getPlanner`, `applyPlanner`, `getNote`, `setNote`)
 * @returns five tool definitions, ready for `ctx.tools.register`
 */
export function planToolDefinitions(defineTool, service) {
  return [
    defineTool({
      name: 'plan_read',
      description: 'Read the Home planner: tasks and events for a day (default today), habits with their check-in marks, and the Notes card. Use it to brief the user on what is planned.',
      parameters: {
        day: { type: 'string', description: 'Local date YYYY-MM-DD; defaults to today' },
        all: { type: 'boolean', description: 'Read every unfinished item instead of one day' },
        includeDone: { type: 'boolean', description: 'Include completed tasks' },
      },
      output,
      execute: async args => planRead(service, args),
    }),
    defineTool({
      name: 'plan_item',
      description: 'Create, edit, close or delete a task or a calendar event on the Home planner. Tasks may have no date; an event requires a day.',
      parameters: {
        action: { type: 'string', required: true, description: 'add | update | done | delete' },
        id: { type: 'string', description: 'Item id, for update/done/delete' },
        title: { type: 'string', description: 'Item title, required for add' },
        kind: { type: 'string', description: 'task (default) or event' },
        day: { type: 'string', description: 'Local date YYYY-MM-DD' },
        start: { type: 'string', description: 'Start time HH:mm; requires a day' },
        end: { type: 'string', description: 'End time HH:mm, later than start' },
        priority: { type: 'number', description: '0 none, 1 medium, 2 high' },
        note: { type: 'string', description: 'Free-form note, up to 2000 characters' },
        done: { type: 'boolean', description: 'For action done: true (default) closes, false reopens' },
      },
      output,
      execute: async args => planItem(service, args),
    }),
    defineTool({
      name: 'plan_scenario',
      description: 'Run one composite planner scenario atomically. pause: reschedule a task (or create it from a title) and, when a time is given, add a calendar event "Продолжить: …". finish: close the task (id or exact title) and return the open plan so the next step can be advised.',
      parameters: {
        action: { type: 'string', required: true, description: 'pause | finish' },
        id: { type: 'string', description: 'Item id, when known' },
        title: { type: 'string', description: 'Exact item title; used when id is unknown (pause creates the task if absent)' },
        day: { type: 'string', description: 'Local date YYYY-MM-DD; required for pause' },
        time: { type: 'string', description: 'HH:mm; pause only — creates the resume event at that time' },
      },
      output,
      execute: async args => planScenario(service, args),
    }),
    defineTool({
      name: 'plan_habit',
      description: 'Create, edit, mark or delete a habit on the Home planner. A mark covers one local day and feeds the streak shown on the card.',
      parameters: {
        action: { type: 'string', required: true, description: 'add | update | mark | delete' },
        id: { type: 'string', description: 'Habit id, for update/mark/delete' },
        title: { type: 'string', description: 'Habit title, required for add' },
        weekdays: { type: 'string', description: 'Comma-separated 1..7 (1 = Monday); empty means every day' },
        day: { type: 'string', description: 'Mark date YYYY-MM-DD; defaults to today' },
        marked: { type: 'boolean', description: 'For action mark: true (default) marks, false clears' },
      },
      output,
      execute: async args => planHabit(service, args),
    }),
    defineTool({
      name: 'plan_note',
      description: 'Read or replace the text of the Home Notes card. The first line becomes the card title; saving is immediate.',
      parameters: {
        action: { type: 'string', required: true, description: 'read | write' },
        text: { type: 'string', description: 'New note text, up to 8 KiB; required for write' },
      },
      output,
      execute: async args => planNote(service, args),
    }),
  ]
}

/**
 * Register the plan tools on a context that provides `tools`.
 * @param ctx scoped context with the tools service
 * @param service home service
 * @param defineTool the official `defineTool` helper
 * @returns disposer that removes every registration
 */
export function registerPlanTools(ctx, service, defineTool) {
  const disposers = planToolDefinitions(defineTool, service).map(definition => ctx.tools.register(definition))
  return () => {
    for (const dispose of disposers) if (typeof dispose === 'function') dispose()
  }
}
