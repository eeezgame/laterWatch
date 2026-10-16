<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'

import { PLATFORM_LABELS } from '@/shared/constants'
import type { VideoItem } from '@/shared/types'

import { useWatchListStore } from '../stores/watchlist'

/** 永久删除的二次确认目标：单条条目或整个回收站 */
type PurgeConfirm = { kind: 'item'; id: string; title: string } | { kind: 'all'; count: number }

const store = useWatchListStore()
const { recycledItems } = storeToRefs(store)

const purgeConfirm = ref<PurgeConfirm | null>(null)

const purgeMessage = computed(() => {
  const pending = purgeConfirm.value
  if (!pending) return ''

  return pending.kind === 'all'
    ? `确定要清空回收站吗？共 ${pending.count} 个条目将被永久删除。`
    : `确定要永久删除「${pending.title}」吗？`
})

/** 恢复条目到待看列表 */
function restoreVideo(item: VideoItem): void {
  void store.restoreItem(item.id).catch((error: unknown) => {
    console.error('[LaterWatch] 恢复条目失败：', error)
  })
}

function askPurgeOne(item: VideoItem): void {
  purgeConfirm.value = { kind: 'item', id: item.id, title: item.title }
}

function askClearRecycleBin(): void {
  purgeConfirm.value = { kind: 'all', count: recycledItems.value.length }
}

function cancelPurge(): void {
  purgeConfirm.value = null
}

function confirmPurge(): void {
  const pending = purgeConfirm.value
  if (!pending) return

  purgeConfirm.value = null
  const action = pending.kind === 'all' ? store.clearRecycleBin() : store.purgeItem(pending.id)
  void action.catch((error: unknown) => {
    console.error('[LaterWatch] 永久删除失败：', error)
  })
}
</script>

<template>
  <section class="lw-list">
    <p v-if="recycledItems.length === 0" class="lw-list__hint">回收站为空</p>
    <template v-else>
      <div class="lw-recycle__toolbar">
        <span class="lw-recycle__count">{{ recycledItems.length }} 个条目</span>
        <button type="button" class="lw-recycle__clear" @click="askClearRecycleBin">
          清空回收站
        </button>
      </div>

      <ul class="lw-list__items">
        <li v-for="item in recycledItems" :key="item.id" class="lw-list__item">
          <span class="lw-list__meta">
            <span class="lw-list__title">{{ item.title }}</span>
            <span class="lw-list__platform">{{ PLATFORM_LABELS[item.platform] }}</span>
          </span>
          <button
            type="button"
            class="lw-recycle__action"
            :title="`恢复：${item.title}`"
            @click="restoreVideo(item)"
          >
            恢复
          </button>
          <button
            type="button"
            class="lw-recycle__action lw-recycle__action--danger"
            :title="`永久删除：${item.title}`"
            @click="askPurgeOne(item)"
          >
            永久删除
          </button>
        </li>
      </ul>
    </template>

    <div v-if="purgeConfirm" class="lw-confirm">
      <div class="lw-confirm__dialog" role="dialog" aria-modal="true">
        <p class="lw-confirm__text">{{ purgeMessage }}</p>
        <p class="lw-confirm__warning">永久删除后数据不可恢复。</p>
        <div class="lw-confirm__actions">
          <button type="button" class="lw-confirm__cancel" @click="cancelPurge">取消</button>
          <button type="button" class="lw-confirm__ok" @click="confirmPurge">确认删除</button>
        </div>
      </div>
    </div>
  </section>
</template>
