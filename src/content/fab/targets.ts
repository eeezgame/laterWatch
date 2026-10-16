import type { Platform, VideoDraft } from '@/shared/types'
import { extractBilibiliVideoId, extractDouyinVideoId } from '@/shared/utils/video'

/** 悬浮按钮的数据来源与定位目标 */
export interface CoverTarget extends VideoDraft {
  /** 用于计算按钮坐标的元素：优先封面图，退化到视频链接锚点 */
  element: HTMLElement
}

/** 过滤掉头像、图标等过小节点，避免误命中 */
const MIN_COVER_WIDTH = 80
const MIN_COVER_HEIGHT = 45

interface ResolveOptions {
  platform: Platform
  extractVideoId: (url: string) => string | null
}

/**
 * 从鼠标所在节点反查视频封面：以 href 中的 /video/ 为线索向上找锚点，
 * 不依赖平台类名，降低改版导致的选择器失效风险。
 */
function resolveCoverTarget(node: Element | null, options: ResolveOptions): CoverTarget | null {
  const anchor = node?.closest('a[href*="/video/"]')
  if (!(anchor instanceof HTMLAnchorElement)) return null

  const videoId = options.extractVideoId(anchor.href)
  if (!videoId) return null

  const image = anchor.querySelector('img')
  const element: HTMLElement = image instanceof HTMLImageElement ? image : anchor
  const rect = element.getBoundingClientRect()
  if (rect.width < MIN_COVER_WIDTH || rect.height < MIN_COVER_HEIGHT) return null

  const target: CoverTarget = {
    platform: options.platform,
    videoId,
    title: pickTitle(anchor, image),
    element,
  }

  const cover = pickCoverUrl(image)
  if (cover) target.cover = cover

  return target
}

/** 标题依次沿锚点 title、封面 alt、所属卡片 title 兜底，最后退化为页面标题 */
function pickTitle(anchor: HTMLAnchorElement, image: Element | null): string {
  const candidates = [
    anchor.getAttribute('title'),
    image?.getAttribute('alt'),
    anchor.closest('[title]')?.getAttribute('title'),
    document.title,
  ]

  for (const candidate of candidates) {
    const title = candidate?.replace(/\s+/g, ' ').trim()
    if (title) return title
  }

  return ''
}

function pickCoverUrl(image: Element | null): string | undefined {
  if (!(image instanceof HTMLImageElement)) return undefined

  const url = (image.currentSrc || image.src || image.getAttribute('data-src') || '').trim()
  return url || undefined
}

/** B 站推荐页 / 搜索页 / 播放页的视频封面 */
export function resolveBilibiliTarget(node: Element | null): CoverTarget | null {
  return resolveCoverTarget(node, {
    platform: 'bilibili',
    extractVideoId: extractBilibiliVideoId,
  })
}

/** 抖音网页版视频卡片封面 */
export function resolveDouyinTarget(node: Element | null): CoverTarget | null {
  return resolveCoverTarget(node, {
    platform: 'douyin',
    extractVideoId: extractDouyinVideoId,
  })
}
