/**
 * Home planner protocol shared by the injected prompt section and the turn
 * guard.
 *
 * The section text is static on purpose: dynamic prompt text rewrites the
 * prefix on every step and loses KV-cache reuse. The guard classifies only the
 * user's own words and injects an advisory note; it never writes to the
 * planner itself, so a false positive costs one short message instead of a
 * wrong write.
 *
 * @module @vlln/dsh-home/protocol
 */

/** Section name and placement: after first-party guidance, before the environment suffix. */
export const PROTOCOL_SECTION_NAME = 'dsh-home:planner-protocol'

/** Numeric section order (first-party environment sections start at 10000). */
export const PROTOCOL_SECTION_ORDER = 9500

/** Static model-facing protocol text. */
export const PROTOCOL_TEXT = [
  '## Home planner',
  'Рабочие задачи и планы живут в Home: карточки To-do, Calendar, Habits и Notes. Держи их актуальными инструментами plan_*; Notes — общая память между сессиями (фокус, что сделано, что дальше), поэтому после паузы или завершения работы обновляй её коротко.',
  '- «пауза», «отложим», «перерыв»: одной строкой уточни срок (дату; время — если пользователь его назвал), затем вызови plan_scenario action=pause с day (YYYY-MM-DD) и time, когда он есть. Инструмент перенесёт задачу и создаст событие «Продолжить: …» на названное время.',
  '- «готово», «закрывай», «закончил»: вызови plan_scenario action=finish с id или точным title задачи. В ответе придёт сводка открытого — по ней предложи, чем продолжить, и спроси, продолжаем ли в этом чате или в новом.',
  'Не придумывай задачи: создавай только то, о чём попросил пользователь, или явный следующий шаг текущей работы.',
].join('\n')

/** Default pause triggers (case-insensitive substrings). */
export const DEFAULT_PAUSE_KEYWORDS = ['пауз', 'отлож', 'перерыв', 'на сегодня хватит', 'продолжим позже']

/** Default completion triggers (case-insensitive substrings). */
export const DEFAULT_FINISH_KEYWORDS = ['готово', 'закрыва', 'закончил', 'завершил', 'сделали', 'закруглил']

/**
 * Normalize a configured keyword list; an empty or broken list falls back to
 * the defaults instead of silently disabling the guard.
 * @param value - configured list, possibly absent.
 * @param fallback - built-in keywords.
 * @returns lowercased non-empty keywords.
 */
export function normalizeKeywords(value, fallback) {
  if (!Array.isArray(value)) return [...fallback]
  const words = value
    .filter(word => typeof word === 'string' && word.trim() !== '')
    .map(word => word.trim().toLowerCase())
  return words.length === 0 ? [...fallback] : words
}

/**
 * Classify a user message by the planner protocol keywords.
 * @param text - joined user text of one turn.
 * @param keywords - `{ pauseKeywords, finishKeywords }`.
 * @returns `'pause'`, `'finish'`, or `null`.
 */
export function classifyText(text, { pauseKeywords = DEFAULT_PAUSE_KEYWORDS, finishKeywords = DEFAULT_FINISH_KEYWORDS } = {}) {
  const value = typeof text === 'string' ? text.toLowerCase() : ''
  if (value === '') return null
  if (pauseKeywords.some(keyword => value.includes(keyword))) return 'pause'
  if (finishKeywords.some(keyword => value.includes(keyword))) return 'finish'
  return null
}

/**
 * Extract the text parts of a `UserMessage`.
 * @param message - user-message payload from a session event.
 * @returns joined text, possibly empty.
 */
export function messageText(message) {
  if (message === null || typeof message !== 'object' || !Array.isArray(message.content)) return ''
  return message.content
    .filter(part => part !== null && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n')
    .trim()
}

/**
 * Advisory model-facing note for a missed scenario; empty for unknown kinds.
 * @param kind - `'pause'` or `'finish'`.
 * @returns notice text.
 */
export function noticeText(kind) {
  if (kind === 'pause') {
    return '[планер] В прошлом ходе прозвучала пауза, но план не менялся. Если срок уже известен — доведи это через plan_scenario action=pause (day обязателен, time — если назван). Если ты ещё уточняешь срок, ничего не делай.'
  }
  if (kind === 'finish') {
    return '[планер] В прошлом ходе работа была завершена, но план не менялся. Закрой задачу через plan_scenario action=finish (id или точный title) и предложи следующий шаг из вернувшейся сводки открытого.'
  }
  return ''
}
