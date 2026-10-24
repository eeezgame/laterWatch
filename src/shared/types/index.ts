/** 视频来源平台 */
export type Platform = 'bilibili' | 'douyin' | 'local'

/** 侧边栏顶部筛选标签 */
export type ListFilter = 'all' | Platform

/** 待看条目统一结构，B 站 / 抖音 / 本地视频三类资源共用 */
export interface VideoItem {
  id: string
  platform: Platform
  title: string
  url: string
  cover?: string
  /** 添加时间戳（毫秒），列表按此字段倒序展示 */
  addedAt: number
  /** 标记已看完的时间戳（毫秒） */
  completedAt?: number
  /** 移入回收站的时间戳（毫秒），非空表示条目已删除 */
  deletedAt?: number
  /** 单条评论文本，其中形如 02:15 / 1:02:15 的片段会被识别为可点击时间锚点 */
  comment?: string
}

/** 网页悬浮按钮抓取到的视频草稿，尚未生成完整待看条目 */
export interface VideoDraft {
  platform: Platform
  /** 平台内视频唯一标识：B 站为 BV 号 / av 号，抖音为 aweme 数字 id */
  videoId: string
  title: string
  cover?: string
}

/** 「加入稍后再看」处理结果，added 为 false 表示该视频已在待看列表中 */
export interface AddWatchLaterResult {
  added: boolean
}

/** 插件内部运行时消息 */
export interface RuntimeMessage {
  type: string
  payload?: unknown
}

export interface RuntimeResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}
