import { RUNTIME_MESSAGE_TYPES } from '@/shared/constants'
import type { RuntimeMessage, RuntimeResponse } from '@/shared/types'

/** seek 消息的负载：跳转到第几秒 */
export interface SeekVideoPayload {
  time: number
}

/**
 * 在页面内定位主视频播放器：
 * 1. 唯一 video 直接返回；
 * 2. 多个 video 时优先返回正在播放的；
 * 3. 都未播放时返回尺寸最大的（通常是主播放器）。
 */
function findMainVideoElement(): HTMLVideoElement | null {
  const videos = document.querySelectorAll('video')
  if (videos.length === 0) return null
  if (videos.length === 1) return videos[0] as HTMLVideoElement

  for (const video of videos) {
    if (video instanceof HTMLVideoElement && !video.paused) return video
  }

  let largest: HTMLVideoElement = videos[0] as HTMLVideoElement
  let largestArea = largest.videoWidth * largest.videoHeight
  for (const video of videos) {
    if (!(video instanceof HTMLVideoElement)) continue
    const area = video.videoWidth * video.videoHeight
    if (area > largestArea) {
      largest = video
      largestArea = area
    }
  }
  return largest
}

/** 校验 seek 消息负载 */
function isSeekPayload(payload: unknown): payload is SeekVideoPayload {
  if (!payload || typeof payload !== 'object') return false
  const { time } = payload as Partial<SeekVideoPayload>
  return typeof time === 'number' && Number.isFinite(time) && time >= 0
}

/**
 * 注册视频播放器控制：接收侧栏的 seek 请求，把页面视频 currentTime 设为目标秒数，
 * 播放器原生进度条会随 currentTime 变化自动刷新。
 */
export function registerVideoPlayerController(): void {
  chrome.runtime.onMessage.addListener(
    (message: RuntimeMessage, _sender, sendResponse: (response: RuntimeResponse) => void) => {
      if (message.type !== RUNTIME_MESSAGE_TYPES.seekVideo) return false

      if (!isSeekPayload(message.payload)) {
        sendResponse({ ok: false, error: 'seek 参数不合法' })
        return false
      }

      const video = findMainVideoElement()
      if (!video) {
        sendResponse({ ok: false, error: '未找到视频播放器' })
        return false
      }

      const { time } = message.payload
      // currentTime 超过视频时长时浏览器会自动 clamp 到 duration，无需额外处理
      video.currentTime = time
      sendResponse({ ok: true, data: { time: video.currentTime } })
      return false
    },
  )
}
