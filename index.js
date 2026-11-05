/**
 * Host half of the content-search bundle.
 *
 * The browser half owns the button, the panel and the jumping. This half owns
 * exactly one thing the browser cannot do: reading the Session's whole durable
 * log.
 *
 * Two Host reads could serve that, and the difference decides this design:
 *
 * - `sessionQuery.searchEvents` is the full-text index. It is fast and pages
 *   with an opaque cursor, but it is *optional* infrastructure: a deployment
 *   that configures the index with `openAt: "never"` throws
 *   `SESSION_QUERY_SEARCH_DISABLED` on every call, and it only ever returns a
 *   one-line snippet — never enough text to widen the context around a hit.
 * - `sessionQuery.filterEvents` is the inherited, index-free scan. It folds the
 *   session's complete committed log into semantic documents and filters them
 *   with a literal, case-insensitive text predicate. It has no configuration
 *   switch that can turn it off, and each document carries the event's full
 *   semantic text.
 *
 * So the route scans. That keeps whole-history search working on deployments
 * where the index is disabled, and it lets the browser widen a hit's context by
 * up to 300 characters on each side without a second round trip.
 *
 * The route only reads: it never writes, never activates an Agent and never
 * loads a page into the conversation.
 */

/** Absolute registration path of the search route. */
const SEARCH_PATH = '/api/content-search.search'

/** Hits one page may carry when the caller does not choose. */
const DEFAULT_LIMIT = 100

/** Hard cap on a page, so one request can never flood the browser. */
const MAX_LIMIT = 300

/**
 * Text kept on each side of a hit.
 *
 * The panel shows a 42/96 snippet and can widen it by another 300 characters
 * each way, so 480 on each side leaves room for the widest rendering plus the
 * ellipsis without shipping a whole tool result per hit.
 */
const CONTEXT_WINDOW = 480

/** The Host services this half needs before it can serve searches. */
export const inject = ['connection']

/** Route connection shape this half reads (a subset of the Host service). */
function connectionOf(ctx) {
  try { return ctx.get('connection') } catch (error) { return undefined }
}

/**
 * Register the search route.
 * @param ctx - the Host context carrying `connection`.
 */
export function apply(ctx) {
  const connection = connectionOf(ctx)
  const register = connection && connection.fetch && typeof connection.fetch.register === 'function'
    ? connection.fetch.register.bind(connection.fetch)
    : undefined
  if (register === undefined) {
    ctx.logger?.warn?.('content-search: the Host connection service exposes no fetch route registry')
    return
  }
  ctx.effect(() => register({
    path: SEARCH_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: request => respond(ctx, request),
  }), 'content-search: session search route')
}

/**
 * Answer one GET with a page of whole-log hits.
 * @param ctx - the Host context.
 * @param request - the incoming request.
 * @returns the JSON response.
 */
async function respond(ctx, request) {
  let url
  try { url = new URL(request.url) } catch (error) { return json({ error: 'unreadable request URL' }, 400) }

  const sessionId = url.searchParams.get('sessionId')
  const query = url.searchParams.get('query')
  const cursorValue = url.searchParams.get('cursor')
  const limitValue = url.searchParams.get('limit')
  if (sessionId === null || sessionId.length === 0) return json({ error: 'missing sessionId' }, 400)
  if (query === null || query.trim().length === 0) return json({ error: 'missing query' }, 400)

  let limit = DEFAULT_LIMIT
  if (limitValue !== null && limitValue.length > 0) {
    const parsed = Number(limitValue)
    if (!Number.isFinite(parsed) || parsed < 1) return json({ error: 'invalid limit' }, 400)
    limit = Math.min(Math.floor(parsed), MAX_LIMIT)
  }

  // The cursor is an offset into the scanned hit list. It is opaque to the
  // caller by contract, so its encoding may change without notice.
  let offset = 0
  if (cursorValue !== null && cursorValue.length > 0) {
    const parsed = Number(cursorValue)
    if (!Number.isInteger(parsed) || parsed < 0) return json({ error: 'invalid cursor' }, 400)
    offset = parsed
  }

  const service = readService(ctx, 'sessionQuery')
  if (service === undefined || typeof service.filterEvents !== 'function') {
    return json({ error: 'the Host session query service is unavailable' }, 503)
  }

  let documents
  try {
    documents = await service.filterEvents(sessionId, [{ kind: 'text', text: query }])
  } catch (error) {
    // The message is the Host's own explanation. It is shown to the user, so it
    // stays the service's text rather than a generic one.
    return json({ error: messageOf(error) }, 500)
  }

  const matched = Array.isArray(documents) ? documents : []
  const items = []
  const end = Math.min(matched.length, offset + limit)
  for (let index = offset; index < end; index += 1) {
    const document = matched[index]
    if (document === null || document === undefined) continue
    items.push(projectHit(document, query))
  }

  return json({
    items,
    total: matched.length,
    nextCursor: end < matched.length ? String(end) : null,
  }, 200)
}

/**
 * Shape one semantic document into a hit carrying a window of text around the
 * first match, so the browser can render and widen it without another read.
 * @param document - one `SessionEventSearchDocument`.
 * @param query - the literal query.
 * @returns the hit.
 */
function projectHit(document, query) {
  const text = typeof document.text === 'string' ? document.text : ''
  const at = firstMatch(text, query)
  let start = 0
  let end = Math.min(text.length, CONTEXT_WINDOW * 2)
  if (at >= 0) {
    start = Math.max(0, at - CONTEXT_WINDOW)
    end = Math.min(text.length, at + query.trim().length + CONTEXT_WINDOW)
  }
  const window = text.slice(start, end)
  return {
    seq: typeof document.seq === 'number' ? document.seq : undefined,
    type: typeof document.type === 'string' ? document.type : '',
    time: typeof document.time === 'number' ? document.time : undefined,
    surface: typeof document.surface === 'string' ? document.surface : undefined,
    text: window,
    clippedStart: start > 0,
    clippedEnd: end < text.length,
  }
}

/**
 * The first case-insensitive occurrence of the query in a text.
 * @param text - the text to scan.
 * @param query - the literal query.
 * @returns the index, or -1.
 */
function firstMatch(text, query) {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return -1
  return text.toLowerCase().indexOf(needle)
}

/** One service from the Host context, or undefined. */
function readService(ctx, name) {
  try {
    const direct = ctx.get(name)
    if (direct !== undefined) return direct
  } catch (error) { /* fall through to the property */ }
  try { return ctx[name] } catch (error) { return undefined }
}

/** An error's message, defensively. */
function messageOf(error) {
  try { return error && error.message !== undefined ? String(error.message) : String(error) } catch (inner) { return 'unknown error' }
}

/**
 * One JSON response.
 * @param body - the JSON body.
 * @param status - the HTTP status.
 * @returns the response.
 */
function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}
