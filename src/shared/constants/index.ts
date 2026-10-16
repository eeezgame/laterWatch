import type { Platform } from '@/shared/types'

export const EXTENSION_NAME = 'LaterWatch'

export const SUPPORTED_PLATFORMS: readonly Platform[] = ['bilibili', 'douyin', 'local']

export const PLATFORM_LABELS: Record<Platform, string> = {
  bilibili: 'B站',
  douyin: '抖音',
  local: '本地视频',
}

/** chrome.storage.local 中使用的键名，统一加 lw: 前缀避免与页面存储冲突 */
export const STORAGE_KEYS = {
  watchList: 'lw:watch-list',
  settings: 'lw:settings',
} as const

/** 插件内部运行时消息类型 */
export const RUNTIME_MESSAGE_TYPES = {
  ping: 'ping',
  addWatchLater: 'lw:add-watch-later',
  extractVideoInfo: 'lw:extract-video-info',
} as const

/** 右键菜单 ID */
export const CONTEXT_MENU_IDS = {
  addCurrentVideo: 'lw:add-current-video',
} as const
