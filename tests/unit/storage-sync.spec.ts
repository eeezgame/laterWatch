import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { STORAGE_KEYS } from '@/shared/constants'
import type { VideoItem } from '@/shared/types'
import { setItem } from '@/shared/utils/storage'
import { useWatchListStore } from '@/sidepanel/stores/watchlist'

const addedItem: VideoItem = {
  id: 'douyin:7300123456789',
  platform: 'douyin',
  title: '抖音视频',
  url: 'https://www.douyin.com/video/7300123456789',
  addedAt: 1,
}

describe('侧边栏待看列表实时刷新', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('网页悬浮按钮写入 storage 后列表自动更新', async () => {
    const store = useWatchListStore()
    store.bindStorageSync()
    await store.load()

    expect(store.visibleItems).toHaveLength(0)

    await setItem(STORAGE_KEYS.watchList, [addedItem])

    expect(store.visibleItems).toHaveLength(1)
    expect(store.visibleItems[0].title).toBe('抖音视频')
  })

  it('回收站条目不计入待看列表', async () => {
    const store = useWatchListStore()
    store.bindStorageSync()
    await store.load()

    await setItem(STORAGE_KEYS.watchList, [{ ...addedItem, deletedAt: 2 }])

    expect(store.visibleItems).toHaveLength(0)
    expect(store.recycledItems).toHaveLength(1)
  })
})
