# 网页悬浮「稍后再看」按钮功能 实现方案

## Context（为什么做）

当前脚手架（Vue 3 + TS + Vite + @crxjs/vite-plugin，MV3 侧边栏扩展）已完成并验证通过，但 content script 仅输出注入日志，侧边栏也还是静态列表。
用户本次要求实现 PRD §3.4「网页快捷添加入口」：在 B 站 / 抖音域名下注入悬浮按钮，鼠标悬浮视频封面时在右上角显示「稍后再看」图标，点击后条目进入侧边栏待看列表，按钮变「已添加」态并伴随轻量 toast。

预期结果：在 B 站推荐页 / 搜索页 / 播放页、抖音网页版任意视频卡片上，悬浮封面即可一键收藏，侧边栏列表实时刷新，全程不打断浏览、不污染页面 DOM 结构。

## 已确认决策

1. **B 站本次仅写入插件本地 storage**，不调用 B 站官方稍后再看接口（官方接口联调留待后续迭代），因此本轮不涉及 cookie / CSRF / BV→aid 解析。
2. **「已添加」态为只读**，不可再次点击撤销（严格按 PRD §3.4），移除动作仍由侧边栏承担。

## 技术方案

### 数据流（单一写入方 = background）

```
页面 hover 封面
  → content script 抽取元数据（平台适配器）
  → chrome.runtime.sendMessage({ type: 'lw:add-watch-later', payload: VideoItem })
  → background 读取 STORAGE_KEYS.watchList → 合并去重 → 写回 storage
  → 返回 { ok, data: { added } }
  → 侧边栏 store 订阅 chrome.storage.onChanged 自动刷新列表
  → content script 本地 addedIds 集合更新 → 按钮切「已添加」+ toast
```

选择「content script 只上报、background 独占写入」的原因：写入逻辑集中一处，后续 B 站官方接口同步 / 回收站恢复都可复用；侧边栏刷新只依赖 storage 变更，无额外广播通道。

### 悬浮按钮的 DOM 策略（关键）

- **不改动页面 DOM 结构**：按钮 host 与 toast host 作为单例节点挂到 `document.documentElement` 上，用 `position: absolute` + `getBoundingClientRect()` 计算坐标，绝不往页面卡片里插入节点，也不给页面元素打 `position: relative` 之类的补丁。这避免了与 B 站 / 抖音的框架（Vue / React 虚拟 DOM 复用）冲突。
- **事件委托而非逐卡片绑定**：`document.addEventListener('mouseover' | 'mouseout', handler, true)`（capture，passive）。两个站点都是无限滚动 SPA，委托方式天然适配动态插入的卡片，不需要 MutationObserver。
- **目标识别基于 href 而非类名**：类名会随平台改版失效，改为从事件目标 `closest('a[href*="/video/"]')` 反查锚点，再用共享工具从 href 解析视频 id（B 站 `BV...`/`av...`，抖音 `/video/{数字}`）。标题/封面沿 `anchor.title → img.alt → 卡片 title → document.title` 兜底，封面取 `img.currentSrc || img.src`。
- **隐藏时机**：任何 `mouseover` 都重新判定——落在 fab 自身内部则保持；解析不到目标则延迟 150ms 隐藏（延时给「封面 → 按钮」的鼠标移入留出缓冲，期间新的 mouseover 会取消隐藏）。`scroll`（capture）+ `resize` 时重算坐标，避免滚动后按钮残留。
- **样式注入**：content script 直接 `import '@/content/fab.css'`，@crxjs/vite-plugin v3 默认 `injectCss: true`，会自动把该 CSS 追加进 manifest 的 `content_scripts[].css`（已核对 [index.mjs](file:///d:/laterWatch/node_modules/@crxjs/vite-plugin/dist/index.mjs#L1242-L1268)）。manifest 层注入不受页面 CSP 限制，比运行时插 `<style>` 更稳。所有类名 `lw-` 前缀 + `#lw-fab-root` / `#lw-toast-root` 作用域下书写，并显式声明 font / line-height / border 等属性，抵御两个站点的全局样式穿透。

### 新增文件

| 文件                            | 职责                                                                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/utils/video.ts`     | 纯函数：`extractBilibiliVideoId` / `extractDouyinVideoId` / `normalizeVideoUrl` / `createVideoItem` / `mergeWatchList`                         |
| `src/shared/utils/messaging.ts` | `sendRuntimeMessage<T>(type, payload)`，封装 `chrome.runtime.sendMessage` 并归一化为 `RuntimeResponse<T>`（异常 / `lastError` → `{ok:false}`） |
| `src/content/fab/targets.ts`    | `CoverTarget` 类型 + `resolveBilibiliTarget` / `resolveDouyinTarget`（纯 DOM 解析，可在 jsdom 下单测）                                         |
| `src/content/fab/state.ts`      | 纯函数：`collectAddedIds(items)`（排除回收站条目）+ `resolveFabState(addedIds, videoId)` → `{ label, disabled }`                               |
| `src/content/fab/toast.ts`      | 轻量 toast 控制器（单例 host，1.8s 自动消失，支持 normal / error 两种色调）                                                                    |
| `src/content/fab/index.ts`      | `mountWatchLaterFab(adapter)`：单例挂载、hover 委托、坐标跟随、点击上报、addedIds 同步、状态切换                                               |
| `src/content/fab.css`           | 按钮与 toast 样式，`lw-` 前缀命名空间                                                                                                          |

### 修改文件

- [src/shared/constants/index.ts](file:///d:/laterWatch/src/shared/constants/index.ts)：新增 `RUNTIME_MESSAGE_TYPES = { ping: 'ping', addWatchLater: 'lw:add-watch-later' }`，供 content / background 共享，替换 background 中的 `'ping'` 字面量。
- [src/shared/types/index.ts](file:///d:/laterWatch/src/shared/types/index.ts)：新增 `VideoDraft`（platform / videoId / title / cover）与 `AddWatchLaterResult`（`{ added: boolean }`）。
- [src/background/index.ts](file:///d:/laterWatch/src/background/index.ts)：`onMessage` 增加 `addWatchLater` 分支——校验 payload 必需字段 → `getItem` → `mergeWatchList` → `setItem` → 返回 `{ok:true,data:{added}}`；非法入参返回 `{ok:false}`。
- [src/content/bilibili/index.ts](file:///d:/laterWatch/src/content/bilibili/index.ts) / [src/content/douyin/index.ts](file:///d:/laterWatch/src/content/douyin/index.ts)：保留 `announceContentScriptReady(platform)`，追加 `mountWatchLaterFab({ platform, resolveTarget })`。
- [src/sidepanel/stores/watchlist.ts](file:///d:/laterWatch/src/sidepanel/stores/watchlist.ts)：新增 `bindStorageSync()`，订阅 `chrome.storage.onChanged` 中 `STORAGE_KEYS.watchList` 的变更并更新 `items`（`load()` / `persist()` / `setFilter()` 保持不变）。
- [src/sidepanel/App.vue](file:///d:/laterWatch/src/sidepanel/App.vue)：`onMounted` 中在 `store.load()` 后调用 `store.bindStorageSync()`。
- [tests/setup.ts](file:///d:/laterWatch/tests/setup.ts)：扩展 chrome mock——`storage.local.set()` 触发 `onChanged` 监听器（带 `newValue` / `oldValue`），并补 `onChanged.addListener/removeListener/hasListener`。**必须做**：`sidepanel-app.spec.ts` 会 mount `App.vue`，`onMounted` 里的订阅依赖该 API，否则现有用例会崩。

### 关键行为细节

- **去重键**：`VideoItem.id = \`${platform}:${videoId}\``，同一视频无论从推荐页还是播放页添加都只入库一次。
- **`mergeWatchList(items, incoming)` 语义**：同 id 且未删除 → 原样返回、`added:false`（按钮直接「已添加」）；同 id 但 `deletedAt` 非空（在回收站里）→ 用新条目替换并置顶、`added:true`（等价于顺手恢复）；不存在 → 置顶插入、`added:true`（列表按 `addedAt` 倒序）。
- **addedIds 同步**：content script 启动时读一次 `STORAGE_KEYS.watchList` 初始化集合，并监听 `chrome.storage.onChanged` 持续对齐，保证刷新页面后仍能正确显示「已添加」。
- **防重复挂载**：`document.getElementById('lw-fab-root')` 存在即直接返回（同一个页面上 B 站/抖音入口互不干扰，各自域名独立注入）。
- **标题兜底**：整理后的标题为空时用 `未命名视频`；封面缺失时不写 `cover` 字段，不影响侧边栏展示。

## 测试

- 新增 `tests/unit/video.spec.ts`：B 站 / 抖音 id 解析（含 `av` 号、相对 href、带 query 的 href、非法 href 返回 null）、`normalizeVideoUrl`、`createVideoItem` 标题兜底、`mergeWatchList` 四种分支（新增 / 重复 / 回收站内重加 / 置顶顺序）。
- 新增 `tests/unit/content-fab.spec.ts`：用 jsdom 手写 B 站卡片（`.bili-video-card` 内含 `a[href*="/video/BV1xx411c7mD"]` + `img`）与抖音卡片，断言 `resolveBilibiliTarget` / `resolveDouyinTarget` 抽取出正确的 videoId、标题、封面、定位元素；再断言 `collectAddedIds` 与 `resolveFabState` 的文案与禁用态。
- 新增 `tests/unit/storage-sync.spec.ts`：模拟一次 `storage.local.set({ [STORAGE_KEYS.watchList]: [item] })`，断言 store `visibleItems` 自动刷新（覆盖「侧边栏实时刷新」这条需求）。
- 保持既有 5 个用例通过，不修改其断言。

## 验证（端到端）

1. `npm run lint`（0 warning）→ `npm run format:check` → `npm run typecheck` → `npm run test` → `npm run build`。
2. 构建后检查 `dist/manifest.json`：两个 content script 条目的 `css` 数组里都出现 fab 样式产物；`dist/` 下存在对应 js / css 文件。
3. 手动验证：`chrome://extensions` 加载 `dist/` → 打开 B 站首页/搜索页/播放页 → 悬浮封面右上角出现「稍后再看」→ 点击后变「已添加」并弹 toast → 打开侧边栏（无需手动刷新）看到该条目 → 抖音网页版重复同样流程 → 用非 B 站/抖音站点（如 example.com）确认无任何注入。
4. 执行 build 前先停掉后台运行的 `npm run dev`（避免与 `emptyOutDir` 争用 dist 目录），验证完再恢复。

## 风险与边界

- 两个站点改版可能使 `/video/` href 结构变化：解析失败时按钮不显示（静默降级，不报错、不影响页面）。
- 抖音标题多为短文案且 `img.alt` 常为空，退化为页面标题兜底，可能与视频真实标题有偏差——这是 DOM 抓取的固有上限，PRD §3.2.2 已接受「仅保存基础元数据」。
- 不做官方接口写入，本轮无登录态 / 跨域 / CSRF 风险；后续接入时只需在 background 或 content script 增加一个提交步骤，数据流不变。
