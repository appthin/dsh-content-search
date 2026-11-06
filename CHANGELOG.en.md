# Changelog

English | [中文](CHANGELOG.md)

Every notable change to this plugin is recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers follow
[Semantic Versioning](https://semver.org/).

## [1.0.1] - 2026-11-06

### Fixed

- **On DSH 0.2.2 the button stayed, but opening the panel answered
  `sidebarRight: no tab type is registered as "contentSearch"`.**
  The cause was not a renamed API but **when the registry was read**: the tab type registers into
  `ctx.sidebarRightTabs`, a service the right sidebar package provides. 1.0.0 read it once inside
  `apply`, kept `tabsReady = false` when it was not there yet, logged `tab registry is unavailable`,
  and never retried; the chip title seat was gated on that same one-shot boolean. Under DSH 0.2.1 the
  sidebar happened to activate first, so it worked by luck; 0.2.2 changed the activation order and it
  broke for good. **A race, not a compatibility break** — the same package lives or dies on 0.2.2
  depending on which side wins.
  It now uses `ctx.inject(['sidebarRightTabs'], …)`: registration waits for the service and runs when
  it arrives, and cordis disposes and replays it if the provider is replaced. Contexts without
  `ctx.inject` still register immediately. The header button never depended on the registry and keeps
  appearing either way.

## [1.0.0] - 2026-11-05

First release. What follows records what shipped — and, more usefully, **the defects live testing
pushed back** before it earned 1.0.0. Their root causes are worth more than the feature list.

### Added

- **A search button at the conversation header's right side.** It registers into
  `conversation.session.header.utilities` (order 15), on the same row as the other Session tools.
  `shell.overlay` is not used because that seat has to measure its own placement, and measuring means
  reading another plugin's DOM.
- **A search panel in the right sidebar.** Through the documented two-stage registration: the tab type
  into `ctx.sidebarRightTabs`, the body into `sidebar.right.pane.tab`, sharing one id; then
  `ctx.sidebarRight.openTab(kind)`. The panel's position is remembered per session (the Host stores it
  under `dsh.sidebar-right.v1.<sessionId>`).
- **Two search ranges.** "Loaded" scans the current event window in the browser and answers as you
  type; "Full history" goes through the Host's read-only route and covers the whole durable log. The
  default is "Loaded".
- **A yellow keyword highlight in the conversation.** Drawn with the CSS Custom Highlight API
  (`::highlight(dsh-content-search)`) without touching the conversation's DOM; user turns and
  assistant turns are treated identically.
- **Jump to a result.** `loadThrough(seq)` pages history → the nearest node by `anchorSeq` → the row by
  Chat's rendering attributes → centred scroll → a soft yellow wash that fades after 2.2 s. When no row
  is found it says so instead of pretending.
- **Selectable result text.** Every row is a `div role="button"`, not a `<button>`.
- **「Show more」.** Hovering floats a text link at the row's bottom-right; a click reveals up to 300
  characters on each side (collapsed shows 42 before / 96 after), and a second click collapses it. The
  context is sliced from the ±480-character window the Host already returned — no extra request.
- **Keyboard.** `Enter` jumps to the first result, `↑`/`↓` move between results, `Esc` clears.
- **Bilingual.** Namespace `content-search`, dictionaries in `locale/zh.json` and `locale/en.json`.

### Fixed

Defects live testing pushed back, in the order they surfaced:

- **Installed, but the button was gone.** After moving the plugin directory from a subdirectory to the
  workspace root, all three seats disappeared; reinstalling, reloading the page and toggling the
  bundle's enabled state all failed to bring them back. The root cause is on the Host:
  `ClientModuleRegistry` caches each loader entry's resolved client path for the life of the process.
  Its own comment is blunt — *"negative verdicts remain stable until restart"* — and there is no
  `pkgMeta.delete/clear` anywhere. The stale path stayed cached, so the `client.js` under the new
  directory could never be composed into the page. Two ways out: restart the desktop app, or **rename
  the package** (the package name is the loader name, and only a changed `sourceKey` is resolved
  afresh). The second takes effect immediately, and it is how this plugin rescued itself.

- **Clicking 「Full history」 froze on one line for over five minutes.** The original implementation
  paged the log backwards through `session/page`. The bug was not the algorithm but the **total lack of
  observability**: no per-page timeout, no progress, no stop button — a Host that never answers looked
  exactly like a frozen UI. After moving full history to the Host route, the fix added a 15 s per-call
  timeout, a progress line that ticks every second, and the Host's own words on failure.

- **Full history failed outright with `openAt: "never"`.** See the next section: it now uses the
  switch-free `filterEvents`.

- **The right column sometimes sprouted a horizontal scrollbar.** The cause was not "content is too
  long": `.dcs-hit` had both `width:100%` and `padding:6px 8px` without `box-sizing:border-box`, so
  every row was 16px wider than the column and, under the default `content-box`, had to overflow.
  Adding `box-sizing`, `max-width:100%`, `min-width:0` and `overflow-x:hidden` removed it.

- **The interface flickered as the pointer moved over a result.** "Show more context" used to be a flex
  child (`align-self:flex-end` plus `margin-top`), so hovering added a line, grew the row, and made it
  jump as the pointer crossed the boundary. It is now `position:absolute` at the row's bottom-right with
  `display:none` by default, reserving no layout height at all; an already-expanded row keeps its link
  visible through `.dcs-hit[data-open="true"] .dcs-hit-more` so collapsing stays reachable.

- **The real failure reason was swallowed by a generic fallback.** On a route failure the panel first
  showed the Host's own text (`error`), but the immediately following "fall back to loading older
  content" (`fallback`) overwrote it with a generic message, so all the user saw was "the API is
  unavailable". The fallback note now appends the Host's sentence, so the reason survives.

### Changed

- **Full history moved from the full-text index to a log scan.** The index
  (`sessionQuery.searchEvents`) is fast and cursor-paged, but it is *optional infrastructure*: a
  deployment configuring `openAt: "never"` throws `SESSION_QUERY_SEARCH_DISABLED` on every call. It now
  uses the inherited `sessionQuery.filterEvents`, which no configuration switch can turn off and whose
  documents carry each event's full semantic text — exactly what 「Show more」 needs. The cost is that a
  search becomes a full literal scan, slower than the index on very large sessions. That trade is
  deliberate: being able to find it matters more than finding it fast, and on some deployments the index
  does not exist at all.

- **The context expansion cap went 100 → 200 → 300 characters.** The Host window widened with it, from
  ±320 to ±480, so a 300-character expansion can still be sliced out of that window.

- **The link text went from 「Show more context」 to 「Show more」.** It reveals more text; the word
  "context" does not need to sit inside the row.

### Notes

- Read-only. The Host half registers exactly one route, `GET /api/content-search.search`: it never
  writes, never activates an Agent and never loads anything into the conversation. The plugin writes no
  profile files, installs no dependencies and never touches `cordis.patch.yml`.
- The jump depends on Chat's rendering contract (`data-chat-node-key` / `data-chat-anchor-key` /
  `data-chat-turn`). That is a rendering convention rather than public API, so the whole path
  feature-detects and degrades — if upstream changes those attributes the jump says "scrolled there but
  not rendered" rather than silently claiming success.
- The highlight covers only rendered rows; content folded away (`hidden="until-found"`) is not
  force-revealed.
