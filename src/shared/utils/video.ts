import type { Platform, VideoDraft, VideoItem } from '@/shared/types'

const DEFAULT_VIDEO_TITLE = '未命名视频'

/** B 站视频链接中的 BV 号 / av 号 */
const BILIBILI_VIDEO_ID_PATTERN = /\/video\/(bv[0-9a-z]+|av\d+)/i
/** 抖音视频链接中的 aweme 数字 id */
const DOUYIN_VIDEO_ID_PATTERN = /\/video\/(\d+)/

/** 从任意 B 站链接中解析视频标识，失败返回 null */
export function extractBilibiliVideoId(rawUrl: string): string | null {
  const matched = BILIBILI_VIDEO_ID_PATTERN.exec(rawUrl)
  if (!matched) return null

  const [, rawId] = matched
  const body = rawId.slice(2)
  return rawId.toLowerCase().startsWith('bv') ? `BV${body}` : `av${body}`
}

/** 从任意抖音链接中解析视频标识，失败返回 null */
export function extractDouyinVideoId(rawUrl: string): string | null {
  const matched = DOUYIN_VIDEO_ID_PATTERN.exec(rawUrl)
  if (matched) return matched[1]

  const modalId = /[?&]modal_id=(\d+)/.exec(rawUrl)
  return modalId ? modalId[1] : null
}

/** 各平台视频条目的规范播放地址 */
export function normalizeVideoUrl(platform: Platform, videoId: string): string {
  switch (platform) {
    case 'bilibili':
      return `https://www.bilibili.com/video/${videoId}`
    case 'douyin':
      return `https://www.douyin.com/video/${videoId}`
    case 'local':
      return videoId
  }
}

/** 待看条目的去重键，同一视频在不同入口添加只入库一次 */
export function createVideoItemId(platform: Platform, videoId: string): string {
  return `${platform}:${videoId}`
}

/**
 * 校验从 storage 读出的待看列表：非数组一律视为空列表。
 * 历史脏数据（如序列化失败写入的非法结构）不会中断后续读写流程。
 */
export function normalizeWatchList(value: unknown): VideoItem[] {
  return Array.isArray(value) ? (value as VideoItem[]) : []
}

/**
 * 从标签页地址反解出视频去重键，用于判断某个标签页是否已打开目标视频。
 * 非 B 站 / 抖音视频页返回 null。
 */
export function resolveVideoKeyFromUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null

  const bilibiliId = extractBilibiliVideoId(rawUrl)
  if (bilibiliId) return createVideoItemId('bilibili', bilibiliId)

  const douyinId = extractDouyinVideoId(rawUrl)
  if (douyinId) return createVideoItemId('douyin', douyinId)

  return null
}

/**
 * 在已打开的标签页中查找与待看条目指向同一视频的页面。
 * 命中时复用该标签页跳转，避免重复打开同一视频。
 */
export function findExistingVideoTab<T extends { url?: string }>(
  tabs: T[],
  item: Pick<VideoItem, 'id'>,
): T | undefined {
  return tabs.find((tab) => resolveVideoKeyFromUrl(tab.url) === item.id)
}

/** 由网页抓取到的草稿生成完整待看条目 */
export function createVideoItem(draft: VideoDraft, now: number = Date.now()): VideoItem {
  const item: VideoItem = {
    id: createVideoItemId(draft.platform, draft.videoId),
    platform: draft.platform,
    title: draft.title.replace(/\s+/g, ' ').trim() || DEFAULT_VIDEO_TITLE,
    url: normalizeVideoUrl(draft.platform, draft.videoId),
    addedAt: now,
  }

  const cover = draft.cover?.trim()
  if (cover) item.cover = cover

  return item
}

export interface MergeWatchListResult {
  items: VideoItem[]
  /** false 表示该视频已在待看列表中，列表未被改动 */
  added: boolean
}

/**
 * 将新条目并入待看列表：不存在时置顶插入；已存在且未删除时保持原状；
 * 已存在但位于回收站时用新条目替换并置顶，等价于顺带恢复。
 */
export function mergeWatchList(items: VideoItem[], incoming: VideoItem): MergeWatchListResult {
  const existing = items.find((item) => item.id === incoming.id)
  if (existing && !existing.deletedAt) {
    return { items, added: false }
  }

  return {
    items: [incoming, ...items.filter((item) => item.id !== incoming.id)],
    added: true,
  }
}

/**
 * 在可见条目子集内应用拖拽后的新顺序。
 * 只重排 orderedIds 涉及的那些槽位，其余条目（其他平台、回收站）保持原有位置，
 * 因此在筛选视图下拖拽不会打乱整体顺序。
 */
export function reorderVisibleItems(all: VideoItem[], orderedIds: string[]): VideoItem[] {
  const byId = new Map(all.map((item) => [item.id, item]))
  const queued = orderedIds
    .map((id) => byId.get(id))
    .filter((item): item is VideoItem => Boolean(item))

  if (queued.length === 0) return all

  // 依次填充这些条目原本占据的槽位，其余条目原地不动
  const moving = new Set(queued)
  let cursor = 0
  return all.map((item) => (moving.has(item) ? queued[cursor++] : item))
}
