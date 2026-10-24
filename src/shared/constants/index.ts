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
  queryCurrentVideo: 'lw:query-current-video',
  /** 内容脚本主动上报：当前视频详情页信息（注入时 + SPA 导航时触发） */
  currentVideoChanged: 'lw:current-video-changed',
  /** 侧栏 -> 内容脚本：让页面视频播放器跳转到指定秒数 */
  seekVideo: 'lw:seek-video',
} as const

/** 右键菜单 ID */
export const CONTEXT_MENU_IDS = {
  addCurrentVideo: 'lw:add-current-video',
} as const
