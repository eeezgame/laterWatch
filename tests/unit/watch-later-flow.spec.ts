import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 导入 background 模块，让 chrome.runtime.sendMessage 经由真实的消息处理器落盘
import '@/background'
import { mountWatchLaterFab } from '@/content/fab'
import { resolveBilibiliTarget } from '@/content/fab/targets'
import App from '@/sidepanel/App.vue'
import { RUNTIME_MESSAGE_TYPES, STORAGE_KEYS } from '@/shared/constants'
import type { VideoItem } from '@/shared/types'
import { getItem } from '@/shared/utils/storage'

const COVER_RECT = {
  top: 100,
  left: 40,
  right: 280,
  bottom: 235,
  width: 240,
  height: 135,
  x: 40,
  y: 100,
} as unknown as DOMRect

const CARD_HTML = `
  <div class="bili-video-card">
    <a class="bili-video-card__wrap" href="//www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333" title="B 站视频标题">
      <img src="https://i0.hdslb.com/cover.jpg" alt="">
    </a>
  </div>
`

describe('网页悬浮按钮到侧边栏的添加闭环', () => {
  beforeEach(() => {
    // 悬浮按钮与 toast 是挂在 documentElement 上的单例节点，须在用例间清理，
    // 否则 mountWatchLaterFab 的单例守卫会直接返回，导致用例复用上个用例的残留按钮与文本
    document.documentElement
      .querySelectorAll('#lw-fab-root, #lw-toast-root')
      .forEach((node) => node.remove())

    document.body.innerHTML = CARD_HTML
    document.title = 'B 站 - 首页'
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(COVER_RECT)
  })

  it('悬浮封面显示按钮，点击后写入待看列表并实时刷新侧边栏', async () => {
    const panel = mount(App, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(panel.text()).toContain('暂无待看视频')

    mountWatchLaterFab({ platform: 'bilibili', resolveTarget: resolveBilibiliTarget })
    const host = document.getElementById('lw-fab-root')
    if (!(host instanceof HTMLButtonElement)) throw new Error('悬浮按钮未挂载')

    expect(host.classList.contains('is-hidden')).toBe(true)

    document.querySelector('img')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))

    expect(host.classList.contains('is-hidden')).toBe(false)
    expect(host.querySelector('.lw-fab__label')?.textContent).toBe('稍后再看')

    host.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(host.querySelector('.lw-fab__label')?.textContent).toBe('已添加'))

    expect(host.disabled).toBe(true)
    expect(document.getElementById('lw-toast-root')?.textContent).toBe('已加入稍后再看')

    const items = await getItem<VideoItem[]>(STORAGE_KEYS.watchList, [])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'bilibili:BV1xx411c7mD',
      platform: 'bilibili',
      title: 'B 站视频标题',
      url: 'https://www.bilibili.com/video/BV1xx411c7mD',
      cover: 'https://i0.hdslb.com/cover.jpg',
    })

    await flushPromises()
    expect(panel.text()).toContain('B 站视频标题')
  })

  it('移入回收站后按钮回到可添加态，再次添加可重新激活该条目', async () => {
    const panel = mount(App, { global: { plugins: [createPinia()] } })
    await flushPromises()

    mountWatchLaterFab({ platform: 'bilibili', resolveTarget: resolveBilibiliTarget })
    const host = document.getElementById('lw-fab-root')
    if (!(host instanceof HTMLButtonElement)) throw new Error('悬浮按钮未挂载')

    const cover = document.querySelector('img')
    if (!cover) throw new Error('封面未找到')

    cover.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    host.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(host.querySelector('.lw-fab__label')?.textContent).toBe('已添加'))

    // 侧边栏移入回收站：storage 变更应把按钮刷回可添加态
    await vi.waitFor(() => expect(panel.find('.lw-list__remove').exists()).toBe(true))
    await panel.find('.lw-list__remove').trigger('click')
    await vi.waitFor(() =>
      expect(host.querySelector('.lw-fab__label')?.textContent).toBe('稍后再看'),
    )
    expect(host.disabled).toBe(false)

    host.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(host.querySelector('.lw-fab__label')?.textContent).toBe('已添加'))

    const items = await getItem<VideoItem[]>(STORAGE_KEYS.watchList, [])
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('bilibili:BV1xx411c7mD')
    expect(items[0].deletedAt).toBeUndefined()

    await flushPromises()
    expect(panel.text()).toContain('B 站视频标题')
  })

  it('storage 遗留脏数据时仍能正常添加（回归：写入失败导致后续所有添加中断）', async () => {
    // 模拟此前序列化失败写入的非法结构
    await chrome.storage.local.set({ [STORAGE_KEYS.watchList]: { broken: true } })

    const panel = mount(App, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(panel.text()).toContain('暂无待看视频')

    mountWatchLaterFab({ platform: 'bilibili', resolveTarget: resolveBilibiliTarget })
    const host = document.getElementById('lw-fab-root')
    if (!(host instanceof HTMLButtonElement)) throw new Error('悬浮按钮未挂载')

    document.querySelector('img')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    host.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    await vi.waitFor(() => expect(host.querySelector('.lw-fab__label')?.textContent).toBe('已添加'))
    expect(document.getElementById('lw-toast-root')?.textContent).toBe('已加入稍后再看')

    // 脏数据被兜底，新条目正常落盘并出现在侧边栏
    const items = await getItem<VideoItem[]>(STORAGE_KEYS.watchList, [])
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('bilibili:BV1xx411c7mD')

    await flushPromises()
    expect(panel.text()).toContain('B 站视频标题')
  })
})

describe('background 当前视频缓存', () => {
  const draftA = { platform: 'bilibili' as const, videoId: 'BV1xx411c7mA', title: '视频 A' }
  const draftB = { platform: 'bilibili' as const, videoId: 'BV1xx411c7mB', title: '视频 B' }

  /** 测试专用：指定 sender.tab 模拟内容脚本上报（setup 中的 mock 支持第二个参数） */
  function sendFromContentScript(message: unknown, sender: unknown): Promise<unknown> {
    const send = chrome.runtime.sendMessage as unknown as (
      message: unknown,
      sender?: unknown,
    ) => Promise<unknown>
    return send(message, sender)
  }

  it('SPA 切换到新视频后不再返回旧 tab 缓存', async () => {
    // content script 上报视频 A，background 按 tabId 缓存
    await sendFromContentScript(
      { type: RUNTIME_MESSAGE_TYPES.currentVideoChanged, payload: draftA },
      { tab: { id: 5 } },
    )

    // 同一 tab 地址已切换到视频 B
    chrome.tabs.query = vi.fn(() =>
      Promise.resolve([
        { id: 5, url: 'https://www.bilibili.com/video/BV1xx411c7mB', active: true },
      ]),
    ) as unknown as typeof chrome.tabs.query
    const tabsSendMessage = vi.fn(() => Promise.resolve({ ok: true, data: draftB }))
    chrome.tabs.sendMessage = tabsSendMessage as unknown as typeof chrome.tabs.sendMessage

    const response = await chrome.runtime.sendMessage({
      type: RUNTIME_MESSAGE_TYPES.queryCurrentVideo,
    })

    // 旧缓存作废，改为向内容脚本重新提取
    expect(response).toEqual({ ok: true, data: draftB })
    expect(tabsSendMessage).toHaveBeenCalledWith(5, {
      type: RUNTIME_MESSAGE_TYPES.queryCurrentVideo,
    })
  })
})
