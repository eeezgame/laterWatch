<script setup lang="ts">
import { storeToRefs } from 'pinia'

import { PLATFORM_LABELS, SUPPORTED_PLATFORMS } from '@/shared/constants'
import type { ListFilter } from '@/shared/types'

import { useWatchListStore } from '../stores/watchlist'

const filters: ListFilter[] = ['all', ...SUPPORTED_PLATFORMS]

const store = useWatchListStore()
const { filter } = storeToRefs(store)

function labelOf(value: ListFilter): string {
  return value === 'all' ? '全部' : PLATFORM_LABELS[value]
}
</script>

<template>
  <nav class="lw-filters" aria-label="平台筛选">
    <button
      v-for="item in filters"
      :key="item"
      type="button"
      class="lw-filters__tab"
      :class="{ 'is-active': filter === item }"
      @click="store.setFilter(item)"
    >
      {{ labelOf(item) }}
    </button>
  </nav>
</template>
