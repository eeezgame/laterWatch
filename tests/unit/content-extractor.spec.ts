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
    document.body.innerHTML = ''
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

  it('抖音用户主页弹窗：document.title 是用户名，标题与封面从弹窗 DOM 提取', () => {
    document.title = '兔兔兔奶糖🍬的抖音 - 抖音'
    document.body.innerHTML = `
      <div class="modal-video-container">
        <img class="backgroundCover" src="https://p3-pc-sign.douyinpic.com/modal-cover.jpeg">
      </div>
      <div class="title" data-e2e="video-desc">各各各摇各各各的 #摇头晃脑舞 #白虎娘 #cos #奶糖大王展开</div>
    `

    const extractor = createExtractor('douyin')
    const response = sendExtractMessage(
      extractor,
      'https://www.douyin.com/user/MS4wLjABAAAA?from_tab_name=main&modal_id=7699551142255296713&relation=1&vid=7699214338276206194',
    )

    expect(response).toEqual({
      ok: true,
      data: {
        platform: 'douyin',
        videoId: '7699551142255296713',
        title: '各各各摇各各各的 #摇头晃脑舞 #白虎娘 #cos #奶糖大王',
        cover: 'https://p3-pc-sign.douyinpic.com/modal-cover.jpeg',
      },
    })
  })

  it('抖音精选弹窗：modal_id 作为视频 ID，弹窗标题优先于页面标题', () => {
    document.title = '天鹅湖转了一个圈 - 抖音'
    document.body.innerHTML = `
      <div class="modal-video-container">
        <img class="backgroundCover" src="https://p3-pc-sign.douyinpic.com/jingxuan-cover.jpeg">
      </div>
      <div class="title" data-e2e="video-desc">天鹅湖转了一个圈圈圈圈 #原神展开</div>
    `

    const extractor = createExtractor('douyin')
    const response = sendExtractMessage(
      extractor,
      'https://www.douyin.com/jingxuan?modal_id=7672749364330237220',
    )

    expect(response).toEqual({
      ok: true,
      data: {
        platform: 'douyin',
        videoId: '7672749364330237220',
        title: '天鹅湖转了一个圈圈圈圈 #原神',
        cover: 'https://p3-pc-sign.douyinpic.com/jingxuan-cover.jpeg',
      },
    })
  })

  it('弹窗元素缺失时回退到 document.title 与 meta 封面', () => {
    document.head.innerHTML =
      '<meta name="lark:url:video_cover_image_url" content="https://p3.douyinpic.com/fallback.jpeg">'
    document.title = '某视频标题 - 抖音'

    const extractor = createExtractor('douyin')
    const response = sendExtractMessage(
      extractor,
      'https://www.douyin.com/jingxuan?modal_id=7672749364330237220',
    )

    expect(response).toEqual({
      ok: true,
      data: {
        platform: 'douyin',
        videoId: '7672749364330237220',
        title: '某视频标题',
        cover: 'https://p3.douyinpic.com/fallback.jpeg',
      },
    })
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
      sentMessages.push(msg as unknown as RuntimeMessage)
      return Promise.resolve({ ok: true })
    })

    registerVideoInfoExtractor('bilibili')

    // 主动上报有 300ms setTimeout，推进到 400ms
    await vi.advanceTimersByTimeAsync(400)
    vi.useRealTimers()

    const report = sentMessages.find((m) => m.type === RUNTIME_MESSAGE_TYPES.currentVideoChanged)
    expect(report).toBeDefined()
    expect(report?.payload).toMatchObject({
      platform: 'bilibili',
      videoId: 'BV1xx411c7mD',
      title: '初始视频',
      cover: 'https://i0.hdslb.com/initial.jpg',
    })
  })

  it('视频 ID 变化后自动上报新草稿（页面切换视频不依赖 history hook）', async () => {
    vi.useFakeTimers()
    document.head.innerHTML =
      '<title>视频 A_哔哩哔哩_bilibili</title><meta property="og:image" content="https://i0.hdslb.com/cover-A.jpg">'
    setLocation('https://www.bilibili.com/video/BV1xx411c7mA')

    const sentMessages: RuntimeMessage[] = []
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((msg) => {
      sentMessages.push(msg as unknown as RuntimeMessage)
      return Promise.resolve({ ok: true })
    })

    registerVideoInfoExtractor('bilibili')
    await vi.advanceTimersByTimeAsync(400)

    // 第一次上报
    expect(currentVideoReports(sentMessages)).toHaveLength(1)

    // 模拟 B 站 SPA 导航：地址先变化，页面标题 / 封面随后才更新
    setLocation('https://www.bilibili.com/video/BV1xx411c7mB')
    await vi.advanceTimersByTimeAsync(500)

    const afterUrlChange = currentVideoReports(sentMessages)
    expect(afterUrlChange).toHaveLength(2)
    // 视频 ID 已切换到新视频
    expect(afterUrlChange[1].payload).toMatchObject({ videoId: 'BV1xx411c7mB' })

    // 标题与封面晚到时补报，避免新视频沿用上一个视频的元信息
    document.head.innerHTML =
      '<title>视频 B_哔哩哔哩_bilibili</title><meta property="og:image" content="https://i0.hdslb.com/cover-B.jpg">'
    await vi.advanceTimersByTimeAsync(200)

    const afterMetadata = currentVideoReports(sentMessages)
    expect(afterMetadata).toHaveLength(3)
    expect(afterMetadata[2].payload).toMatchObject({
      videoId: 'BV1xx411c7mB',
      title: '视频 B',
      cover: 'https://i0.hdslb.com/cover-B.jpg',
    })
    vi.useRealTimers()
  })

  it('同一视频不重复上报（节流）', async () => {
    vi.useFakeTimers()
    document.head.innerHTML = '<title>视频 A_哔哩哔哩_bilibili</title>'
    setLocation('https://www.bilibili.com/video/BV1xx411c7mA')

    const sentMessages: RuntimeMessage[] = []
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((msg) => {
      sentMessages.push(msg as unknown as RuntimeMessage)
      return Promise.resolve({ ok: true })
    })

    registerVideoInfoExtractor('bilibili')
    await vi.advanceTimersByTimeAsync(400)

    // 地址与元信息都没有变化
    await vi.advanceTimersByTimeAsync(1000)
    expect(currentVideoReports(sentMessages)).toHaveLength(1)

    // 再次写回同一地址（replaceState 常见行为）也不产生新上报
    setLocation('https://www.bilibili.com/video/BV1xx411c7mA')
    await vi.advanceTimersByTimeAsync(500)
    expect(currentVideoReports(sentMessages)).toHaveLength(1)
    vi.useRealTimers()
  })
})

function currentVideoReports(messages: RuntimeMessage[]): RuntimeMessage[] {
  return messages.filter((m) => m.type === RUNTIME_MESSAGE_TYPES.currentVideoChanged)
}

/** 模拟地址栏 href 变化（内容脚本通过轮询感知） */
function setLocation(href: string): void {
  Object.defineProperty(window, 'location', { value: { href }, writable: true, configurable: true })
}

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
