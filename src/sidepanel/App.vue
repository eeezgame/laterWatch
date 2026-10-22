<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'

import { EXTENSION_NAME } from '@/shared/constants'

import CurrentVideoCard from './components/CurrentVideoCard.vue'
import FilterTabs from './components/FilterTabs.vue'
import { useWatchListStore } from './stores/watchlist'
import RecycleBinView from './views/RecycleBinView.vue'
import WatchListView from './views/WatchListView.vue'

type PanelView = 'watchlist' | 'recycle'

const store = useWatchListStore()
const { recycledItems } = storeToRefs(store)

const activeView = ref<PanelView>('watchlist')
const recycleCount = computed(() => recycledItems.value.length)

onMounted(() => {
  void store.load()
  store.bindStorageSync()
})
</script>

<template>
  <div class="lw-app">
    <header class="lw-header">
      <h1 class="lw-header__title">{{ EXTENSION_NAME }}</h1>
      <p class="lw-header__subtitle">跨平台视频稍后再看</p>
      <CurrentVideoCard />
      <FilterTabs v-if="activeView === 'watchlist'" />
    </header>

    <main class="lw-main">
      <WatchListView v-if="activeView === 'watchlist'" />
      <RecycleBinView v-else />
    </main>

    <footer class="lw-footer">
      <button
        v-if="activeView === 'watchlist'"
        type="button"
        class="lw-footer__entry"
        @click="activeView = 'recycle'"
      >
        回收站（{{ recycleCount }}）
      </button>
      <button v-else type="button" class="lw-footer__entry" @click="activeView = 'watchlist'">
        返回待看列表
      </button>
    </footer>
  </div>
</template>
