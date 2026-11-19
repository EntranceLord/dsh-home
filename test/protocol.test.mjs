// Planner protocol helpers: keyword classification of the user's own words,
// text extraction from a user message, and the advisory notice text. The turn
// guard in index.mjs is wired on top of these pure functions.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_FINISH_KEYWORDS,
  DEFAULT_PAUSE_KEYWORDS,
  classifyText,
  messageText,
  normalizeKeywords,
  noticeText,
} from '../src/protocol.mjs'

test('classifyText: pause words win over finish words', () => {
  assert.equal(classifyText('Ладно, пауза. Продолжим позже.'), 'pause')
  assert.equal(classifyText('Отложим до завтра'), 'pause')
  assert.equal(classifyText('Сделаем перерыв'), 'pause')
  assert.equal(classifyText('Готово, закрывай'), 'finish')
  assert.equal(classifyText('закончил с этим'), 'finish')
  assert.equal(classifyText('Сегодня был продуктивный день'), null)
  assert.equal(classifyText(''), null)
  assert.equal(classifyText(undefined), null)
})

test('classifyText: custom keywords replace the defaults and stay case-insensitive', () => {
  const custom = { pauseKeywords: ['замри'], finishKeywords: ['финиш'] }
  assert.equal(classifyText('Замри, потом продолжим', custom), 'pause')
  assert.equal(classifyText('Финиш!', custom), 'finish')
  assert.equal(classifyText('пауза', custom), null, 'defaults are replaced, not merged')
})

test('normalizeKeywords: blank or broken config falls back to the defaults', () => {
  assert.deepEqual(normalizeKeywords(undefined, DEFAULT_PAUSE_KEYWORDS), DEFAULT_PAUSE_KEYWORDS)
  assert.deepEqual(normalizeKeywords([], DEFAULT_PAUSE_KEYWORDS), DEFAULT_PAUSE_KEYWORDS)
  assert.deepEqual(normalizeKeywords(['  Пауза  ', 42, ''], DEFAULT_PAUSE_KEYWORDS), ['пауза'])
  assert.deepEqual(normalizeKeywords('пауза', DEFAULT_PAUSE_KEYWORDS), DEFAULT_PAUSE_KEYWORDS)
})

test('messageText: joins text parts and ignores non-text content', () => {
  assert.equal(messageText({
    role: 'user',
    content: [{ type: 'text', text: 'Первая' }, { type: 'image', url: 'x' }, { type: 'text', text: 'Вторая' }],
  }), 'Первая\nВторая')
  assert.equal(messageText({ role: 'user', content: [] }), '')
  assert.equal(messageText(null), '')
  assert.equal(messageText({ role: 'user' }), '')
})

test('noticeText: one advisory note per scenario, empty otherwise', () => {
  assert.match(noticeText('pause'), /plan_scenario action=pause/u)
  assert.match(noticeText('finish'), /plan_scenario action=finish/u)
  assert.equal(noticeText('other'), '')
  assert.notEqual(DEFAULT_PAUSE_KEYWORDS.length, 0)
  assert.notEqual(DEFAULT_FINISH_KEYWORDS.length, 0)
})
