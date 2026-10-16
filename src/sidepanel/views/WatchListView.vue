<script setup lang="ts">
import { storeToRefs } from 'pinia'

import { PLATFORM_LABELS } from '@/shared/constants'
import type { VideoItem } from '@/shared/types'
import { findExistingVideoTab } from '@/shared/utils/video'

import { useWatchListStore } from '../stores/watchlist'

const store = useWatchListStore()
const { visibleItems, loading } = storeToRefs(store)

/**
 * 跳转视频播放页：浏览器已打开同一视频时激活该标签页，
 * 否则新开标签页（B 站继承原生观看进度，抖音跳转对应链接）。
 */
async function openVideoInTab(item: VideoItem): Promise<void> {
  const tabs = await chrome.tabs.query({})
  const existing = findExistingVideoTab(tabs, item)

  if (existing && existing.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true })
    if (existing.windowId !== undefined) {
      await chrome.windows.update(existing.windowId, { focused: true })
    }
    return
  }

  await chrome.tabs.create({ url: item.url })
}

function openVideo(item: VideoItem): void {
  void openVideoInTab(item).catch((error: unknown) => {
    console.error('[LaterWatch] 打开视频失败：', error)
  })
}

/** 封面加载失败时隐藏 img，露出占位底色 */
function onCoverError(event: Event): void {
  const img = event.target as HTMLImageElement
  img.style.display = 'none'
}

/** 移入回收站：条目从待看列表消失，可在回收站恢复 */
function removeVideo(item: VideoItem): void {
  void store.moveToRecycleBin(item.id).catch((error: unknown) => {
    console.error('[LaterWatch] 移入回收站失败：', error)
  })
}
</script>

<template>
  <section class="lw-list">
    <p v-if="loading" class="lw-list__hint">正在加载待看列表…</p>
    <p v-else-if="visibleItems.length === 0" class="lw-list__hint">
      暂无待看视频，可在 B 站 / 抖音页面添加或导入本地视频
    </p>
    <ul v-else class="lw-list__items">
      <li v-for="item in visibleItems" :key="item.id" class="lw-list__item">
        <button
          type="button"
          class="lw-list__open"
          :class="{ 'is-completed': item.completedAt }"
          :title="`打开视频：${item.title}`"
          @click="openVideo(item)"
        >
          <span class="lw-list__cover">
            <img v-if="item.cover" :src="item.cover" alt="" loading="lazy" @error="onCoverError" />
          </span>
          <span class="lw-list__meta">
            <span class="lw-list__title">{{ item.title }}</span>
            <span class="lw-list__platform">{{ PLATFORM_LABELS[item.platform] }}</span>
          </span>
        </button>
        <button
          type="button"
          class="lw-list__remove"
          :title="`移入回收站：${item.title}`"
          @click="removeVideo(item)"
        >
          删除
        </button>
      </li>
    </ul>
  </section>
</template>
