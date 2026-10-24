import { computed, ref, toRaw } from 'vue'
import { defineStore } from 'pinia'

import { STORAGE_KEYS } from '@/shared/constants'
import type { ListFilter, VideoDraft, VideoItem } from '@/shared/types'
import { createVideoItemId, normalizeWatchList, reorderVisibleItems } from '@/shared/utils/video'
import { getItem, setItem } from '@/shared/utils/storage'

/** 移除条目的删除标记，使其回到待看列表（不修改入参） */
function withoutDeletedAt(item: VideoItem): VideoItem {
  const restored = { ...item }
  delete restored.deletedAt
  return restored
}

export const useWatchListStore = defineStore('watchList', () => {
  const items = ref<VideoItem[]>([])
  const filter = ref<ListFilter>('all')
  const loading = ref(false)

  /** 当前活动标签页的视频草稿，null 表示非视频页或尚未识别 */
  const currentDraft = ref<VideoDraft | null>(null)

  /** 当前草稿对应的待看条目 id（platform:videoId 格式），null 表示无 */
  const currentVideoKey = computed<string | null>(() => {
    const draft = currentDraft.value
    return draft ? createVideoItemId(draft.platform, draft.videoId) : null
  })

  /** 待看列表可见条目：排除回收站条目并按平台筛选 */
  const visibleItems = computed(() =>
    items.value.filter(
      (item) => !item.deletedAt && (filter.value === 'all' || item.platform === filter.value),
    ),
  )

  /** 回收站条目 */
  const recycledItems = computed(() => items.value.filter((item) => Boolean(item.deletedAt)))

  async function load(): Promise<void> {
    loading.value = true
    try {
      items.value = normalizeWatchList(await getItem<unknown>(STORAGE_KEYS.watchList, []))
    } finally {
      loading.value = false
    }
  }

  /**
   * 落盘待看列表。写入前必须脱去 Vue 的响应式代理：
   * chrome.storage 无法序列化 Proxy（structuredClone 会直接抛错），
   * 直接写入会失败并留下脏数据，导致后续所有添加操作中断。
   */
  async function persist(): Promise<void> {
    await setItem(
      STORAGE_KEYS.watchList,
      items.value.map((item) => ({ ...toRaw(item) })),
    )
  }

  /** 将条目移入回收站：仅写入删除时间，原始数据保留以便恢复 */
  async function moveToRecycleBin(id: string): Promise<void> {
    const target = items.value.find((item) => item.id === id)
    if (!target || target.deletedAt) return

    const now = Date.now()
    items.value = items.value.map((item) => (item.id === id ? { ...item, deletedAt: now } : item))
    await persist()
  }

  /** 从回收站恢复条目：清除删除时间，凭原始添加时间回到待看列表原位置 */
  async function restoreItem(id: string): Promise<void> {
    const target = items.value.find((item) => item.id === id)
    if (!target?.deletedAt) return

    items.value = items.value.map((item) => (item.id === id ? withoutDeletedAt(item) : item))
    await persist()
  }

  /** 永久删除单条：从数据中彻底移除，不可恢复 */
  async function purgeItem(id: string): Promise<void> {
    if (!items.value.some((item) => item.id === id)) return

    items.value = items.value.filter((item) => item.id !== id)
    await persist()
  }

  /** 清空回收站：一次性移除全部已删除条目，不可恢复 */
  async function clearRecycleBin(): Promise<void> {
    if (recycledItems.value.length === 0) return

    items.value = items.value.filter((item) => !item.deletedAt)
    await persist()
  }

  /** 应用拖拽后的可见条目顺序：顺序未变化时不产生写入 */
  async function reorderVisible(orderedIds: string[]): Promise<void> {
    const next = reorderVisibleItems(items.value, orderedIds)
    const changed = next.some((item, index) => item.id !== items.value[index]?.id)
    if (!changed) return

    items.value = next
    await persist()
  }

  /**
   * 更新单条条目的评论文本。每个条目至多一条评论：
   * 传入空字符串时清除评论字段，保持数据结构精简。
   */
  async function updateComment(id: string, comment: string): Promise<void> {
    const target = items.value.find((item) => item.id === id)
    if (!target) return

    const trimmed = comment.trim()
    items.value = items.value.map((item) => {
      if (item.id !== id) return item
      const next = { ...item }
      if (trimmed) next.comment = trimmed
      else delete next.comment
      return next
    })
    await persist()
  }

  /** 订阅 storage 变更，使网页悬浮按钮添加的条目即时出现在侧边栏 */
  function bindStorageSync(): void {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return

      const change = changes[STORAGE_KEYS.watchList]
      if (!change) return

      items.value = normalizeWatchList(change.newValue)
    })
  }

  function setFilter(next: ListFilter): void {
    filter.value = next
  }

  /** 更新当前活动标签页的视频草稿（识别到视频时调用） */
  function setCurrentDraft(draft: VideoDraft): void {
    currentDraft.value = draft
  }

  /** 清空当前活动标签页的视频草稿（非视频页或切换 tab 时未识别到） */
  function clearCurrentDraft(): void {
    currentDraft.value = null
  }

  return {
    items,
    filter,
    loading,
    visibleItems,
    recycledItems,
    currentDraft,
    currentVideoKey,
    load,
    persist,
    moveToRecycleBin,
    restoreItem,
    purgeItem,
    clearRecycleBin,
    reorderVisible,
    updateComment,
    bindStorageSync,
    setFilter,
    setCurrentDraft,
    clearCurrentDraft,
  }
})
