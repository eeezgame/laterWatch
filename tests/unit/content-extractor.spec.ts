import { beforeEach, describe, expect, it, vi } from 'vitest'

import { registerVideoInfoExtractor } from '@/content/extractor'
import { RUNTIME_MESSAGE_TYPES } from '@/shared/constants'
import type { RuntimeMessage, RuntimeResponse, VideoDraft } from '@/shared/types'

type MessageListener = (
  message: RuntimeMessage,
  sender: unknown,
  sendResponse: (response?: unknown) => void,
) => boolean | undefined

describe('视频详情页信息提取', () => {
  const origPushState = history.pushState
  const origReplaceState = history.replaceState

  beforeEach(() => {
    document.head.innerHTML = ''
    document.title = ''
    vi.restoreAllMocks()
    // 恢复被 extractor 劫持的 history 方法（vitest 默认的 restoreAllMocks 管不到直接赋到原生对象上的 patch）
    history.pushState = origPushState.bind(history)
    history.replaceState = origReplaceState.bind(history)
  })

  it('从 B 站视频页提取标题和封面', () => {
    document.head.innerHTML =
      '<title>【4K】绝美风景混剪_哔哩哔哩_bilibili</title><meta property="og:image" content="https://i0.hdslb.com/cover.jpg">'

    const extractor = createExtractor('bilibili')
    const response = sendExtractMessage(extractor, 'https://www.bilibili.com/video/BV1xx411c7mD')

    expect(response).toEqual({
      ok: true,
      data: {
        platform: 'bilibili',
        videoId: 'BV1xx411c7mD',
        title: '【4K】绝美风景混剪',
        cover: 'https://i0.hdslb.com/cover.jpg',
      },
    })
  })

  it('从抖音视频页提取标题和封面（抖音无 og:image，使用自家封面 meta）', () => {
    document.head.innerHTML =
      '<title>超治愈的猫咪日常 - 抖音</title><meta name="lark:url:video_cover_image_url" content="https://p3-pc-sign.douyinpic.com/cover.jpeg?x-expires=2107479600&amp;x-signature=q6fS%3D">'

    const extractor = createExtractor('douyin')
    const response = sendExtractMessage(
      extractor,
      'https://www.douyin.com/video/7696458982361238818',
    )

    expect(response).toEqual({
      ok: true,
      data: {
        platform: 'douyin',
        videoId: '7696458982361238818',
        title: '超治愈的猫咪日常',
        cover:
          'https://p3-pc-sign.douyinpic.com/cover.jpeg?x-expires=2107479600&x-signature=q6fS%3D',
      },
    })
  })

  it('og:image 优先于抖音封面 meta', () => {
    document.head.innerHTML =
      '<title>标题 - 抖音</title><meta name="lark:url:video_cover_image_url" content="https://p3.douyinpic.com/fallback.jpeg"><meta property="og:image" content="https://p3.douyinpic.com/og.jpeg">'

    const extractor = createExtractor('douyin')
    const response = sendExtractMessage(
      extractor,
      'https://www.douyin.com/video/7696458982361238818',
    )

    expect(response).toMatchObject({
      ok: true,
      data: { cover: 'https://p3.douyinpic.com/og.jpeg' },
    })
  })

  it('抖音封面 meta 用 property 属性承载时同样可提取', () => {
    document.head.innerHTML =
      '<title>标题 - 抖音</title><meta property="lark:url:video_cover_image_url" content="https://p3.douyinpic.com/legacy.jpeg">'

    const extractor = createExtractor('douyin')
    const response = sendExtractMessage(
      extractor,
      'https://www.douyin.com/video/7689886033181216034',
    )

    expect(response).toMatchObject({
      ok: true,
      data: { cover: 'https://p3.douyinpic.com/legacy.jpeg' },
    })
  })

  it('非视频详情页返回错误', () => {
    const extractor = createExtractor('bilibili')
    const response = sendExtractMessage(extractor, 'https://www.bilibili.com/')

    expect(response).toEqual({
      ok: false,
      error: '当前页面不是有效的视频详情页',
    })
  })

  it('标题无站点后缀时保留原样', () => {
    document.title = '无后缀标题'

    const extractor = createExtractor('bilibili')
    const response = sendExtractMessage(extractor, 'https://www.bilibili.com/video/BV1xx411c7mD')

    expect(response).toMatchObject({
      ok: true,
      data: { title: '无后缀标题' },
    })
  })

  it('无封面时不包含 cover 字段', () => {
    document.title = '视频标题_哔哩哔哩_bilibili'

    const extractor = createExtractor('bilibili')
    const response = sendExtractMessage(extractor, 'https://www.bilibili.com/video/BV1xx411c7mD')

    expect(response.ok).toBe(true)
    if (response.ok && response.data) {
      expect('cover' in response.data).toBe(false)
    }
  })

  it('注入后主动上报一次 currentVideoChanged（当前为视频详情页）', async () => {
    vi.useFakeTimers()
    document.head.innerHTML =
      '<title>初始视频_哔哩哔哩_bilibili</title><meta property="og:image" content="https://i0.hdslb.com/initial.jpg">'
    Object.defineProperty(window, 'location', {
      value: { href: 'https://www.bilibili.com/video/BV1xx411c7mD' },
      writable: true,
    })

    const sentMessages: RuntimeMessage[] = []
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((msg) => {
      sentMessages.push((msg as unknown) as RuntimeMessage)
      return Promise.resolve({ ok: true })
    })

    registerVideoInfoExtractor('bilibili')

    // 主动上报有 300ms setTimeout，推进到 400ms
    await vi.advanceTimersByTimeAsync(400)
    vi.useRealTimers()

    const report = sentMessages.find(
      (m) => m.type === RUNTIME_MESSAGE_TYPES.currentVideoChanged,
    )
    expect(report).toBeDefined()
    expect(report?.payload).toMatchObject({
      platform: 'bilibili',
      videoId: 'BV1xx411c7mD',
      title: '初始视频',
      cover: 'https://i0.hdslb.com/initial.jpg',
    })
  })

  it('SPA pushState 导航到新视频后再次上报并携带新草稿', async () => {
    vi.useFakeTimers()
    document.head.innerHTML =
      '<title>视频 A_哔哩哔哩_bilibili</title><meta property="og:image" content="https://i0.hdslb.com/cover-A.jpg">'
    Object.defineProperty(window, 'location', {
      value: { href: 'https://www.bilibili.com/video/BV1xx411c7mA' },
      writable: true,
    })

    const sentMessages: RuntimeMessage[] = []
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((msg) => {
      sentMessages.push((msg as unknown) as RuntimeMessage)
      return Promise.resolve({ ok: true })
    })

    registerVideoInfoExtractor('bilibili')
    await vi.advanceTimersByTimeAsync(400)

    // 第一次上报
    const firstReportCount = sentMessages.filter(
      (m) => m.type === RUNTIME_MESSAGE_TYPES.currentVideoChanged,
    ).length
    expect(firstReportCount).toBe(1)

    // 模拟 SPA 内部导航：pushState + 新 meta + 新 title
    document.head.innerHTML =
      '<title>视频 B_哔哩哔哩_bilibili</title><meta property="og:image" content="https://i0.hdslb.com/cover-B.jpg">'
    Object.defineProperty(window, 'location', {
      value: { href: 'https://www.bilibili.com/video/BV1xx411c7mB' },
      writable: true,
    })
    history.pushState({}, '', '/video/BV1xx411c7mB')
    vi.useRealTimers()
    await Promise.resolve() // queueMicrotask

    const allReports = sentMessages.filter(
      (m) => m.type === RUNTIME_MESSAGE_TYPES.currentVideoChanged,
    )
    expect(allReports.length).toBe(2)
    expect(allReports[1].payload).toMatchObject({
      videoId: 'BV1xx411c7mB',
      title: '视频 B',
      cover: 'https://i0.hdslb.com/cover-B.jpg',
    })
  })

  it('同一视频不重复上报（节流）', async () => {
    vi.useFakeTimers()
    document.head.innerHTML = '<title>视频 A_哔哩哔哩_bilibili</title>'
    Object.defineProperty(window, 'location', {
      value: { href: 'https://www.bilibili.com/video/BV1xx411c7mA' },
      writable: true,
    })

    const sentMessages: RuntimeMessage[] = []
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((msg) => {
      sentMessages.push((msg as unknown) as RuntimeMessage)
      return Promise.resolve({ ok: true })
    })

    registerVideoInfoExtractor('bilibili')
    await vi.advanceTimersByTimeAsync(400)
    vi.useRealTimers()

    // 连续两次 pushState 到同一视频
    history.pushState({}, '', '/video/BV1xx411c7mA')
    await Promise.resolve()
    history.pushState({}, '', '/video/BV1xx411c7mA')
    await Promise.resolve()

    const reports = sentMessages.filter(
      (m) => m.type === RUNTIME_MESSAGE_TYPES.currentVideoChanged,
    )
    expect(reports.length).toBe(1) // 只有初始注入那次
  })
})

function createExtractor(platform: 'bilibili' | 'douyin'): MessageListener {
  const listeners: MessageListener[] = []

  vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation((listener) => {
    listeners.push(listener as MessageListener)
  })

  registerVideoInfoExtractor(platform)

  return listeners[0]
}

function sendExtractMessage(listener: MessageListener, url: string): RuntimeResponse<VideoDraft> {
  // 模拟 location.href
  Object.defineProperty(window, 'location', {
    value: { href: url },
    writable: true,
  })

  let response: RuntimeResponse<VideoDraft> | undefined
  const sendResponse = (r: unknown) => {
    response = r as RuntimeResponse<VideoDraft>
  }

  listener({ type: RUNTIME_MESSAGE_TYPES.extractVideoInfo }, {}, sendResponse)

  if (!response) throw new Error('未收到响应')
  return response
}
