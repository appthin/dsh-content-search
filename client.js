/**
 * Content Search — browser half of the `dsh-content-search` bundle.
 *
 * Three pieces, each on a supported extension point:
 * - a search button in the conversation header's right-aligned utilities;
 * - a right-sidebar page tab (`contentSearch`) whose body is the search panel,
 *   opened through `ctx.sidebarRight.openTab`. Its type is registered through
 *   `ctx.inject(['sidebarRightTabs'], …)` because that registry is provided by
 *   the right sidebar package and may well apply after this bundle;
 * - a locator that pages the session history back to a hit's `seq`
 *   (`ISession.loadThrough`) and then scrolls the Chat row that anchors it
 *   (`[data-chat-node-key]` on the row that owns the hit's `anchorSeq`).
 *
 * Two corpora, one panel: the loaded event window (the same contiguous window
 * Chat renders, read through `ctx.sessions.binding()` and subscribed) and the
 * whole conversation history, paged from the durable log through the shipped
 * `ctx.remote.session.page` remote — the very call the built-in 「load older」
 * makes — which reads message-aligned history without activating an Agent or
 * changing the conversation window. When that channel is unavailable the walk
 * falls back to widening the loaded window with `ISession.loadOlder`. Nothing is
 * scraped from another plugin's DOM to build either corpus; only the final
 * reveal reads the rendered rows' documented anchors, with feature checks and a
 * graceful "not rendered" report when they are absent.
 *
 * No JSX, no imports beyond the browser module table's React: this is a static
 * bundle client module loaded by `window.__ModuleLoader__`.
 */

window.__ModuleLoader__.load({
  id: 'dsh-content-search',
  factory(require) {
    'use strict'

    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    /** This plugin's copy namespace. */
    const NS = 'content-search'
    /** The tab type's implementation identity; also the key its body registers under. */
    const PANEL_ID = 'dsh-content-search/panel'
    /** The page tab kind the button opens. */
    const PANEL_KIND = 'contentSearch'
    /** Where this package's own header entry sits among the header utilities. */
    const HEADER_ORDER = 15
    /** CSS Custom Highlight names (mutation-free reveal/highlight). */
    const QUERY_HIGHLIGHT = 'dsh-content-search'
    const ROW_HIGHLIGHT = 'dsh-content-search-hit'
    /** Most hits rendered for one query. */
    const MAX_RESULTS = 300
    /**
     * Whole-history search asks the Host, not the browser.
     *
     * The Client half cannot read the durable log itself: a static bundle's
     * browser half has no host RPC channel. So the Host half registers one
     * authenticated read-only route over the Host's own full-text index, and
     * this half fetches it document-relative — the same shape the shipped
     * session-log download uses.
     */
    const SEARCH_ROUTE = 'api/content-search.search'
    /** Hits requested per page; the Host clamps anything above 500. */
    const SERVER_PAGE = 200
    /** Most hits collected in one whole-history search, across pages. */
    const SERVER_MAX_HITS = 1000
    /** One request's deadline, so a silent Host shows a message, not a freeze. */
    const SEARCH_TIMEOUT_MS = 15000
    /** The `loadOlder` fallback is bounded too, with a no-progress guard. */
    const FALLBACK_MAX_LOADS = 2
    const FALLBACK_LOAD_TIMEOUT_MS = 5000
    /** Most keyword ranges painted across the conversation at once. */
    const MAX_HIGHLIGHT_RANGES = 1200
    /**
     * The keyword mark is yellow on purpose: the theme token set carries no
     * yellow alias, and a yellow keyword mark is what the request asked for.
     */
    const KEYWORD_BG = 'rgba(255, 206, 0, 0.55)'
    /** The row just jumped to gets the same yellow, softer, as a landing mark. */
    const LOCATED_BG = 'rgba(255, 206, 0, 0.18)'
    /** Context kept around a match inside a one-line snippet. */
    const SNIPPET_BEFORE = 42
    const SNIPPET_AFTER = 96
    /**
     * How much more context 「展开更多上下文」 reveals on each side.
     *
     * The Host already sends a window wide enough for this (320 characters on
     * each side, which covers the collapsed 42/96 plus these extras), so
     * widening a snippet is a pure re-slice: no extra request, no conversation
     * change.
     */
    const CONTEXT_EXTRA = 300

    const ZH = {
      openSearch: '搜索对话内容',
      panelTitle: '搜索',
      placeholder: '搜索当前对话…',
      clear: '清除',
      events: '条已加载事件',
      noResults: '没有匹配的内容',
      hint: '输入关键词后按 Enter 跳到第一个结果',
      loadingOlder: '正在加载更早的内容…',
      loadOlder: '加载更早的内容',
      located: '已定位',
      notRendered: '已翻到该位置，但这一条当前没有渲染出来',
      sessionNotReady: '当前会话还没准备好，稍后重试',
      retry: '重试',
      roleUser: '用户',
      roleAssistant: '助手',
      roleTool: '工具',
      roleDeveloper: '上下文',
      roleOther: '事件',
      more: '结果较多，仅显示前 300 条',
      scopeLoaded: '已加载',
      scopeAll: '整段历史',
      eventsAll: '条历史事件',
      readingHistory: '正在检索整段历史…',
      reload: '重新检索',
      historyHint: '命中来自宿主的整段日志，不改变对话窗口',
      historyFallback: '历史检索接口不可用，已改用「加载更早的内容」',
      historyFailed: '检索整段历史失败',
      serverHits: '条命中（整段历史）',
      loadMore: '加载更多结果',
      expandContext: '展开更多',
      collapseContext: '收起',
      itemUnit: '条',
      secondUnit: '秒',
    }

    const EN = {
      openSearch: 'Search this conversation',
      panelTitle: 'Search',
      placeholder: 'Search this conversation…',
      clear: 'Clear',
      events: 'loaded events',
      noResults: 'No matching content',
      hint: 'Type a keyword and press Enter to jump to the first result',
      loadingOlder: 'Loading older content…',
      loadOlder: 'Load older content',
      located: 'Located',
      notRendered: 'Scrolled to the position, but this entry is not rendered right now',
      sessionNotReady: 'This session is not ready yet, retrying',
      retry: 'Retry',
      roleUser: 'User',
      roleAssistant: 'Assistant',
      roleTool: 'Tool',
      roleDeveloper: 'Context',
      roleOther: 'Event',
      more: 'Many results; showing the first 300',
      scopeLoaded: 'Loaded',
      scopeAll: 'Full history',
      eventsAll: 'history events',
      readingHistory: 'Searching the whole history…',
      reload: 'Search again',
      historyHint: "Hits come from the host's complete log; the conversation window is unchanged",
      historyFallback: 'The history search API is unavailable; older content was loaded instead',
      historyFailed: 'Whole-history search failed',
      serverHits: 'hits in the whole history',
      loadMore: 'Load more results',
      expandContext: 'Show more',
      collapseContext: 'Show less',
      itemUnit: '',
      secondUnit: 's',
    }

    const CSS = `
.dcs-header-slot{display:inline-flex;align-items:center}
.dcs-icon-button{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dcs-icon-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dcs-icon-button[data-open="true"]{background:var(--dsw-alias-button-ghost-active-fill);color:var(--dsw-alias-label-primary)}
.dcs-icon-button[data-error="true"]{color:var(--dsw-alias-label-primary)}
.dcs-error-mark{position:absolute;margin:-14px 0 0 14px;font-size:10px;font-weight:700;line-height:1}
.dcs-header-slot{position:relative;display:inline-flex;align-items:center}

.dcs-root{display:flex;flex-direction:column;height:100%;min-width:0;min-height:0;padding:10px 10px 8px;gap:8px;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:13px}
.dcs-searchbox{display:flex;align-items:center;gap:6px;height:30px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary)}
.dcs-searchbox:focus-within{border-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color);color:var(--dsw-alias-label-secondary)}
.dcs-input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit}
.dcs-input::placeholder{color:var(--dsw-alias-label-caption)}
.dcs-clear{border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:15px;line-height:1;padding:0 2px}
.dcs-clear:hover{color:var(--dsw-alias-label-primary)}
.dcs-meta{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:4px 8px;min-width:0;min-height:16px;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
.dcs-meta-status{min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}
.dcs-results{flex:1;min-width:0;min-height:0;overflow-x:hidden;overflow-y:auto;display:flex;flex-direction:column;gap:2px}
.dcs-hit{position:relative;display:flex;flex-direction:column;gap:3px;width:100%;max-width:100%;min-width:0;box-sizing:border-box;text-align:left;padding:6px 8px;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;font:inherit}
.dcs-hit:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dcs-hit[data-active="true"]{background:var(--dsw-alias-interactive-bg-active)}
.dcs-hit-head{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
.dcs-badge{padding:0 5px;border-radius:4px;background:var(--dsw-alias-bg-multi-select);color:var(--dsw-alias-label-secondary)}
.dcs-snippet{display:block;max-width:100%;min-width:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;word-break:break-word;white-space:pre-wrap;cursor:text;-webkit-user-select:text;user-select:text}
.dcs-snippet[data-collapsed="true"]{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dcs-hit-more{position:absolute;right:6px;bottom:3px;display:none;padding:0 4px;border:0;border-radius:4px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-link);font-size:11px;line-height:16px;cursor:pointer;font-family:inherit;-webkit-user-select:none;user-select:none;box-shadow:0 0 6px 4px var(--dsw-alias-bg-layer-1)}
.dcs-hit:hover .dcs-hit-more,.dcs-hit[data-active="true"] .dcs-hit-more,.dcs-hit[data-open="true"] .dcs-hit-more,.dcs-hit-more:focus-visible{display:inline-block}
.dcs-hit-more:hover{text-decoration:underline}
.dcs-snippet mark{background:${KEYWORD_BG};color:inherit;border-radius:2px}
.dcs-empty{padding:12px 4px;text-align:center;color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px}
.dcs-foot{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:4px 8px;min-width:0}
.dcs-action{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;padding:3px 8px;font-size:12px;cursor:pointer;font-family:inherit}
.dcs-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dcs-action:disabled{opacity:.5;cursor:default}
.dcs-scope{display:flex;flex-wrap:wrap;gap:4px;min-width:0}
.dcs-scope-button{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;padding:2px 7px;font-size:11px;line-height:15px;cursor:pointer;font-family:inherit}
.dcs-scope-button[data-on="true"]{background:var(--dsw-alias-button-ghost-active-fill);border-color:transparent;color:var(--dsw-alias-label-primary)}
.dcs-scope-button:disabled{opacity:.5;cursor:default}
.dcs-scope-note{min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-caption);font-size:11px;line-height:15px}
::highlight(dsh-content-search){background-color:${KEYWORD_BG};color:inherit}
::highlight(dsh-content-search-hit){background-color:${LOCATED_BG}}
`

    /** Event types whose text is either noise or already covered by a projection. */
    const SKIP_TYPES = {
      'system/message': true,
      'request/header': true,
      'request/context': true,
      'session/end-seed': true,
      'turn/start': true,
      'turn/end': true,
      'step/start': true,
      'step/end': true,
      'assistant/attempt': true,
    }

    /** Keys a generic text walk never descends into. */
    const SKIP_KEYS = {
      id: true, callId: true, toolCallId: true, attachment: true, meta: true,
      usage: true, source: true, stream: true, seq: true, time: true, turn: true, step: true,
    }

    /**
     * Collect bounded text from a JSON-shaped value.
     * @param value - any event data fragment.
     * @param depth - recursion depth.
     * @param out - collected pieces, mutated in place.
     */
    function genericText(value, depth, out) {
      if (value === null || value === undefined || out.length >= 24 || depth > 4) return
      if (typeof value === 'string') {
        if (value.length > 0 && value.length <= 8000) out.push(value)
        return
      }
      if (typeof value !== 'object') return
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) genericText(value[i], depth + 1, out)
        return
      }
      const keys = Object.keys(value)
      for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i]
        if (SKIP_KEYS[key] === true) continue
        genericText(value[key], depth + 1, out)
      }
    }

    /**
     * Text one content block contributes to search.
     * @param block - an LLM content block.
     * @returns the block's searchable text, or ''.
     */
    function blockText(block) {
      if (!block || typeof block !== 'object') return ''
      if (block.type === 'text' || block.type === 'reasoning') {
        return typeof block.text === 'string' ? block.text : ''
      }
      if (block.type === 'tool-call') {
        const name = typeof block.name === 'string' ? block.name : ''
        const args = typeof block.arguments === 'string' ? block.arguments : ''
        return `${name} ${args}`.trim()
      }
      return ''
    }

    /**
     * Text a model-facing message contributes to search.
     * @param message - a message with content blocks.
     * @returns the message's joined block text.
     */
    function messageText(message) {
      if (!message || !Array.isArray(message.content)) return ''
      const parts = []
      for (let i = 0; i < message.content.length; i += 1) {
        const text = blockText(message.content[i])
        if (text) parts.push(text)
      }
      return parts.join('\n')
    }

    /**
     * Searchable text of one session event.
     * @param event - a SessionEvent.
     * @returns the text to index, or ''.
     */
    function eventText(event) {
      const type = event.type
      if (SKIP_TYPES[type] === true) return ''
      const data = event.data && typeof event.data === 'object' ? event.data : {}
      if (type === 'tool/call') {
        const name = typeof data.name === 'string' ? data.name : ''
        const args = typeof data.arguments === 'string' ? data.arguments : ''
        return `${name} ${args}`.trim()
      }
      const fromMessage = messageText(data.message)
      if (fromMessage) return fromMessage
      const direct = messageText(data)
      if (direct) return direct
      const out = []
      genericText(data, 0, out)
      return out.join('\n')
    }

    /**
     * Searchable text of a live assistant chunk.
     * @param chunk - the transient event's chunk payload.
     * @returns the chunk's text, or ''.
     */
    function liveChunkText(chunk) {
      if (chunk === null || chunk === undefined) return ''
      if (typeof chunk === 'string') return chunk
      if (typeof chunk.text === 'string') return chunk.text
      const out = []
      genericText(chunk, 0, out)
      return out.join('\n')
    }

    /**
     * Keep a bounded window of text around a match, wide enough that widening
     * the snippet later needs no extra read.
     *
     * The window holds the collapsed snippet (42 before, 96 after) plus the
     * extra `CONTEXT_EXTRA` each side that 「展开更多上下文」 reveals.
     * @param text - the document's full text.
     * @param index - the match offset in `text`.
     * @param matchLength - the matched text's length.
     * @returns the window, the match offset inside it, and the clip flags.
     */
    function contextWindow(text, index, matchLength) {
      const before = SNIPPET_BEFORE + CONTEXT_EXTRA
      const after = SNIPPET_AFTER + CONTEXT_EXTRA
      const start = Math.max(0, index - before)
      const end = Math.min(text.length, index + matchLength + after)
      return {
        text: text.slice(start, end),
        index: index - start,
        clippedStart: start > 0,
        clippedEnd: end < text.length,
      }
    }

    /**
     * Split a hit's text around its match for rendering.
     *
     * Collapsed keeps the two-line snippet; expanded reveals up to another 100
     * characters on each side, which the window already carries.
     * @param hit - the hit being rendered.
     * @param expanded - whether the row is expanded.
     * @param query - the query text in force.
     * @returns the prefix, the match and the suffix.
     */
    function snippetParts(hit, expanded, query) {
      const text = typeof hit.text === 'string' ? hit.text : ''
      const needle = typeof query === 'string' ? query.trim() : ''
      const at = typeof hit.index === 'number' ? hit.index : -1
      if (text.length === 0) return { prefix: '', match: '', suffix: '' }
      if (at < 0 || needle.length === 0) {
        return { prefix: (hit.clippedStart === true ? '…' : '') + text, match: '', suffix: '' }
      }
      const before = expanded ? SNIPPET_BEFORE + CONTEXT_EXTRA : SNIPPET_BEFORE
      const after = expanded ? SNIPPET_AFTER + CONTEXT_EXTRA : SNIPPET_AFTER
      const start = Math.max(0, at - before)
      const end = Math.min(text.length, at + needle.length + after)
      return {
        prefix: (start > 0 || hit.clippedStart === true ? '…' : '') + text.slice(start, at),
        match: text.slice(at, at + needle.length),
        suffix: text.slice(at + needle.length, end) + (end < text.length ? '…' : ''),
      }
    }

    /**
     * Map one Host hit onto the shape the panel renders.
     *
     * The Host scans the durable log and sends the surrounding text itself, so
     * the hit carries `text` plus the match's offset instead of a pre-cut
     * snippet — that is what makes widening the context a re-slice.
     * @param row - `{seq, type, time, surface, text, clippedStart, clippedEnd}`.
     * @param query - the query text in force.
     * @returns a hit.
     */
    function hitFromServer(row, query) {
      const seq = typeof row.seq === 'number' ? row.seq : 0
      const text = typeof row.text === 'string' ? row.text : ''
      const needle = query.trim().toLowerCase()
      return {
        key: `server:${String(seq)}`,
        seq,
        turn: undefined,
        type: typeof row.type === 'string' ? row.type : '',
        role: roleOf(row.type),
        live: false,
        time: typeof row.time === 'number' ? row.time : undefined,
        matches: needle.length === 0 ? 1 : Math.max(1, countMatches(text, needle)),
        text,
        index: needle.length === 0 ? -1 : text.toLowerCase().indexOf(needle),
        clippedStart: row.clippedStart === true,
        clippedEnd: row.clippedEnd === true,
      }
    }

    /**
     * Count non-overlapping occurrences of a lower-cased needle.
     * @param text - the haystack.
     * @param needle - the already lower-cased needle.
     * @returns the count, capped at 50.
     */
    function countMatches(text, needle) {
      const haystack = text.toLowerCase()
      let matches = 0
      let scan = haystack.indexOf(needle)
      while (scan >= 0 && matches < 50) {
        matches += 1
        scan = haystack.indexOf(needle, scan + needle.length)
      }
      return matches
    }

    /**
     * Read one page of whole-history hits from the Host route.
     *
     * The route is document-relative, authenticated by the page's own session
     * cookie, and read-only. A non-2xx answer carries the Host's own
     * explanation, which is surfaced to the user rather than swallowed.
     * @param text - the query text.
     * @param cursor - the opaque cursor from the previous page, if any.
     * @param sessionId - the Session to search.
     * @param signal - aborts the request.
     * @returns the page's hits and the next cursor.
     */
    async function requestServerPage(text, cursor, sessionId, signal) {
      const params = [
        `sessionId=${encodeURIComponent(String(sessionId))}`,
        `query=${encodeURIComponent(text)}`,
        `limit=${String(SERVER_PAGE)}`,
      ]
      if (cursor !== undefined) params.push(`cursor=${encodeURIComponent(cursor)}`)
      const url = `${SEARCH_ROUTE}?${params.join('&')}`
      const response = await withTimeout(
        fetch(url, { signal, headers: { accept: 'application/json' } }),
        SEARCH_TIMEOUT_MS,
        () => new Error('content-search: the Host search route did not answer in time'),
      )
      let body
      try { body = await response.json() } catch (error) { body = undefined }
      if (!response.ok) {
        const message = body !== undefined && body !== null && typeof body.error === 'string'
          ? body.error
          : `HTTP ${String(response.status)}`
        throw new Error(message)
      }
      const rows = body !== undefined && body !== null && Array.isArray(body.items) ? body.items : []
      const items = []
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]
        if (row === null || row === undefined) continue
        items.push(hitFromServer(row, text))
      }
      const nextCursor = body !== undefined && body !== null && typeof body.nextCursor === 'string'
        ? body.nextCursor
        : undefined
      return { items, nextCursor }
    }

    /** Whether the loaded window still reports older history to load. */
    function windowHasMore(binding) {
      try {
        const source = binding && binding.eventSource
        const snapshot = source && typeof source.getSnapshot === 'function' ? source.getSnapshot() : undefined
        return snapshot !== undefined && snapshot !== null && snapshot.hasMore === true
      } catch (error) {
        return false
      }
    }

    /**
     * Race one promise against a deadline so a silent host can never leave the
     * panel waiting forever.
     * @param promise - the call to bound.
     * @param ms - the deadline in milliseconds.
     * @param makeError - builds the error a timeout rejects with.
     * @returns the call's value, or a rejection.
     */
    function withTimeout(promise, ms, makeError) {
      return new Promise((resolve, reject) => {
        let settled = false
        const timer = window.setTimeout(() => {
          if (settled) return
          settled = true
          reject(makeError())
        }, ms)
        Promise.resolve(promise).then(
          value => {
            if (settled) return
            settled = true
            window.clearTimeout(timer)
            resolve(value)
          },
          error => {
            if (settled) return
            settled = true
            window.clearTimeout(timer)
            reject(error)
          },
        )
      })
    }

    /**
     * The coarse role a doc is shown as.
     * @param type - the event type.
     * @returns one of user/assistant/tool/developer/other.
     */
    function roleOf(type) {
      if (type === 'user/message') return 'user'
      if (type === 'assistant/message' || type === 'assistant/live-chunk') return 'assistant'
      if (type === 'tool/call' || type === 'tool/result') return 'tool'
      if (type === 'developer/message') return 'developer'
      return 'other'
    }

    /**
     * Build the chronological search index from the session event window.
     * @param entries - SessionEventLikeEntry rows in window order.
     * @returns one doc per searchable event.
     */
    function buildDocuments(entries) {
      const docs = []
      const settledSeqs = new Set()
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i]
        const event = entry && entry.event
        if (!event) continue
        if (entry.type === 'event') settledSeqs.add(event.seq)
      }
      let turn = 0
      let step = 0
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i]
        const event = entry && entry.event
        if (!event) continue
        const data = event.data && typeof event.data === 'object' ? event.data : {}
        if (typeof data.turn === 'number') turn = data.turn
        if (typeof data.step === 'number') step = data.step
        let text
        let live = false
        if (entry.type === 'transient') {
          if (settledSeqs.has(event.seq)) continue
          text = liveChunkText(data.chunk)
          live = true
        } else {
          text = eventText(event)
        }
        if (!text || text.trim().length === 0) continue
        docs.push({
          seq: event.seq,
          turn,
          step,
          time: event.time,
          type: live ? 'assistant/live-chunk' : event.type,
          role: roleOf(live ? 'assistant/live-chunk' : event.type),
          live,
          text,
          lower: text.toLowerCase(),
        })
      }
      return docs
    }

    /**
     * Find the hits of one query in the index.
     *
     * A hit carries the surrounding text plus the match's offset — the same
     * shape the Host route produces — so the row renders and widens identically
     * whichever scope found it.
     * @param docs - the built index.
     * @param query - the raw query.
     * @returns up to MAX_RESULTS hits in conversation order.
     */
    function searchDocuments(docs, query) {
      const needle = query.toLowerCase()
      const hits = []
      let truncated = false
      for (let i = 0; i < docs.length; i += 1) {
        const doc = docs[i]
        const index = doc.lower.indexOf(needle)
        if (index < 0) continue
        if (hits.length >= MAX_RESULTS) { truncated = true; break }
        const matches = countMatches(doc.text, needle)
        const window = contextWindow(doc.text, index, needle.length)
        hits.push({
          key: `${doc.seq}:${index}`,
          seq: doc.seq,
          turn: doc.turn,
          type: doc.type,
          role: doc.role,
          live: doc.live,
          time: doc.time,
          matches,
          text: window.text,
          index: window.index,
          clippedStart: window.clippedStart,
          clippedEnd: window.clippedEnd,
        })
      }
      return { hits, truncated }
    }

    /**
     * Whether a click started inside the row's context link.
     *
     * The link stops propagation itself; this is the defensive half, so a
     * future markup change cannot turn 「展开更多上下文」 into a jump.
     * @param event - the click event.
     * @returns true when the target belongs to the context link.
     */
    function isInsideContextLink(event) {
      const target = event && event.target
      if (target === null || target === undefined) return false
      if (typeof target.closest === 'function') {
        try { return target.closest('[data-dcs-context]') !== null } catch (error) { return false }
      }
      let node = target
      while (node !== null && node !== undefined) {
        if (node.getAttribute !== undefined && typeof node.getAttribute === 'function'
          && node.getAttribute('data-dcs-context') !== null) return true
        node = node.parentElement
      }
      return false
    }

    /**
     * Whether the user currently has text selected, so a click that finishes a
     * drag-to-select must not navigate.
     * @returns true when a non-empty selection exists.
     */
    function hasSelection() {
      try {
        const selection = window.getSelection === undefined ? null : window.getSelection()
        if (selection === null || selection === undefined) return false
        if (typeof selection.isCollapsed === 'boolean' && selection.isCollapsed) return false
        return String(selection.toString()).length > 0
      } catch (error) {
        return false
      }
    }

    /**
     * The rendered row key that anchors a hit's sequence.
     * @param snapshot - the current ChatSnapshot, when the Chat hook is present.
     * @param hit - the selected hit.
     * @returns the node key to look for, or undefined.
     */
    function pickAnchorKey(snapshot, hit) {
      if (!snapshot || !snapshot.nodes || typeof snapshot.nodes.values !== 'function') return undefined
      let nodes
      try { nodes = snapshot.nodes.values() } catch (error) { return undefined }
      if (!nodes || nodes.length === 0) return undefined
      let best
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i]
        if (!node || typeof node.anchorSeq !== 'number') continue
        if (node.anchorSeq <= hit.seq && (best === undefined || node.anchorSeq > best.seq)) {
          best = { seq: node.anchorSeq, key: node.key }
        }
      }
      if (best !== undefined) return best.key
      if (typeof hit.turn === 'number' && snapshot.navigation && typeof snapshot.navigation.items === 'function') {
        try {
          const items = snapshot.navigation.items()
          for (let i = 0; i < items.length; i += 1) {
            if (items[i].turn === hit.turn) return items[i].anchorKey
          }
        } catch (error) { /* fall through to the first node */ }
      }
      return nodes[0].key
    }

    /**
     * Find the rendered Chat row for a node key, falling back to the turn.
     * @param key - the anchor/node key to match exactly.
     * @param turn - the hit's turn number, used when the key is absent.
     * @returns the row element, or null.
     */
    function findRow(key, turn) {
      let rows
      try { rows = document.querySelectorAll('[data-chat-flow] [data-chat-node-key]') } catch (error) { return null }
      if (rows.length === 0) return null
      if (typeof key === 'string' && key.length > 0) {
        for (let i = 0; i < rows.length; i += 1) {
          const row = rows[i]
          if (row.getAttribute('data-chat-node-key') === key) return row
          if (row.getAttribute('data-chat-anchor-key') === key) return row
        }
        for (let i = 0; i < rows.length; i += 1) {
          const row = rows[i]
          const own = row.getAttribute('data-chat-node-key')
          if (typeof own === 'string' && own.length > 0 && (own.indexOf(key) === 0 || key.indexOf(own) === 0)) return row
        }
      }
      if (typeof turn === 'number') {
        let previous
        for (let i = 0; i < rows.length; i += 1) {
          const value = Number(rows[i].getAttribute('data-chat-turn'))
          if (!Number.isFinite(value)) continue
          if (value === turn) return rows[i]
          if (value < turn && (previous === undefined || value > previous.value)) previous = { value, row: rows[i] }
        }
        if (previous !== undefined) return previous.row
      }
      return rows[0]
    }

    /**
     * The nearest scroll container that actually scrolls.
     * @param element - a rendered row.
     * @returns the scroll container, or null.
     */
    function scrollableAncestor(element) {
      let node = element.parentElement
      while (node && node !== document.body) {
        const style = window.getComputedStyle(node)
        const overflowY = style.overflowY
        if ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')
          && node.scrollHeight > node.clientHeight + 1) {
          return node
        }
        node = node.parentElement
      }
      return null
    }

    /**
     * Center one row in its own scroll container without moving outer columns.
     * @param row - the rendered Chat row.
     */
    function centerRow(row) {
      const scroller = scrollableAncestor(row)
      if (!scroller) {
        if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'center' })
        return
      }
      const rowRect = row.getBoundingClientRect()
      const scrollerRect = scroller.getBoundingClientRect()
      const top = scroller.scrollTop + (rowRect.top - scrollerRect.top) - (scroller.clientHeight - rowRect.height) / 2
      const target = Math.max(0, top)
      try {
        scroller.scrollTo({ top: target, behavior: 'smooth' })
      } catch (error) {
        scroller.scrollTop = target
      }
    }

    /** The CSS Custom Highlight registry, when the browser has one. */
    function highlightRegistry() {
      const registry = window.CSS && window.CSS.highlights
      if (!registry || typeof window.Highlight !== 'function') return undefined
      return registry
    }

    /** Every conversation flow container currently rendered. */
    function flowRoots() {
      try { return document.querySelectorAll('[data-chat-flow]') } catch (error) { return [] }
    }

    /**
     * Every text-node range under one root that matches the query.
     * @param root - the subtree to scan.
     * @param query - the raw query.
     * @param limit - the most ranges to collect.
     * @returns ranges, capped at the limit.
     */
    function queryRanges(root, query, limit) {
      const ranges = []
      if (!root || !query) return ranges
      const needle = query.toLowerCase()
      const cap = limit > 0 ? limit : 200
      let walker
      try {
        walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      } catch (error) {
        return ranges
      }
      let node = walker.nextNode()
      while (node && ranges.length < cap) {
        const parent = node.parentElement
        const tag = parent && parent.tagName ? parent.tagName.toUpperCase() : ''
        if (tag !== 'STYLE' && tag !== 'SCRIPT' && tag !== 'NOSCRIPT') {
          const text = node.nodeValue || ''
          const haystack = text.toLowerCase()
          let index = haystack.indexOf(needle)
          while (index >= 0 && ranges.length < cap) {
            const range = document.createRange()
            range.setStart(node, index)
            range.setEnd(node, index + needle.length)
            ranges.push(range)
            index = haystack.indexOf(needle, index + needle.length)
          }
        }
        node = walker.nextNode()
      }
      return ranges
    }

    /**
     * Mark every occurrence of the query across the rendered conversation, so
     * the keyword carries a yellow background in user messages and in answers
     * alike. Painting uses the CSS Custom Highlight registry and never edits
     * the rendered DOM.
     * @param query - the raw query; an empty query clears the mark.
     * @returns the number of marked ranges.
     */
    function paintQueryHighlight(query) {
      const registry = highlightRegistry()
      if (!registry) return 0
      const trimmed = (query || '').trim()
      try {
        if (!trimmed) { registry.delete(QUERY_HIGHLIGHT); return 0 }
        const ranges = []
        const roots = flowRoots()
        for (const root of roots) {
          if (ranges.length >= MAX_HIGHLIGHT_RANGES) break
          const found = queryRanges(root, trimmed, MAX_HIGHLIGHT_RANGES - ranges.length)
          for (const range of found) ranges.push(range)
        }
        if (ranges.length === 0) { registry.delete(QUERY_HIGHLIGHT); return 0 }
        registry.set(QUERY_HIGHLIGHT, new window.Highlight(...ranges))
        return ranges.length
      } catch (error) { return 0 }
    }

    /**
     * Mark the row the panel just jumped to with a soft yellow landing wash
     * that fades by itself; the keyword mark stays while the query lasts.
     * @param row - the row to reveal.
     * @param timer - a ref holding the pending cleanup.
     */
    function paintLocatedRow(row, timer) {
      const registry = highlightRegistry()
      if (!registry) return
      try {
        const range = document.createRange()
        range.selectNode(row)
        registry.set(ROW_HIGHLIGHT, new window.Highlight(range))
      } catch (error) { return }
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        try { registry.delete(ROW_HIGHLIGHT) } catch (error) { /* registry replaced */ }
      }, 2200)
    }

    /**
     * Drop both highlight names; the timer ref, when given, is cleared too.
     * @param timer - an optional ref holding the pending cleanup.
     */
    function clearHighlights(timer) {
      if (timer && timer.current) {
        window.clearTimeout(timer.current)
        timer.current = 0
      }
      const registry = highlightRegistry()
      if (!registry) return
      try {
        registry.delete(ROW_HIGHLIGHT)
        registry.delete(QUERY_HIGHLIGHT)
      } catch (error) { /* the page may have replaced the registry */ }
    }

    /** Next frame after two paints. */
    function afterPaint() {
      return new Promise(resolve => {
        if (typeof window.requestAnimationFrame !== 'function') { resolve(); return }
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
      })
    }

    /** The magnifier glyph. */
    function Magnifier(props) {
      const size = props && props.size ? props.size : 15
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true',
      },
      h('circle', { cx: '7', cy: '7', r: '4.25', stroke: 'currentColor', strokeWidth: '1.5' }),
      h('path', { d: 'M10.2 10.2 13.6 13.6', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' }))
    }

    /** ChatSnapshot identity selector. */
    function selectSnapshot(snapshot) { return snapshot }

    /**
     * Create the two components over one plugin context.
     * @param ctx - the client plugin context.
     * @returns the header button and the tab body.
     */
    function createComponents(ctx) {
      /**
       * The most recent failure to open the panel. It is kept outside React so
       * the registered header label can report it: a label thunk is re-read on
       * every projection of the slot tree, which makes the reason observable
       * without a browser console.
       */
      let openFailure = ''

      /** One error's message, defensively. */
      function messageOf(error) {
        try {
          return error && error.message !== undefined ? String(error.message) : String(error)
        } catch (inner) { return 'unknown error' }
      }

      /** Read the current session's binding without throwing. */
      function readBinding(sessionId) {
        try { return ctx.sessions.binding(sessionId) } catch (error) { return undefined }
      }

      /**
       * Resolve one client service defensively: the context `get` first, then
       * the property the providing package reflects onto the context.
       * @param name - the service name.
       * @param from - the context to read from; defaults to this plugin's own.
       * @returns the service, or undefined when it is not loaded.
       */
      function readService(name, from) {
        const source = from === undefined ? ctx : from
        let service
        try {
          if (typeof source.get === 'function') service = source.get(name)
        } catch (error) { service = undefined }
        if (service === undefined || service === null) {
          try { service = source[name] } catch (error) { service = undefined }
        }
        return service
      }

      /** The sidebar navigation face, when the right sidebar is loaded. */
      function sidebarRight() {
        return readService('sidebarRight')
      }

      /**
       * The right sidebar's tab-type registry, when it is loaded.
       * @param from - the context to read from; defaults to this plugin's own.
       */
      function tabRegistry(from) {
        return readService('sidebarRightTabs', from)
      }

      /** One translated string with a static fallback. */
      function translate(props, key) {
        if (props && typeof props.t === 'function') {
          try {
            const value = props.t(key)
            if (typeof value === 'string' && value.length > 0) return value
          } catch (error) { /* fall through */ }
        }
        return ZH[key] !== undefined ? ZH[key] : key
      }

      /** The conversation header's search button. */
      function SearchHeaderButton(props) {
        const t = key => translate(props, key)
        const sessionId = props && props.sessionId
        const [failure, setFailure] = useState('')
        const open = useMemo(() => {
          const sidebar = sidebarRight()
          if (!sidebar || typeof sidebar.tabsIn !== 'function' || sessionId === undefined) return false
          try {
            return sidebar.tabsIn(sessionId).some(tab => tab && tab.kind === PANEL_KIND)
          } catch (error) { return false }
        }, [sessionId])

        const openPanel = useCallback(() => {
          const sidebar = sidebarRight()
          if (!sidebar || typeof sidebar.openTab !== 'function') {
            const message = 'the right sidebar service is not available in this frame'
            openFailure = message
            setFailure(message)
            console.warn(`content-search: ${message}`)
            return
          }

          let tabs = -1
          try {
            tabs = sessionId !== undefined && typeof sidebar.tabsIn === 'function'
              ? sidebar.tabsIn(sessionId).length
              : -1
          } catch (error) { tabs = -2 }

          const failures = []
          try {
            sidebar.openTab(PANEL_KIND, sessionId === undefined ? undefined : { params: { sessionId } })
          } catch (error) {
            failures.push(messageOf(error))
            // The tab domain's own path needs no on-screen session surface, so
            // it still opens a tab whose session store is already adopted.
            if (sessionId !== undefined && typeof sidebar.openTabIn === 'function') {
              try {
                sidebar.openTabIn(sessionId, PANEL_KIND, { params: { sessionId } })
                failures.length = 0
              } catch (fallback) { failures.push(messageOf(fallback)) }
            }
          }

          // A restored layout can already hold this tab while the column itself
          // is collapsed; an opener that finds the tab placed changes nothing.
          // Focus and expand are what make the click visible again.
          if (sessionId !== undefined) {
            try {
              const mine = typeof sidebar.tabsIn === 'function'
                ? sidebar.tabsIn(sessionId).find(tab => tab && tab.kind === PANEL_KIND)
                : undefined
              if (mine !== undefined && mine.visible !== true && typeof sidebar.focus === 'function') sidebar.focus(mine.id)
              if (typeof sidebar.isExpanded === 'function' && sidebar.isExpanded() !== true
                && typeof sidebar.toggleExpanded === 'function') sidebar.toggleExpanded()
            } catch (error) { failures.push(messageOf(error)) }
          }

          if (failures.length === 0) {
            openFailure = ''
            setFailure('')
            return
          }
          const trace = `session=${sessionId === undefined ? 'missing' : 'ok'} tabs=${tabs} :: ${failures.join(' | ')}`
          openFailure = trace
          setFailure(trace)
          console.error('content-search: cannot open the search panel ·', trace)
        }, [sessionId])

        const title = failure === '' ? t('openSearch') : `content-search · ${failure}`

        return h('span', { className: 'dcs-header-slot' },
          h('style', null, CSS),
          h('button', {
            type: 'button',
            className: 'dcs-icon-button',
            'data-open': open ? 'true' : 'false',
            'data-error': failure === '' ? 'false' : 'true',
            title,
            'aria-label': title,
            onClick: openPanel,
          }, h(Magnifier, { size: 15 }), failure === '' ? null : h('span', { className: 'dcs-error-mark' }, '!'))
        )
      }

      /** The right sidebar's search panel. */
      function ContentSearchPanel(props) {
        const t = key => translate(props, key)
        const sessionId = props && props.sessionId
        const useChat = props && props.useChat
        const chat = useChat !== undefined ? useChat(selectSnapshot) : undefined
        const chatRef = useRef(undefined)
        chatRef.current = chat

        const [query, setQuery] = useState('')
        const [active, setActive] = useState(0)
        const [entries, setEntries] = useState([])
        const [hasMore, setHasMore] = useState(false)
        const [paging, setPaging] = useState(false)
        const [status, setStatus] = useState(undefined)
        const [attempt, setAttempt] = useState(0)
        const [scope, setScope] = useState('loaded')
        const [history, setHistory] = useState(undefined)
        const [historyRun, setHistoryRun] = useState(0)
        const [historyTick, setHistoryTick] = useState(0)
        const [openContexts, setOpenContexts] = useState({})
        const inputRef = useRef(null)
        const listRef = useRef(null)
        const highlightTimer = useRef(undefined)

        const binding = readBinding(sessionId)

        useEffect(() => {
          if (inputRef.current && typeof inputRef.current.focus === 'function') inputRef.current.focus()
        }, [])

        useEffect(() => {
          if (binding !== undefined) return undefined
          const id = window.setTimeout(() => setAttempt(value => value + 1), 400)
          return () => window.clearTimeout(id)
        }, [binding, attempt])

        useEffect(() => {
          const current = readBinding(sessionId)
          const source = current && current.eventSource
          if (!source || typeof source.getSnapshot !== 'function') {
            setEntries([])
            setHasMore(false)
            return undefined
          }
          const sync = () => {
            try {
              const snapshot = source.getSnapshot()
              setEntries(Array.isArray(snapshot.entries) ? snapshot.entries : [])
              setHasMore(snapshot.hasMore === true)
            } catch (error) { /* a torn read settles on the next notification */ }
          }
          sync()
          let unsubscribe
          try { unsubscribe = source.subscribe(sync) } catch (error) { unsubscribe = undefined }
          return () => { if (typeof unsubscribe === 'function') unsubscribe() }
        }, [sessionId, attempt])

        // Whole-history search asks the Host, not the browser.
        //
        // The Client half cannot read the durable log itself (a static bundle's
        // browser half has no host RPC channel), and paging it through the
        // shipped `session/page` remote proved unreliable in the field: the
        // call never answered, so the panel sat at 「0 页」 forever. The Host
        // half therefore registers one authenticated read-only route over the
        // Host's own full-text index; this effect fetches that route, which is
        // complete, cursor-paged and leaves the conversation window untouched.
        // Every request has a deadline and every failure prints the Host's own
        // message, so nothing can look frozen again.
        useEffect(() => {
          if (scope !== 'all') { setHistory(undefined); return undefined }
          const text = query.trim()
          if (text.length === 0) { setHistory(undefined); return undefined }
          if (sessionId === undefined) { setHistory(undefined); return undefined }
          const controller = new AbortController()
          const state = { cancelled: false }
          const deadline = Date.now() + SEARCH_TIMEOUT_MS * 2
          const publish = value => { if (!state.cancelled) setHistory(value) }
          const startedAt = Date.now()
          const run = async () => {
            publish({ status: 'loading', count: 0, startedAt, items: [], nextCursor: undefined })
            let failure
            let items
            let nextCursor
            try {
              const page = await requestServerPage(text, undefined, sessionId, controller.signal)
              if (state.cancelled) return
              items = page.items
              nextCursor = page.nextCursor
              publish({ status: 'ready', count: items.length, startedAt, items, nextCursor })
              return
            } catch (error) {
              if (state.cancelled) return
              failure = error
              console.warn('content-search: the Host search route failed', error)
            }
            // The route is the supported path; a failure is reported as itself.
            // Only then does the panel widen the loaded window, within a small
            // bound, so the user still gets older content when the index is off.
            const message = messageOf(failure)
            publish({ status: 'error', count: 0, startedAt, message })
            const current = readBinding(sessionId)
            const session = current && current.session
            if (!session || typeof session.loadOlder !== 'function') return
            let guard = 0
            while (guard < FALLBACK_MAX_LOADS && !state.cancelled
              && Date.now() < deadline && windowHasMore(readBinding(sessionId))) {
              try {
                await withTimeout(
                  session.loadOlder(),
                  FALLBACK_LOAD_TIMEOUT_MS,
                  () => new Error('content-search: loadOlder did not answer in time'),
                )
              } catch (error) { break }
              if (state.cancelled) return
              guard += 1
            }
            if (state.cancelled || guard === 0) return
            publish({ status: 'fallback', count: guard, startedAt, message })
          }
          const timer = window.setTimeout(() => { void run() }, 180)
          return () => {
            state.cancelled = true
            window.clearTimeout(timer)
            controller.abort()
          }
        }, [scope, sessionId, query, attempt, historyRun])

        // A second-by-second tick while a search runs, so the panel shows
        // elapsed time instead of looking frozen.
        const historyLoading = scope === 'all' && history !== undefined && history.status === 'loading'
        useEffect(() => {
          if (!historyLoading) return undefined
          const id = window.setInterval(() => setHistoryTick(value => value + 1), 1000)
          return () => window.clearInterval(id)
        }, [historyLoading])

        const documents = useMemo(() => buildDocuments(entries), [entries])
        const local = useMemo(() => {
          if (query.trim().length === 0) return { hits: [], truncated: false }
          return searchDocuments(documents, query.trim())
        }, [documents, query])
        const serverReady = scope === 'all' && history !== undefined
          && history.status === 'ready' && Array.isArray(history.items)
        const hits = serverReady ? history.items : local.hits
        const searched = { truncated: !serverReady && local.truncated }
        const corpus = serverReady ? history.items : documents

        useEffect(() => { setActive(0) }, [query])

        // Keep the yellow keyword mark in step with the query and with the
        // event window: typing, new turns and 「load older」 all repaint it.
        useEffect(() => {
          const id = window.setTimeout(() => { paintQueryHighlight(query) }, 130)
          return () => window.clearTimeout(id)
        }, [corpus, query])

        useEffect(() => {
          const list = listRef.current
          if (!list) return
          const item = list.querySelector(`[data-dcs-hit="${active}"]`)
          if (item && typeof item.scrollIntoView === 'function') item.scrollIntoView({ block: 'nearest' })
        }, [active, hits.length])

        const locate = useCallback(async hit => {
          setStatus({ kind: 'locating', seq: hit.seq })
          const current = readBinding(sessionId)
          const session = current && current.session
          if (session && typeof session.loadThrough === 'function') {
            try { await session.loadThrough(hit.seq) } catch (error) { /* locate may still land loaded rows */ }
          }
          await afterPaint()
          const key = pickAnchorKey(chatRef.current, hit)
          const row = findRow(key, hit.turn)
          if (!row) {
            setStatus({ kind: 'notRendered', seq: hit.seq })
            return
          }
          centerRow(row)
          paintQueryHighlight(query)
          paintLocatedRow(row, highlightTimer)
          setStatus({ kind: 'located', seq: hit.seq })
        }, [query, sessionId])

        useEffect(() => () => { clearHighlights(highlightTimer) }, [])

        const loadOlder = useCallback(async () => {
          const current = readBinding(sessionId)
          const session = current && current.session
          if (!session || typeof session.loadOlder !== 'function') return
          setPaging(true)
          try { await session.loadOlder() } catch (error) { /* the window reports its own failure */ }
          setPaging(false)
        }, [sessionId])

        /** Append the Host index's next page of hits to the whole-history list. */
        const loadMoreServerHits = useCallback(async () => {
          const text = query.trim()
          if (history === undefined || history.status !== 'ready' || typeof history.nextCursor !== 'string') return
          if (sessionId === undefined || text.length === 0) return
          const controller = new AbortController()
          setHistory(value => (value === undefined ? value : Object.assign({}, value, { status: 'loading' })))
          try {
            const page = await requestServerPage(text, history.nextCursor, sessionId, controller.signal)
            const merged = history.items.concat(page.items).slice(0, SERVER_MAX_HITS)
            setHistory({
              status: 'ready',
              count: merged.length,
              startedAt: history.startedAt,
              items: merged,
              nextCursor: page.nextCursor,
            })
          } catch (error) {
            console.warn('content-search: loading more results failed', error)
            setHistory(Object.assign({}, history, { status: 'ready', message: messageOf(error) }))
          }
        }, [history, query, sessionId])

        const onKeyDown = event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            const hit = hits[active] || hits[0]
            if (hit) void locate(hit)
            return
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            if (hits.length > 0) setActive(value => Math.min(value + 1, hits.length - 1))
            return
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            if (hits.length > 0) setActive(value => Math.max(value - 1, 0))
            return
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            setQuery('')
          }
        }

        const roleLabel = role => {
          if (role === 'user') return t('roleUser')
          if (role === 'assistant') return t('roleAssistant')
          if (role === 'tool') return t('roleTool')
          if (role === 'developer') return t('roleDeveloper')
          return t('roleOther')
        }

        const statusText = status === undefined
          ? undefined
          : status.kind === 'located'
            ? t('located')
            : status.kind === 'notRendered'
              ? t('notRendered')
              : status.kind === 'locating'
                ? '…'
                : undefined

        const historyStatus = history === undefined ? 'idle' : history.status
        const historyCount = history !== undefined && typeof history.count === 'number' ? history.count : 0
        const historyElapsed = history !== undefined && typeof history.startedAt === 'number'
          ? Math.max(0, Math.round((Date.now() - history.startedAt) / 1000))
          : 0
        const historyMessage = history !== undefined && typeof history.message === 'string' ? history.message : ''
        const canLoadMore = historyStatus === 'ready' && typeof history.nextCursor === 'string'
          && historyCount < SERVER_MAX_HITS
        const scopeNote = scope !== 'all'
          ? undefined
          : historyStatus === 'ready'
            ? t('historyHint')
            : historyStatus === 'loading'
              ? `${t('readingHistory')} ${String(historyElapsed)}${t('secondUnit')}`
              : historyStatus === 'error'
                ? `${t('historyFailed')}：${historyMessage}`
                : historyStatus === 'fallback'
                  ? `${t('historyFallback')}${historyMessage === '' ? '' : `：${historyMessage}`} · ${String(historyCount)}${t('itemUnit')}`
                  : undefined

        if (binding === undefined) {
          return h('div', { className: 'dcs-root' },
            h('style', null, CSS),
            h('div', { className: 'dcs-empty' }, t('sessionNotReady')),
            h('div', { className: 'dcs-foot' },
              h('button', {
                type: 'button', className: 'dcs-action', onClick: () => setAttempt(value => value + 1),
              }, t('retry'))))
        }

        const body = []
        if (query.trim().length === 0) {
          body.push(h('div', { key: 'hint', className: 'dcs-empty' }, t('hint')))
        } else if (hits.length === 0) {
          body.push(h('div', { key: 'none', className: 'dcs-empty' }, t('noResults')))
        } else {
          for (let i = 0; i < hits.length; i += 1) {
            const hit = hits[i]
            const expanded = openContexts[hit.key] === true
            const parts = snippetParts(hit, expanded, query)
            // The row is a div, not a button: a button swallows text selection,
            // and the user must be able to select and copy a hit's text.
            body.push(h('div', {
              key: hit.key,
              className: 'dcs-hit',
              role: 'button',
              tabIndex: 0,
              'data-dcs-hit': String(i),
              'data-active': i === active ? 'true' : 'false',
              'data-open': expanded ? 'true' : 'false',
              onClick: event => {
                if (isInsideContextLink(event)) return
                // A drag that selects text also ends in a click; jumping away
                // would lose the selection the user is trying to copy.
                if (hasSelection()) return
                setActive(i)
                void locate(hit)
              },
              onKeyDown: event => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                setActive(i)
                void locate(hit)
              },
              onMouseEnter: () => setActive(i),
            },
            h('span', { className: 'dcs-hit-head' },
              h('span', { className: 'dcs-badge' }, roleLabel(hit.role)),
              h('span', null, `#${hit.seq}`),
              hit.matches > 1 ? h('span', null, `×${hit.matches}`) : null),
            h('span', {
              className: 'dcs-snippet',
              'data-collapsed': expanded ? 'false' : 'true',
            }, parts.prefix, h('mark', null, parts.match), parts.suffix),
            h('button', {
              type: 'button',
              className: 'dcs-hit-more',
              'data-dcs-context': hit.key,
              title: expanded ? t('collapseContext') : t('expandContext'),
              onClick: event => {
                event.stopPropagation()
                setOpenContexts(previous => {
                  const next = { ...previous }
                  if (next[hit.key] === true) delete next[hit.key]
                  else next[hit.key] = true
                  return next
                })
              },
            }, expanded ? t('collapseContext') : t('expandContext'))))
          }
        }

        return h('div', { className: 'dcs-root' },
          h('style', null, CSS),
          h('div', { className: 'dcs-searchbox' },
            h(Magnifier, { size: 14 }),
            h('input', {
              ref: inputRef,
              className: 'dcs-input',
              type: 'text',
              value: query,
              placeholder: t('placeholder'),
              'aria-label': t('placeholder'),
              onChange: event => setQuery(event.target.value),
              onKeyDown,
            }),
            query.length > 0
              ? h('button', {
                type: 'button', className: 'dcs-clear', title: t('clear'), 'aria-label': t('clear'),
                onClick: () => {
                  setQuery('')
                  if (inputRef.current && typeof inputRef.current.focus === 'function') inputRef.current.focus()
                },
              }, '×')
              : null),
          h('div', { className: 'dcs-meta' },
            h('div', { className: 'dcs-scope' },
              h('button', {
                type: 'button',
                className: 'dcs-scope-button',
                'data-on': scope === 'loaded' ? 'true' : 'false',
                onClick: () => setScope('loaded'),
              }, t('scopeLoaded')),
              h('button', {
                type: 'button',
                className: 'dcs-scope-button',
                'data-on': scope === 'all' ? 'true' : 'false',
                onClick: () => setScope('all'),
              }, t('scopeAll'))),
            h('span', { className: 'dcs-meta-status' }, statusText)),
          scopeNote !== undefined ? h('div', { className: 'dcs-scope-note' }, scopeNote) : null,
          h('div', { className: 'dcs-results', ref: listRef }, body),
          h('div', { className: 'dcs-foot' },
            scope === 'all'
              ? h('span', { className: 'dcs-scope' },
                canLoadMore
                  ? h('button', {
                    type: 'button',
                    className: 'dcs-action',
                    disabled: historyStatus === 'loading',
                    onClick: () => { void loadMoreServerHits() },
                  }, t('loadMore'))
                  : null,
                h('button', {
                  type: 'button',
                  className: 'dcs-action',
                  onClick: () => { setHistoryRun(value => value + 1) },
                }, t('reload')))
              : hasMore
                ? h('button', {
                  type: 'button', className: 'dcs-action', disabled: paging, onClick: () => { void loadOlder() },
                }, paging ? t('loadingOlder') : t('loadOlder'))
                : h('span', null),
            h('span', { className: 'dcs-meta' },
              `${String(corpus.length)} ${serverReady ? t('serverHits') : t('events')}${searched.truncated ? ` · ${t('more')}` : ''}`)))
      }

      /** The tab chip's label, rendered through the locale namespace. */
      function ContentSearchTabTitle(props) {
        return h('span', null, translate(props, 'panelTitle'))
      }

      return { SearchHeaderButton, ContentSearchPanel, ContentSearchTabTitle, sidebarRight, tabRegistry, openFailureText: () => openFailure }
    }

    return {
      /** The browser services this bundle needs before it applies. */
      inject: ['slots', 'sessions', 'locale'],
      /**
       * Register the tab type and both seats.
       * @param ctx - the client plugin context.
       */
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'content-search: dictionaries')
        const t = ctx.locale.bind(NS)
        const components = createComponents(ctx)

        // Stage one: the page type. Omitting `patterns` makes it a type opened by
        // kind, which is what the header button and the guide entries do.
        //
        // The registry belongs to the right sidebar package, which may apply
        // after this bundle: reading it once here would leave the panel without
        // a type whenever that happened, and nothing would ever retry. `ctx.inject`
        // waits for the service instead, and replays this registration both when
        // the sidebar finally arrives and when it is replaced.
        const registerTabType = scope => {
          const tabs = components.tabRegistry(scope)
          if (tabs === undefined || typeof tabs.register !== 'function') {
            console.error('content-search: the right sidebar tab registry is unavailable, so the panel has no tab type to open')
            return
          }

          scope.effect(() => tabs.register({
            id: PANEL_ID,
            kind: PANEL_KIND,
            title: () => t('panelTitle'),
          }), 'content-search: tab type')

          // Stage two: the type's body and chip title under its own id. Both are
          // part of the type, so they are registered exactly when it is.
          scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
            name: 'sidebar.right.pane.tab',
            key: PANEL_ID,
            locale: NS,
          }, components.ContentSearchPanel))

          scope.slots.inject('sidebar.right.pane.tab.title', () => scope.slots.register({
            name: 'sidebar.right.pane.tab.title',
            key: PANEL_ID,
            locale: NS,
          }, components.ContentSearchTabTitle))
        }

        if (typeof ctx.inject === 'function') ctx.inject(['sidebarRightTabs'], registerTabType)
        else registerTabType(ctx)

        // The header button does not depend on the registry, so it always appears.
        ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities',
          id: 'content-search-button',
          order: HEADER_ORDER,
          locale: NS,
          label: () => {
            const failure = components.openFailureText()
            return failure === '' ? t('openSearch') : `content-search · ${failure}`
          },
        }, components.SearchHeaderButton))
      },
    }
  },
})
