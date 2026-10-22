import { RUNTIME_MESSAGE_TYPES } from '@/shared/constants'
import type { Platform, RuntimeMessage, RuntimeResponse, VideoDraft } from '@/shared/types'
import { extractBilibiliVideoId, extractDouyinVideoId } from '@/shared/utils/video'

/** 页面支持的两类消息：提取用于添加待看列表，查询用于侧栏信息卡片展示 */
const SUPPORTED_MESSAGE_TYPES = new Set<string>([
  RUNTIME_MESSAGE_TYPES.extractVideoInfo,
  RUNTIME_MESSAGE_TYPES.queryCurrentVideo,
])

/** 构造当前页面的 VideoDraft，非视频详情页返回 undefined */
function buildCurrentDraft(platform: Platform): VideoDraft | undefined {
  const videoId =
    platform === 'bilibili'
      ? extractBilibiliVideoId(location.href)
      : extractDouyinVideoId(location.href)

  if (!videoId) return undefined

  const draft: VideoDraft = {
    platform,
    videoId,
    title: extractTitle(),
  }
  const cover = extractCover()
  if (cover) draft.cover = cover
  return draft
}

/**
 * 注册视频信息提取器：响应 background 或侧栏发来的提取/查询请求，
 * 从当前视频详情页的 URL 和 DOM 中抽取草稿数据。
 */
export function registerVideoInfoExtractor(platform: Platform): void {
  chrome.runtime.onMessage.addListener(
    (message: RuntimeMessage, _sender, sendResponse: (response: RuntimeResponse) => void) => {
      if (!SUPPORTED_MESSAGE_TYPES.has(message.type)) return false

      const draft = buildCurrentDraft(platform)
      if (!draft) {
        sendResponse({ ok: false, error: '当前页面不是有效的视频详情页' })
        return false
      }
      sendResponse({ ok: true, data: draft })
      return false
    },
  )

  // 主动上报：注入时 + SPA 导航时
  setupActiveReporting(platform)
}

/** 主动上报：注入后立即上报一次；hook SPA 导航事件持续上报 */
function setupActiveReporting(platform: Platform): void {
  let lastReportedId: string | null = null

  function report(): void {
    const draft = buildCurrentDraft(platform)
    const videoId = draft?.videoId ?? null

    // 节流：同一视频不重复上报，避免 SPA 反复触发带来的冗余广播
    if (videoId === lastReportedId) return
    lastReportedId = videoId

    void chrome.runtime.sendMessage({
      type: RUNTIME_MESSAGE_TYPES.currentVideoChanged,
      payload: draft, // 非视频页时为 undefined，通知侧栏切占位
    })
  }

  // 1) 注入后等 DOM 稳定一点再上报，避免 meta 标签尚未就位
  const initialTimer = window.setTimeout(report, 300)

  // 2) hook history.pushState / replaceState（SPA 内部导航的主要通道）
  const origPush = history.pushState.bind(history)
  const origReplace = history.replaceState.bind(history)
  history.pushState = function patchedPush(...args) {
    const ret = origPush(...args as [unknown, string, string?])
    queueMicrotask(report)
    return ret
  } as typeof history.pushState
  history.replaceState = function patchedReplace(...args) {
    const ret = origReplace(...args as [unknown, string, string?])
    queueMicrotask(report)
    return ret
  } as typeof history.replaceState

  // 3) 监听 popstate（浏览器前进/后退按钮）
  window.addEventListener('popstate', () => queueMicrotask(report))

  // 4) 页面即将卸载前取消 setTimeout，避免在销毁页面上报
  window.addEventListener('pagehide', () => {
    window.clearTimeout(initialTimer)
  })
}

/** 从页面标题提取视频标题，去掉站点后缀（如 "_哔哩哔哩_bilibili"、" - 抖音"） */
function extractTitle(): string {
  const raw = document.title
  // 匹配结尾处连续的一个或多个「分隔符+后缀」组合，如 _哔哩哔哩_bilibili 或 - 抖音
  const cleaned = raw.replace(/([-_][^-_.]+)+$/, '').trim()
  return cleaned || raw.trim()
}

/**
 * 封面 meta 标签选择器，按优先级依次尝试：
 * B 站等站点使用标准的 og:image；抖音未提供 og:image，
 * 改用自家命名的封面 meta，该标签在页面上以 name 属性承载（部分版本用 property）。
 */
const COVER_META_SELECTORS = [
  'meta[property="og:image"]',
  'meta[name="og:image"]',
  'meta[name="lark:url:video_cover_image_url"]',
  'meta[property="lark:url:video_cover_image_url"]',
]

/** 从页面的封面 meta 标签中提取封面地址 */
function extractCover(): string | undefined {
  for (const selector of COVER_META_SELECTORS) {
    const url = document.querySelector(selector)?.getAttribute('content')?.trim()
    if (url) return url
  }

  return undefined
}
