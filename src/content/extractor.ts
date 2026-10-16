import { RUNTIME_MESSAGE_TYPES } from '@/shared/constants'
import type { Platform, RuntimeMessage, RuntimeResponse, VideoDraft } from '@/shared/types'
import { extractBilibiliVideoId, extractDouyinVideoId } from '@/shared/utils/video'

/**
 * 注册视频信息提取器：响应 background 右键菜单点击后发来的提取请求，
 * 从当前视频详情页的 URL 和 DOM 中抽取草稿数据。
 */
export function registerVideoInfoExtractor(platform: Platform): void {
  chrome.runtime.onMessage.addListener(
    (message: RuntimeMessage, _sender, sendResponse: (response: RuntimeResponse) => void) => {
      if (message.type !== RUNTIME_MESSAGE_TYPES.extractVideoInfo) return false

      const videoId =
        platform === 'bilibili'
          ? extractBilibiliVideoId(location.href)
          : extractDouyinVideoId(location.href)

      if (!videoId) {
        sendResponse({ ok: false, error: '当前页面不是有效的视频详情页' })
        return false
      }

      const draft: VideoDraft = {
        platform,
        videoId,
        title: extractTitle(),
      }

      const cover = extractCover()
      if (cover) draft.cover = cover

      sendResponse({ ok: true, data: draft })
      return false
    },
  )
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
