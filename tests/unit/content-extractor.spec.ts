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
  beforeEach(() => {
    document.head.innerHTML = ''
    document.title = ''
    vi.restoreAllMocks()
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
