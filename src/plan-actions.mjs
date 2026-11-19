/**
 * Agent-facing actions over the Home data: planner items (tasks and events),
 * habits, and the Notes card.
 *
 * Pure functions over the home service interface — the same atomic planner ops
 * the UI sends, so a browser window and an agent never overwrite each other.
 *
 * Service interface: `getPlanner()`, `applyPlanner(op)`, `getNote()`, `setNote(text)`.
 *
 * @module @vlln/dsh-home/plan-actions
 */

import { dayKey, validDay, validTime } from './planner.mjs'

/** The Notes card stores at most 8 KiB of text (same budget as the client). */
export const NOTES_MAX_BYTES = 8 * 1024

const ITEM_KEYS = ['kind', 'title', 'day', 'start', 'end', 'priority', 'note']

/**
 * Read the current planner document.
 * @param service home service
 * @returns `{ doc, storage }`
 */
function readPlanner(service) {
  const snapshot = service.getPlanner()
  const doc = snapshot?.planner
  if (doc === undefined || !Array.isArray(doc.items)) throw new Error('the Home planner is unavailable')
  return { doc, storage: snapshot.storage }
}

/**
 * Apply one planner operation and return the resulting document.
 * @param service home service
 * @param op planner operation
 * @returns the updated planner document
 */
function writePlanner(service, op) {
  const snapshot = service.applyPlanner(op)
  return snapshot?.planner ?? snapshot
}

/**
 * Find an item by id or fail loudly — the model should retry with a real id
 * instead of silently "updating" nothing.
 * @param doc planner document
 * @param id item id
 * @returns the matching item
 */
function findItem(doc, id) {
  if (typeof id !== 'string' || id === '') throw new Error('id is required')
  const item = doc.items.find(entry => entry.id === id)
  if (item === undefined) throw new Error(`no item ${JSON.stringify(id)}`)
  return item
}

/**
 * Find a habit by id or fail loudly.
 * @param doc planner document
 * @param id habit id
 * @returns the matching habit
 */
function findHabit(doc, id) {
  if (typeof id !== 'string' || id === '') throw new Error('id is required')
  const habit = doc.habits.find(entry => entry.id === id)
  if (habit === undefined) throw new Error(`no habit ${JSON.stringify(id)}`)
  return habit
}

/** Local day key for a timestamp. */
function today(now) {
  return dayKey(now ?? Date.now())
}

/** The day before a `YYYY-MM-DD` key, in the host's local timezone. */
function previousDay(day) {
  const date = new Date(`${day}T12:00:00`)
  date.setDate(date.getDate() - 1)
  return dayKey(date.getTime())
}

/** Consecutive marked days ending at `day`. */
function streak(habit, day) {
  let count = 0
  let cursor = day
  while (habit.marks?.[cursor] === true) {
    count += 1
    cursor = previousDay(cursor)
  }
  return count
}

/** One line per item; bounded so a long list cannot flood the transcript. */
function formatItem(item) {
  const mark = item.done === true ? '[x]' : '[ ]'
  const kind = item.kind === 'event' ? 'event' : 'task'
  const time = item.start === null ? '' : ` ${item.start}${item.end === null ? '' : `-${item.end}`}`
  const when = item.day === null ? '' : ` ${item.day}${time}`
  const priority = item.priority === 0 ? '' : ` p${item.priority}`
  const note = item.note === '' ? '' : ` — ${item.note.length > 80 ? `${item.note.slice(0, 77)}…` : item.note}`
  return `${mark} ${item.id} ${kind}: ${item.title}${when}${priority}${note}`
}

/** Parse `"1,3,5"` into weekday numbers; empty means every day. */
function parseWeekdays(value) {
  if (value === undefined || value === null || value === '') return null
  const numbers = String(value).split(',').map(part => Number(part.trim()))
  if (numbers.some(number => !Number.isInteger(number) || number < 1 || number > 7)) {
    throw new Error('weekdays must list 1..7 separated by commas')
  }
  return numbers
}

/** Pick the item fields the caller actually supplied. */
function itemFields(args) {
  const fields = {}
  for (const key of ITEM_KEYS) if (args[key] !== undefined) fields[key] = args[key]
  return fields
}

/**
 * Read the plan: tasks and events for a day (default today), habits with their
 * marks, and the Notes text. `all` reads every unfinished item instead.
 * @param service home service
 * @param args `{ day?, all?, includeDone? }`
 * @returns compact plain-text briefing
 */
export function planRead(service, args = {}) {
  const day = args.day ?? today()
  if (!validDay(day)) throw new Error('day must be YYYY-MM-DD')
  const { doc, storage } = readPlanner(service)
  const all = args.all === true
  const includeDone = args.includeDone === true
  const items = doc.items.filter(item => (all || item.day === day) && (includeDone || item.done !== true))
  const tasks = items.filter(item => item.kind !== 'event')
  const events = items.filter(item => item.kind === 'event')
  const lines = [`Plan for ${day}${all ? ' (all open items)' : ''}${storage?.writable === false ? ' [read-only]' : ''}`]
  lines.push('Tasks:', ...(tasks.length === 0 ? ['(none)'] : tasks.map(formatItem)))
  lines.push('Events:', ...(events.length === 0 ? ['(none)'] : events.map(formatItem)))
  const habits = doc.habits.map(habit => {
    const marked = habit.marks?.[day] === true
    const weekdays = habit.weekdays === null ? '' : ` (days ${habit.weekdays.join(',')})`
    const run = streak(habit, day)
    return `- [${marked ? 'x' : ' '}] ${habit.id} ${habit.title}${weekdays}${run > 0 ? ` streak ${run}` : ''}`
  })
  lines.push('Habits:', ...(habits.length === 0 ? ['(none)'] : habits))
  const note = typeof service.getNote === 'function' ? service.getNote() : ''
  lines.push('Notes:', note === '' ? '(empty)' : note)
  return lines.join('\n')
}

/**
 * Create, update, close or delete a task or an event.
 * @param service home service
 * @param args action plus item fields
 * @returns one-line result
 */
export function planItem(service, args = {}) {
  const action = args.action
  if (action === 'add') {
    if (args.title === undefined || args.title === '') throw new Error('title is required for add')
    const doc = writePlanner(service, { op: 'item.create', item: itemFields(args) })
    const created = doc.items.at(-1)
    return `Created ${created.kind} ${created.id}: ${created.title}${created.day === null ? '' : ` on ${created.day}`}`
  }
  if (action === 'update') {
    const defined = itemFields(args)
    if (Object.keys(defined).length === 0) throw new Error('nothing to update')
    const { doc } = readPlanner(service)
    const current = findItem(doc, args.id)
    writePlanner(service, { op: 'item.update', id: args.id, patch: defined })
    return `Updated ${args.id}: ${defined.title ?? current.title}`
  }
  if (action === 'done') {
    const { doc } = readPlanner(service)
    const current = findItem(doc, args.id)
    const done = args.done !== false
    writePlanner(service, { op: 'item.toggle', id: args.id, done })
    return `${done ? 'Closed' : 'Reopened'} ${args.id}: ${current.title}`
  }
  if (action === 'delete') {
    const { doc } = readPlanner(service)
    const current = findItem(doc, args.id)
    writePlanner(service, { op: 'item.delete', id: args.id })
    return `Deleted ${args.id}: ${current.title}`
  }
  throw new Error('action must be add, update, done or delete')
}

/**
 * Find one item by exact title. Two matches need an id: silently picking one
 * would move or close the wrong thing.
 * @param items - planner items.
 * @param title - exact title.
 * @param options.openOnly - ignore completed items.
 * @returns the item, or null when nothing matches.
 */
function findByTitle(items, title, { openOnly }) {
  const matches = items.filter(item => item.title === title && (!openOnly || item.done !== true))
  if (matches.length === 0) return null
  if (matches.length > 1) throw new Error(`several items are titled ${JSON.stringify(title)}; pass id instead`)
  return matches[0]
}

/**
 * Resolve the pause target: by id, by exact open title, or a fresh task title.
 * @param service home service
 * @param args pause arguments
 * @param day - validated resume day
 * @returns the item after rescheduling
 */
function rescheduleForPause(service, args, day) {
  const hasId = typeof args.id === 'string' && args.id !== ''
  const title = typeof args.title === 'string' ? args.title.trim() : ''
  if (!hasId && title === '') throw new Error('pause needs id or title')
  if (hasId) {
    const { doc } = readPlanner(service)
    findItem(doc, args.id)
    writePlanner(service, { op: 'item.update', id: args.id, patch: { day } })
    const { doc: next } = readPlanner(service)
    return findItem(next, args.id)
  }
  const { doc } = readPlanner(service)
  const existing = findByTitle(doc.items, title, { openOnly: true })
  if (existing !== null) {
    writePlanner(service, { op: 'item.update', id: existing.id, patch: { day } })
    return { ...existing, day }
  }
  const next = writePlanner(service, { op: 'item.create', item: { title, day } })
  return next.items.at(-1)
}

/**
 * Add (or refresh) the calendar mark for a paused task. A named time becomes a
 * "Продолжить: …" event without an end: the time block starts there, and no
 * duration was asked for.
 * @param service home service
 * @param item - the rescheduled task
 * @param day - resume day
 * @param time - optional `HH:mm`
 * @returns the event id, or null when no time was given
 */
function markResumeEvent(service, item, day, time) {
  if (time === undefined || time === null) return null
  const title = `Продолжить: ${item.title}`
  const { doc } = readPlanner(service)
  const existing = doc.items.find(entry => entry.kind === 'event'
    && entry.done !== true && entry.day === day && entry.title === title)
  if (existing !== undefined) {
    writePlanner(service, { op: 'item.update', id: existing.id, patch: { start: time } })
    return existing.id
  }
  const next = writePlanner(service, { op: 'item.create', item: { kind: 'event', title, day, start: time } })
  return next.items.at(-1).id
}

/** Pause: reschedule the task and optionally mark the resume time in the calendar. */
function pauseScenario(service, args) {
  const day = args.day
  if (!validDay(day)) throw new Error('day must be YYYY-MM-DD (the date to resume on)')
  const time = args.time ?? null
  if (time !== null && !validTime(time)) throw new Error('time must be HH:mm')
  const item = rescheduleForPause(service, args, day)
  const eventId = markResumeEvent(service, item, day, time)
  const when = time === null ? day : `${day} ${time}`
  return `Paused ${item.id}: ${item.title} until ${when}${eventId === null ? '' : ` (event ${eventId})`}`
}

/** Finish: close the task, drop its resume mark, and hand back the open plan. */
function finishScenario(service, args) {
  const hasId = typeof args.id === 'string' && args.id !== ''
  const title = typeof args.title === 'string' ? args.title.trim() : ''
  if (!hasId && title === '') throw new Error('finish needs id or title')
  const { doc } = readPlanner(service)
  const item = hasId ? findItem(doc, args.id) : findByTitle(doc.items, title, { openOnly: true })
  if (item === null) throw new Error(`no open item titled ${JSON.stringify(title)}`)
  writePlanner(service, { op: 'item.toggle', id: item.id, done: true })
  // The «Продолжить: …» event exists only as a reminder for a paused task;
  // finishing the task makes it a stale calendar mark, so remove it.
  const resumeTitle = `Продолжить: ${item.title}`
  for (const marker of doc.items) {
    if (marker.kind === 'event' && marker.done !== true && marker.title === resumeTitle) {
      writePlanner(service, { op: 'item.delete', id: marker.id })
    }
  }
  return `Closed ${item.id}: ${item.title}\n\n${planRead(service, { all: true })}`
}

/**
 * Run one composite planner scenario in a single tool call: the pause
 * (reschedule + calendar mark) or the finish (close + open-plan summary).
 * @param service home service
 * @param args `{ action, id?, title?, day?, time? }`
 * @returns one-line result, plus the open plan after `finish`
 */
export function planScenario(service, args = {}) {
  if (args.action === 'pause') return pauseScenario(service, args)
  if (args.action === 'finish') return finishScenario(service, args)
  throw new Error('action must be pause or finish')
}

/**
 * Create, update, mark or delete a habit.
 * @param service home service
 * @param args action plus habit fields
 * @returns one-line result
 */
export function planHabit(service, args = {}) {
  const action = args.action
  if (action === 'add') {
    if (args.title === undefined || args.title === '') throw new Error('title is required for add')
    const doc = writePlanner(service, {
      op: 'habit.create',
      habit: { title: args.title, weekdays: parseWeekdays(args.weekdays) },
    })
    const created = doc.habits.at(-1)
    return `Created habit ${created.id}: ${created.title}`
  }
  if (action === 'update') {
    const { doc } = readPlanner(service)
    const current = findHabit(doc, args.id)
    const patch = {}
    if (args.title !== undefined) patch.title = args.title
    if (args.weekdays !== undefined) patch.weekdays = parseWeekdays(args.weekdays)
    if (Object.keys(patch).length === 0) throw new Error('nothing to update')
    writePlanner(service, { op: 'habit.update', id: args.id, patch })
    return `Updated habit ${args.id}: ${patch.title ?? current.title}`
  }
  if (action === 'mark') {
    const day = args.day ?? today()
    if (!validDay(day)) throw new Error('day must be YYYY-MM-DD')
    const { doc } = readPlanner(service)
    const current = findHabit(doc, args.id)
    const on = args.marked !== false
    writePlanner(service, { op: 'habit.mark', id: args.id, day, on })
    return `${on ? 'Marked' : 'Unmarked'} ${args.id} for ${day}: ${current.title}`
  }
  if (action === 'delete') {
    const { doc } = readPlanner(service)
    const current = findHabit(doc, args.id)
    writePlanner(service, { op: 'habit.delete', id: args.id })
    return `Deleted habit ${args.id}: ${current.title}`
  }
  throw new Error('action must be add, update, mark or delete')
}

/**
 * Read or replace the Notes card text. The first line is the card's title.
 * @param service home service
 * @param args `{ action, text? }`
 * @returns the note text or a save confirmation
 */
export function planNote(service, args = {}) {
  const action = args.action
  if (action === 'read') return typeof service.getNote === 'function' ? service.getNote() || '(empty)' : '(empty)'
  if (action !== 'write') throw new Error('action must be read or write')
  if (typeof args.text !== 'string') throw new Error('text is required for write')
  const bytes = Buffer.byteLength(args.text, 'utf8')
  if (bytes > NOTES_MAX_BYTES) throw new Error(`note exceeds ${NOTES_MAX_BYTES} bytes (${bytes})`)
  if (typeof service.setNote !== 'function') throw new Error('the Notes card is not writable')
  service.setNote(args.text)
  return `Saved ${bytes} bytes to the Notes card`
}
