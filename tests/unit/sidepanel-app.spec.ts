import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { isReactive } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from '@/sidepanel/App.vue'
import { RUNTIME_MESSAGE_TYPES, STORAGE_KEYS } from '@/shared/constants'
import type { RuntimeMessage, VideoItem } from '@/shared/types'

/** 模拟浏览器中已打开的标签页，供跳转逻辑查询 */
interface OpenTab {
  id?: number
  windowId?: number
  url?: string
}

function mountApp() {
  return mount(App, { global: { plugins: [createPinia()] } })
}

/** 捕获侧边栏注册的 runtime 监听器，用于模拟 background 广播 */
function captureRuntimeBroadcasts(): (message: RuntimeMessage) => void {
  const listeners: Array<
    (message: RuntimeMessage, sender: unknown, sendResponse: () => void) => void
  > = []

  vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation(((
    listener: (message: RuntimeMessage, sender: unknown, sendResponse: () => void) => void,
  ) => {
    listeners.push(listener)
  }) as unknown as typeof chrome.runtime.onMessage.addListener)

  return (message) => {
    listeners.forEach((listener) => listener(message, {}, () => {}))
  }
}

function makeItem(patch: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'bilibili:BV1xx411c7mD',
    platform: 'bilibili',
    title: '测试视频',
    url: 'https://www.bilibili.com/video/BV1xx411c7mD',
    addedAt: Date.now(),
    ...patch,
  }
}

/** 覆盖 chrome.tabs.query 的返回结果（tabs API 存在回调重载，直接替换实现避免类型推断偏差） */
function stubOpenTabs(tabs: OpenTab[]): void {
  chrome.tabs.query = vi.fn(() => Promise.resolve(tabs)) as unknown as typeof chrome.tabs.query
}

/** 读取当前落盘的待看列表数据，非数组一律视为空列表 */
async function readStoredItems(): Promise<VideoItem[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.watchList)
  const value = stored[STORAGE_KEYS.watchList]
  return Array.isArray(value) ? (value as VideoItem[]) : []
}

describe('sidepanel App', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** 从待看列表切换到回收站视图 */
  async function enterRecycleBin(wrapper: ReturnType<typeof mountApp>): Promise<void> {
    await wrapper.find('.lw-footer__entry').trigger('click')
    await flushPromises()
  }

  it('渲染侧边栏骨架并展示待看列表空态', async () => {
    const wrapper = mountApp()
    await flushPromises()

    expect(wrapper.find('.lw-header__title').text()).toBe('LaterWatch')
    expect(wrapper.findAll('.lw-filters__tab')).toHaveLength(4)
    expect(wrapper.text()).toContain('暂无待看视频')
  })

  it('视频 ID 变化时同步更新信息卡片、平台筛选与列表高亮', async () => {
    const itemA = makeItem({
      id: 'bilibili:BV1xx411c7mA',
      title: '视频 A',
      url: 'https://www.bilibili.com/video/BV1xx411c7mA',
    })
    const itemB = makeItem({
      id: 'bilibili:BV1xx411c7mB',
      title: '视频 B',
      url: 'https://www.bilibili.com/video/BV1xx411c7mB',
    })
    await chrome.storage.local.set({ [STORAGE_KEYS.watchList]: [itemA, itemB] })

    const broadcast = captureRuntimeBroadcasts()
    const wrapper = mountApp()
    await flushPromises()

    broadcast({
      type: RUNTIME_MESSAGE_TYPES.currentVideoChanged,
      payload: {
        platform: 'bilibili',
        videoId: 'BV1xx411c7mA',
        title: '视频 A',
        cover: 'https://i0.hdslb.com/cover-A.jpg',
      },
    })
    await flushPromises()

    expect(wrapper.find('.lw-current__title').text()).toBe('视频 A')
    expect(wrapper.find('.lw-current__cover img').attributes('src')).toBe(
      'https://i0.hdslb.com/cover-A.jpg',
    )
    expect(wrapper.find('.lw-filters__tab.is-active').text()).toBe('B站')
    expect(wrapper.find('.lw-list__item.is-current-video .lw-list__title').text()).toBe('视频 A')

    // SPA 切换到下一个视频：卡片、筛选与列表高亮都应跟着视频 ID 走
    broadcast({
      type: RUNTIME_MESSAGE_TYPES.currentVideoChanged,
      payload: {
        platform: 'bilibili',
        videoId: 'BV1xx411c7mB',
        title: '视频 B',
        cover: 'https://i0.hdslb.com/cover-B.jpg',
      },
    })
    await flushPromises()

    expect(wrapper.find('.lw-current__title').text()).toBe('视频 B')
    expect(wrapper.find('.lw-current__cover img').attributes('src')).toBe(
      'https://i0.hdslb.com/cover-B.jpg',
    )
    expect(wrapper.find('.lw-filters__tab.is-active').text()).toBe('B站')
    expect(wrapper.find('.lw-list__item.is-current-video .lw-list__title').text()).toBe('视频 B')
  })

  it('底部入口可在待看列表与回收站之间切换', async () => {
    const wrapper = mountApp()
    await flushPromises()

    await wrapper.find('.lw-footer__entry').trigger('click')

    expect(wrapper.text()).toContain('回收站为空')
    expect(wrapper.text()).toContain('返回待看列表')
  })

  it('点击列表项新开标签页跳转视频播放页', async () => {
    const item = makeItem({ title: '跳转目标视频' })
    await chrome.storage.local.set({ [STORAGE_KEYS.watchList]: [item] })

    stubOpenTabs([])
    const tabsCreate = vi.spyOn(chrome.tabs, 'create')

    const wrapper = mountApp()
    await flushPromises()

    const openButton = wrapper.find('.lw-list__open')
    expect(openButton.exists()).toBe(true)

    await openButton.trigger('click')
    await flushPromises()

    expect(tabsCreate).toHaveBeenCalledWith({ url: item.url })
  })

  it('浏览器已打开同一视频时激活已有标签页，不新开标签页', async () => {
    const item = makeItem()
    await chrome.storage.local.set({ [STORAGE_KEYS.watchList]: [item] })

    stubOpenTabs([
      {
        id: 7,
        windowId: 3,
        url: 'https://www.bilibili.com/video/BV1xx411c7mD?spm_id_from=333.999',
      },
    ])
    const tabsUpdate = vi.spyOn(chrome.tabs, 'update')
    const windowsUpdate = vi.spyOn(chrome.windows, 'update')
    const tabsCreate = vi.spyOn(chrome.tabs, 'create')

    const wrapper = mountApp()
    await flushPromises()

    await wrapper.find('.lw-list__open').trigger('click')
    await flushPromises()

    expect(tabsUpdate).toHaveBeenCalledWith(7, { active: true })
    expect(windowsUpdate).toHaveBeenCalledWith(3, { focused: true })
    expect(tabsCreate).not.toHaveBeenCalled()
  })

  it('点击删除按钮将条目移入回收站并保留原始数据', async () => {
    const item = makeItem({ title: '待删除视频' })
    await chrome.storage.local.set({ [STORAGE_KEYS.watchList]: [item] })

    const wrapper = mountApp()
    await flushPromises()

    expect(wrapper.find('.lw-list__item').exists()).toBe(true)

    await wrapper.find('.lw-list__remove').trigger('click')
    await flushPromises()

    // 待看列表清空，条目转入回收站
    expect(wrapper.find('.lw-list__item').exists()).toBe(false)
    expect(wrapper.text()).toContain('暂无待看视频')
    expect(wrapper.find('.lw-footer__entry').text()).toContain('回收站（1）')

    // 底层数据保留，仅追加删除时间，以便后续恢复
    const stored = (await chrome.storage.local.get(STORAGE_KEYS.watchList))[
      STORAGE_KEYS.watchList
    ] as VideoItem[]

    expect(stored).toHaveLength(1)
    expect(stored[0].title).toBe('待删除视频')
    expect(stored[0].url).toBe(item.url)
    expect(stored[0].deletedAt).toBeTypeOf('number')
  })

  it('删除按钮不会触发打开视频', async () => {
    const item = makeItem()
    await chrome.storage.local.set({ [STORAGE_KEYS.watchList]: [item] })

    stubOpenTabs([])
    const tabsCreate = vi.spyOn(chrome.tabs, 'create')

    const wrapper = mountApp()
    await flushPromises()

    await wrapper.find('.lw-list__remove').trigger('click')
    await flushPromises()

    expect(tabsCreate).not.toHaveBeenCalled()
  })

  it('回收站条目可恢复到待看列表并清除删除标记', async () => {
    const item = makeItem({ title: '待恢复视频', deletedAt: Date.now() })
    await chrome.storage.local.set({ [STORAGE_KEYS.watchList]: [item] })

    const wrapper = mountApp()
    await flushPromises()
    await enterRecycleBin(wrapper)

    expect(wrapper.find('.lw-recycle__action').exists()).toBe(true)

    // 第一个操作按钮为「恢复」
    await wrapper.find('.lw-recycle__action').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('回收站为空')

    const stored = await readStoredItems()
    expect(stored).toHaveLength(1)
    expect(stored[0].title).toBe('待恢复视频')
    expect(stored[0].deletedAt).toBeUndefined()

    // 切回待看列表可见该条目
    await enterRecycleBin(wrapper)
    expect(wrapper.find('.lw-list__item').exists()).toBe(true)
    expect(wrapper.text()).toContain('待恢复视频')
  })

  it('永久删除单条需二次确认，确认后数据彻底移除', async () => {
    const item = makeItem({ title: '永久删除目标', deletedAt: Date.now() })
    await chrome.storage.local.set({ [STORAGE_KEYS.watchList]: [item] })

    const wrapper = mountApp()
    await flushPromises()
    await enterRecycleBin(wrapper)

    // 第二个操作按钮为「永久删除」
    await wrapper.findAll('.lw-recycle__action')[1].trigger('click')
    await flushPromises()

    expect(wrapper.find('.lw-confirm').exists()).toBe(true)
    expect(wrapper.find('.lw-confirm__text').text()).toContain('永久删除目标')

    await wrapper.find('.lw-confirm__ok').trigger('click')
    await flushPromises()

    expect(wrapper.find('.lw-confirm').exists()).toBe(false)
    expect(await readStoredItems()).toHaveLength(0)
  })

  it('二次确认弹层取消后不做任何改动', async () => {
    const item = makeItem({ deletedAt: Date.now() })
    await chrome.storage.local.set({ [STORAGE_KEYS.watchList]: [item] })

    const wrapper = mountApp()
    await flushPromises()
    await enterRecycleBin(wrapper)

    await wrapper.findAll('.lw-recycle__action')[1].trigger('click')
    await flushPromises()

    await wrapper.find('.lw-confirm__cancel').trigger('click')
    await flushPromises()

    expect(wrapper.find('.lw-confirm').exists()).toBe(false)
    expect(await readStoredItems()).toHaveLength(1)
  })

  it('落盘的待看列表可被结构化克隆（避免响应式代理导致 chrome.storage 写入失败）', async () => {
    const item = makeItem({ title: '序列化目标' })
    await chrome.storage.local.set({ [STORAGE_KEYS.watchList]: [item] })

    const wrapper = mountApp()
    await flushPromises()

    // 删除会在侧边栏内触发一次落盘
    await wrapper.find('.lw-list__remove').trigger('click')
    await flushPromises()

    const stored = await chrome.storage.local.get(STORAGE_KEYS.watchList)
    // 真机 chrome.storage 无法序列化 Vue Proxy：此处用 structuredClone 复现该约束
    expect(isReactive(stored[STORAGE_KEYS.watchList])).toBe(false)
    expect(() => structuredClone(stored[STORAGE_KEYS.watchList])).not.toThrow()

    const items = stored[STORAGE_KEYS.watchList] as VideoItem[]
    expect(items).toHaveLength(1)
    expect(items[0].deletedAt).toBeTypeOf('number')
  })

  it('storage 中已有脏数据（非数组）时侧边栏不崩溃并可继续写入', async () => {
    // 模拟历史遗留的非法结构
    await chrome.storage.local.set({ [STORAGE_KEYS.watchList]: { broken: true } })

    const wrapper = mountApp()
    await flushPromises()

    // 脏数据被兜底为空列表，界面正常渲染空态
    expect(wrapper.text()).toContain('暂无待看视频')

    // 仍可正常添加新条目
    await chrome.storage.local.set({
      [STORAGE_KEYS.watchList]: [...(await readStoredItems()), makeItem({ title: '新条目' })],
    })
    await flushPromises()

    expect(wrapper.text()).toContain('新条目')
  })

  /** 让每个条目占据固定高度，便于按指针纵坐标判定拖拽落点 */
  function stubRowRects(wrapper: ReturnType<typeof mountApp>, rowHeight = 60): void {
    wrapper.findAll('.lw-list__item').forEach((row, index) => {
      vi.spyOn(row.element, 'getBoundingClientRect').mockReturnValue({
        top: index * rowHeight,
        bottom: (index + 1) * rowHeight,
        height: rowHeight,
        left: 0,
        right: 300,
        width: 300,
        x: 0,
        y: index * rowHeight,
        toJSON: () => ({}),
      } as DOMRect)
    })
  }

  /** 在元素上按下指针并等待超过长按阈值 */
  function longPress(element: Element, clientY = 10): Promise<void> {
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientY }))

    return new Promise((resolve) => setTimeout(resolve, 340))
  }

  it('长按列表项后可拖拽调整顺序并落盘', async () => {
    const first = makeItem({ id: 'bilibili:BV1first', title: '第一条' })
    const second = makeItem({ id: 'douyin:730', platform: 'douyin', title: '第二条' })
    await chrome.storage.local.set({ [STORAGE_KEYS.watchList]: [first, second] })

    const wrapper = mountApp()
    await flushPromises()
    expect(wrapper.findAll('.lw-list__item')).toHaveLength(2)

    stubRowRects(wrapper)
    const rows = wrapper.findAll('.lw-list__item')

    await longPress(rows[0].element)
    await flushPromises()
    expect(rows[0].classes()).toContain('is-dragging')

    // 拖到第二个条目所在区间（60 ~ 120px）
    window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 100 }))
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    await flushPromises()

    expect(rows[0].classes()).not.toContain('is-dragging')

    const stored = await readStoredItems()
    expect(stored.map((item) => item.id)).toEqual(['douyin:730', 'bilibili:BV1first'])
  })

  it('快速点击不进入拖拽，仍按打开视频处理', async () => {
    const item = makeItem()
    await chrome.storage.local.set({ [STORAGE_KEYS.watchList]: [item] })

    stubOpenTabs([])
    const tabsCreate = vi.spyOn(chrome.tabs, 'create')

    const wrapper = mountApp()
    await flushPromises()
    stubRowRects(wrapper)

    const row = wrapper.find('.lw-list__item')
    row.element.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0, clientY: 10 }),
    )
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    await flushPromises()

    expect(row.classes()).not.toContain('is-dragging')

    await row.find('.lw-list__open').trigger('click')
    await flushPromises()

    expect(tabsCreate).toHaveBeenCalledWith({ url: item.url })
  })

  it('拖拽结束后不误触发打开视频', async () => {
    await chrome.storage.local.set({
      [STORAGE_KEYS.watchList]: [
        makeItem({ id: 'bilibili:BV1first' }),
        makeItem({ id: 'douyin:730', platform: 'douyin' }),
      ],
    })

    stubOpenTabs([])
    const tabsCreate = vi.spyOn(chrome.tabs, 'create')

    const wrapper = mountApp()
    await flushPromises()
    stubRowRects(wrapper)

    const rows = wrapper.findAll('.lw-list__item')
    await longPress(rows[0].element)
    await flushPromises()

    window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 100 }))
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    // 浏览器会在指针抬起后同步补发一次 click，此处不作等待以复现该时序
    await rows[0].find('.lw-list__open').trigger('click')

    expect(tabsCreate).not.toHaveBeenCalled()
  })

  it('删除按钮不参与长按拖拽', async () => {
    await chrome.storage.local.set({ [STORAGE_KEYS.watchList]: [makeItem()] })

    const wrapper = mountApp()
    await flushPromises()
    stubRowRects(wrapper)

    await longPress(wrapper.find('.lw-list__remove').element)
    await flushPromises()

    expect(wrapper.find('.lw-list__item.is-dragging').exists()).toBe(false)
  })
})
