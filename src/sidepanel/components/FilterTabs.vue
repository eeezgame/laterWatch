<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import { PLATFORM_LABELS, SUPPORTED_PLATFORMS } from '@/shared/constants'
import type { ListFilter } from '@/shared/types'

import { useWatchListStore } from '../stores/watchlist'

const filters: ListFilter[] = ['all', ...SUPPORTED_PLATFORMS]

const store = useWatchListStore()
const { filter } = storeToRefs(store)

/** 每个 tab button 的 ref，key = filter value */
const tabRefs = ref<Partial<Record<ListFilter, HTMLButtonElement>>>({})

function labelOf(value: ListFilter): string {
  return value === 'all' ? '全部' : PLATFORM_LABELS[value]
}

/** filter 变化后，把选中的 tab 滚入可视范围 */
watch(filter, () => {
  void nextTick(() => {
    const el = tabRefs.value[filter.value]
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  })
})
</script>

<template>
  <nav class="lw-filters" aria-label="平台筛选">
    <button
      v-for="item in filters"
      :key="item"
      :ref="(el) => { if (el) tabRefs[item] = el as HTMLButtonElement }"
      type="button"
      class="lw-filters__tab"
      :class="{ 'is-active': filter === item }"
      @click="store.setFilter(item)"
    >
      {{ labelOf(item) }}
    </button>
  </nav>
</template>
