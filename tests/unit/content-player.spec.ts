import { beforeEach, describe, expect, it, vi } from 'vitest'

import { registerVideoPlayerController } from '@/content/player'
import { RUNTIME_MESSAGE_TYPES } from '@/shared/constants'
import type { RuntimeMessage, RuntimeResponse } from '@/shared/types'

type MessageListener = (
  message: RuntimeMessage,
  sender: unknown,
  sendResponse: (response?: unknown) => void,
) => boolean | undefined

function createController(): MessageListener {
  const listeners: MessageListener[] = []
  vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation((listener) => {
    listeners.push(listener as MessageListener)
  })

  registerVideoPlayerController()
  return listeners[0]
}

function sendSeekMessage(
  listener: MessageListener,
  payload: unknown,
): RuntimeResponse<{ time: number }> {
  let response: RuntimeResponse<{ time: number }> | undefined
  listener({ type: RUNTIME_MESSAGE_TYPES.seekVideo, payload }, {}, (r) => {
    response = r as RuntimeResponse<{ time: number }>
  })
  if (!response) throw new Error('未收到响应')
  return response
}

describe('视频播放器 seek 控制', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('单视频页面：把 currentTime 设为目标秒数并返回成功', () => {
    document.body.innerHTML = '<video></video>'
    const video = document.querySelector('video') as HTMLVideoElement
    video.currentTime = 0

    const listener = createController()
    const response = sendSeekMessage(listener, { time: 135 })

    expect(response.ok).toBe(true)
    expect(video.currentTime).toBe(135)
    expect(response.data?.time).toBe(135)
  })

  it('多视频页面：优先选中正在播放的视频进行 seek', () => {
    document.body.innerHTML = '<video class="recommend"></video><video class="main"></video>'
    const [recommend, main] = document.querySelectorAll('video') as NodeListOf<HTMLVideoElement>

    // 模拟 main 正在播放（paused 为 false）
    Object.defineProperty(main, 'paused', { value: false, configurable: true })
    Object.defineProperty(recommend, 'paused', { value: true, configurable: true })

    const listener = createController()
    sendSeekMessage(listener, { time: 90 })

    expect(main.currentTime).toBe(90)
    expect(recommend.currentTime).toBe(0)
  })

  it('所有视频都未播放时选中尺寸最大的视频', () => {
    document.body.innerHTML =
      '<video class="small" width="100" height="100"></video><video class="large" width="800" height="450"></video>'
    const [small, large] = document.querySelectorAll('video') as NodeListOf<HTMLVideoElement>

    Object.defineProperty(small, 'videoWidth', { value: 100, configurable: true })
    Object.defineProperty(small, 'videoHeight', { value: 100, configurable: true })
    Object.defineProperty(large, 'videoWidth', { value: 800, configurable: true })
    Object.defineProperty(large, 'videoHeight', { value: 450, configurable: true })

    const listener = createController()
    sendSeekMessage(listener, { time: 42 })

    expect(large.currentTime).toBe(42)
    expect(small.currentTime).toBe(0)
  })

  it('页面无 video 元素时返回失败', () => {
    const listener = createController()
    const response = sendSeekMessage(listener, { time: 10 })

    expect(response.ok).toBe(false)
    expect(response.error).toBe('未找到视频播放器')
  })

  it('非法 payload（缺 time 字段）返回失败', () => {
    document.body.innerHTML = '<video></video>'
    const listener = createController()

    expect(sendSeekMessage(listener, {}).ok).toBe(false)
    expect(sendSeekMessage(listener, { time: '135' }).ok).toBe(false)
    expect(sendSeekMessage(listener, { time: -1 }).ok).toBe(false)
  })

  it('不处理非 seekVideo 类型的消息', () => {
    document.body.innerHTML = '<video></video>'
    const listener = createController()

    const result = listener({ type: 'other-message' }, {}, () => {})
    expect(result).toBe(false)
  })
})
