# Changelog

[English](CHANGELOG.en.md) | 中文

本插件的全部重要变更都记录在这里。格式遵循
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循
[语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.1] - 2026-11-06

### Fixed

- **升到 DSH 0.2.2 后按钮还在，打开面板却报
  `sidebarRight: no tab type is registered as "contentSearch"`。**
  根因不是接口改名，而是**读注册表的时机**：标签类型要注册进 `ctx.sidebarRightTabs`，这个服务由
  右边栏插件提供。1.0.0 在 `apply` 里只读一次，读不到就记下 `tabsReady = false`、打印
  `tab registry is unavailable`，此后再无任何重试路径；标签体的标题席位也被同一个一次性布尔量挡住。
  DSH 0.2.1 下两个插件恰好是右边栏先激活，所以一直侥幸可用；0.2.2 的激活先后一变，就成了永久失效。
  **这是竞态，不是兼容性破坏**——同一个包在 0.2.2 上，慢一步就死、快一步就活。
  现在改成 `ctx.inject(['sidebarRightTabs'], …)`：服务没到就等，到了再注册；提供方换实例时
  Cordis 会先卸载旧注册再重跑回调。没有 `ctx.inject` 的上下文仍退回「立即注册」。
  表头按钮不依赖注册表，两种情况都照常出现。

## [1.0.0] - 2026-11-05

首个发布版。下面记的是这个版本实现了什么，以及**在它成为 1.0.0 之前被实测打回来的几处**——
那些根因比功能列表更值得读。

### Added

- **对话区右上角的搜索按钮。** 注册进 `conversation.session.header.utilities`（order 15），
  与其它会话工具同一行。不用 `shell.overlay`，因为那个席位要自己量位置，而量位置就得读别的插件的 DOM。
- **右边栏的搜索面板。** 走官方两步注册：标签类型进 `ctx.sidebarRightTabs`，标签体进
  `sidebar.right.pane.tab`，两者共用一个 id；再用 `ctx.sidebarRight.openTab(kind)` 打开。
  面板随会话记住位置（宿主把它存在 `dsh.sidebar-right.v1.<sessionId>`）。
- **两种搜索范围。** 「已加载」在浏览器内直接扫当前事件窗口，输入即出结果；
  「整段历史」走宿主只读路由，覆盖持久日志全量。默认停在「已加载」。
- **对话区关键词黄色高亮。** 用 CSS Custom Highlight API（`::highlight(dsh-content-search)`），
  不改对话 DOM；用户消息与助手回复一视同仁。
- **点结果定位。** `loadThrough(seq)` 翻历史 → 按 `anchorSeq` 找最近节点 → 按 Chat 渲染属性找行
  → 居中滚动 → 落一个淡黄底并在 2.2 秒后淡出。找不到行时明说「已翻到该位置，但这一条当前没有渲染出来」。
- **结果文字可拖选复制。** 每行是 `div role="button"`，不是 `<button>`。
- **「展开更多」。** 悬停时在行右下角**浮出**文字链接，点击前后各多最多 300 字（收起态前 42 后 96），
  再点变「收起」。上下文从宿主已经带回的 ±480 字窗口里切，不额外请求。
- **键盘。** `Enter` 跳第一个结果，`↑`/`↓` 移动，`Esc` 清空。
- **中英双语。** 命名空间 `content-search`，字典在 `locale/zh.json` 与 `locale/en.json`。

### Fixed

发布前被实测打回来的问题，按发现顺序：

- **插件装了，按钮却没了。** 把插件目录从子目录挪到工作区根之后，三个席位全部消失，
  重装、页面刷新、总开关都无效。根因在宿主：`ClientModuleRegistry` 把每个 loader 条目
  解析出的客户端路径缓存到整个进程生命周期，注释写得很直白——
  *"negative verdicts remain stable until restart"*，且代码里没有任何 `pkgMeta.delete/clear`。
  旧路径还在缓存里，新目录下的 `client.js` 自然永远不会被组合进页面。
  两条出路：重启桌面端，或**改包名**（包名＝loader 名，`sourceKey` 变了才会重新解析）。
  后者可以立即生效，本插件就是用它自救的。

- **点「整段历史」后一行「正在读取整段历史…」卡五分多钟。** 当初的实现逐页调
  `session/page` 把日志往回翻。问题不在算法而在**没有任何可观测性**：没有单页超时、没有进度、
  没有停止按钮，宿主不答就等于界面冻结。改成整段历史走宿主路由后，又补上 15 秒单次超时、
  每秒刷新的进度行、失败时的宿主原话。

- **整段历史直接报 `openAt: "never"`。** 见下一节：改用不带开关的 `filterEvents`。

- **右边栏时而冒出横向滚动条。** 根因不是「内容太长」：`.dcs-hit` 同时有 `width:100%` 和
  `padding:6px 8px`，却没有 `box-sizing:border-box`，于是每行都比栏宽多 16px，
  在默认的 `content-box` 下必然溢出。补上 `box-sizing`、`max-width:100%`、`min-width:0`
  与 `overflow-x:hidden` 后消失。

- **鼠标移到结果项上界面会闪。** 原先「展开更多上下文」是 flex 布局里的一个子元素
  （`align-self:flex-end` + `margin-top`），悬停时它把行撑高一行，指针一进一出就抖。
  改成 `position:absolute` 浮在行右下角、默认 `display:none`，不再占任何布局高度；
  已展开的行额外用 `.dcs-hit[data-open="true"] .dcs-hit-more` 保持链接可见，免得展开后点不到收起。

- **失败原因被兜底文案吞掉。** 路由失败后界面先显示宿主原话（`error` 状态），
  但紧接着的「退回加载更早内容」（`fallback` 状态）会用一句通用提示盖掉它，
  于是用户只看到「摘要接口不可用」。现在 fallback 的提示行拼上宿主那句话，原因不再丢失。

### Changed

- **整段历史从全文索引改为日志扫描。** 索引服务（`sessionQuery.searchEvents`）快、能游标分页，
  但它是**可选基础设施**：部署把 `openAt` 配成 `never` 时每次调用都抛
  `SESSION_QUERY_SEARCH_DISABLED`。改用继承来的 `sessionQuery.filterEvents`——没有开关能关掉它，
  且每份文档带事件的完整语义文本，正好供「展开更多」使用。代价是每次搜索变为一次全量字面扫描，
  在超大会话上第一页比索引慢。这是刻意的取舍：能搜到比搜得快重要，而索引在某些部署上根本不存在。

- **上下文展开上限 100 → 200 → 300 字。** 宿主侧窗口同步从 ±320 加宽到 ±480，
  保证展开 300 字仍能从这个窗口里切出来。

- **展开链接文案 展开更多上下文 → 展开更多。** 它只是「多看点」，不必把「上下文」三个字顶在行里。

### Notes

- 只读。宿主半边只注册一条 `GET /api/content-search.search` 路由：不写、不激活 Agent、
  不往对话里塞任何东西。插件不写 profile 文件、不装依赖、不读写 `cordis.patch.yml`。
- 定位依赖 Chat 的渲染契约（`data-chat-node-key` / `data-chat-anchor-key` / `data-chat-turn`）。
  那是渲染约定而非公开 API，所以全程做了特性检测与降级，上游一改就退化成「已翻到但没渲染出来」，
  不会静默假成功。
- 高亮只覆盖已经渲染的行；折叠收起（`hidden="until-found"`）的内容不会被强行点亮。
