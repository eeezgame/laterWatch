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

  // 抖音弹窗页（modal_id）：document.title 是用户名，og meta 也不存在，
  // 标题 / 封面需要从弹窗 DOM 中提取
  const isModal = isDouyinModalPage(platform)

  const draft: VideoDraft = {
    platform,
    videoId,
    title: (isModal ? extractDouyinModalTitle() : undefined) ?? extractTitle(),
  }
  const cover = isModal ? (extractDouyinModalCover() ?? extractCover()) : extractCover()
  if (cover) draft.cover = cover
  return draft
}

/** 判断当前是否为抖音弹窗视频页（modal_id 承载视频 ID 的用户主页 / 精选等页面） */
function isDouyinModalPage(platform: Platform): boolean {
  return platform === 'douyin' && /[?&]modal_id=\d+/.test(location.href)
}

/** 抖音弹窗视频的标题元素：data-e2e 测试钩子相对稳定，不依赖平台样式类名 */
const DOUYIN_MODAL_TITLE_SELECTOR = '[data-e2e="video-desc"]'
/** 抖音弹窗视频的封面图：模态容器内的背景封面图 */
const DOUYIN_MODAL_COVER_SELECTOR = '.modal-video-container img.backgroundCover'

/** 从抖音弹窗提取视频标题：元素文本末尾会拼接「展开 / 收起」按钮文字，需要剥离 */
function extractDouyinModalTitle(): string | undefined {
  const raw = document.querySelector(DOUYIN_MODAL_TITLE_SELECTOR)?.textContent ?? ''
  const cleaned = raw.replace(/(展开|收起)\s*$/, '').trim()
  return cleaned || undefined
}

/** 从抖音弹窗提取视频封面 */
function extractDouyinModalCover(): string | undefined {
  const img = document.querySelector(DOUYIN_MODAL_COVER_SELECTOR)
  if (!(img instanceof HTMLImageElement)) return undefined

  const url = (img.currentSrc || img.src || '').trim()
  return url || undefined
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

/** 首次上报前的等待时间，避免脚本注入时标题 / 封面 meta 尚未就位 */
const INITIAL_REPORT_DELAY = 300
/** URL 轮询间隔：内容脚本运行在隔离世界，劫持不到页面自身调用的 history API */
const URL_POLL_INTERVAL = 500
/** 导航后标题 / 封面通常晚于 URL 更新，持续观察该时长以便补报最终数据 */
const METADATA_WATCH_DURATION = 3000
/** 元信息观察的轮询间隔 */
const METADATA_POLL_INTERVAL = 200

/** 草稿指纹：视频 ID、标题、封面任一变化都视为需要重新上报 */
function draftSignature(draft: VideoDraft | undefined): string | null {
  return draft
    ? JSON.stringify([draft.platform, draft.videoId, draft.title, draft.cover ?? ''])
    : null
}

/** 主动上报：注入后上报一次；视频 ID 变化时上报，并持续补齐标题与封面 */
function setupActiveReporting(platform: Platform): void {
  /** 最近一次上报的草稿指纹，undefined 表示尚未上报过 */
  let lastSignature: string | null | undefined
  let lastHref = location.href
  let metadataTimer: number | undefined

  function report(): void {
    const draft = buildCurrentDraft(platform)
    const signature = draftSignature(draft)

    // 节流：视频 ID / 标题 / 封面都未变化时不重复广播
    if (signature === lastSignature) return
    lastSignature = signature

    void chrome.runtime.sendMessage({
      type: RUNTIME_MESSAGE_TYPES.currentVideoChanged,
      payload: draft, // 非视频页时为 undefined，通知侧栏切占位
    })
  }

  function stopMetadataWatch(): void {
    if (metadataTimer === undefined) return
    window.clearTimeout(metadataTimer)
    metadataTimer = undefined
  }

  /**
   * URL 切换后立即上报一次（视频 ID 马上反映到侧栏），
   * 再在接下来的一段时间内持续补报，直到标题 / 封面与新的视频对齐。
   * 否则 B 站 SPA 跳转时会把上一个视频的标题和封面带到新卡片上。
   */
  function watchMetadata(): void {
    stopMetadataWatch()
    const deadline = Date.now() + METADATA_WATCH_DURATION

    function tick(): void {
      report()
      if (Date.now() >= deadline) {
        metadataTimer = undefined
        return
      }
      metadataTimer = window.setTimeout(tick, METADATA_POLL_INTERVAL)
    }

    report()
    metadataTimer = window.setTimeout(tick, METADATA_POLL_INTERVAL)
  }

  /** 轮询地址栏：页面通过 pushState / replaceState 切换视频时 URL 会变化 */
  function checkUrl(): void {
    if (location.href === lastHref) return
    lastHref = location.href
    watchMetadata()
  }

  // 1) 注入后等 DOM 稳定一点再上报，避免 meta 标签尚未就位
  const initialTimer = window.setTimeout(watchMetadata, INITIAL_REPORT_DELAY)

  // 2) 轮询 URL 变化（隔离世界无法拦截页面自身的 history 调用）
  const urlTimer = window.setInterval(checkUrl, URL_POLL_INTERVAL)

  // 3) 监听 popstate（浏览器前进/后退按钮）
  window.addEventListener('popstate', checkUrl)

  // 4) 页面即将卸载前取消所有定时器，避免在销毁页面上报
  window.addEventListener('pagehide', () => {
    window.clearTimeout(initialTimer)
    window.clearInterval(urlTimer)
    stopMetadataWatch()
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
