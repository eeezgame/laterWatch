<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

import { PLATFORM_LABELS, RUNTIME_MESSAGE_TYPES } from '@/shared/constants'
import type {
  Platform,
  RuntimeMessage,
  RuntimeResponse,
  VideoDraft,
} from '@/shared/types'

/** tabs.onActivated 回调参数（@types/chrome 未导出该接口，这里内联声明） */
interface TabActiveInfo {
  tabId: number
  windowId: number
}

/** tabs.onUpdated 回调的 changeInfo（同上） */
interface TabChangeInfo {
  status?: string
  url?: string
  title?: string
}

/** 当前视频草稿；null 表示尚未查询或非视频页 */
const draft = ref<VideoDraft | null>(null)

/** 最近一次查询是否成功（false 时展示占位卡片） */
const available = ref(false)

/** 是否正在加载 */
const loading = ref(false)

/** background 广播：当前 tab 的视频信息变化（SPA 导航 / 内容脚本主动上报） */
function handleRuntimeMessage(message: RuntimeMessage): void {
  if (message.type !== RUNTIME_MESSAGE_TYPES.currentVideoChanged) return
  const draftOrNull = (message.payload as VideoDraft | null | undefined) ?? null
  if (draftOrNull) {
    draft.value = draftOrNull
    available.value = true
  } else {
    draft.value = null
    available.value = false
  }
}

async function fetchCurrentVideo(force = false): Promise<void> {
  loading.value = true
  try {
    const response = await chrome.runtime.sendMessage<unknown, RuntimeResponse<VideoDraft | null>>({
      type: RUNTIME_MESSAGE_TYPES.queryCurrentVideo,
      payload: force ? { force: true } : undefined,
    })
    if (response?.ok && response.data) {
      draft.value = response.data
      available.value = true
    } else {
      draft.value = null
      available.value = false
    }
  } catch {
    draft.value = null
    available.value = false
  } finally {
    loading.value = false
  }
}

/** 用户点击刷新按钮：与右键菜单"添加到稍后再看"一致，直接向 content script 拉最新 */
function refreshCurrentVideo(): void {
  void fetchCurrentVideo(true)
}

function handleTabActivated(tabInfo: TabActiveInfo): void {
  chrome.windows.getCurrent((win) => {
    if (!win?.id || win.id !== tabInfo.windowId) return
    void fetchCurrentVideo()
  })
}

function handleTabUpdated(
  _tabId: number,
  changeInfo: TabChangeInfo,
  tab: chrome.tabs.Tab,
): void {
  // 整页加载 / SPA 手动刷新 tab.title 都可能触发
  if (!tab.active) return
  const shouldRefresh =
    changeInfo.status === 'complete' ||
    changeInfo.url !== undefined ||
    changeInfo.title !== undefined
  if (!shouldRefresh) return
  void fetchCurrentVideo()
}

onMounted(() => {
  void fetchCurrentVideo()
  chrome.tabs.onActivated.addListener(handleTabActivated)
  chrome.tabs.onUpdated.addListener(handleTabUpdated)
  chrome.runtime.onMessage.addListener(handleRuntimeMessage)
})

onUnmounted(() => {
  chrome.tabs.onActivated.removeListener(handleTabActivated)
  chrome.tabs.onUpdated.removeListener(handleTabUpdated)
  chrome.runtime.onMessage.removeListener(handleRuntimeMessage)
})

/** 平台徽章的背景色：B站蓝 / 抖音红 */
const PLATFORM_BADGE_COLORS: Record<Platform, string> = {
  bilibili: '#00aeec',
  douyin: '#fe2c55',
  local: '#7a8194',
}
</script>

<template>
  <section class="lw-current">
    <!-- 占位卡片 -->
    <div v-if="!available" class="lw-current__placeholder">
      <div class="lw-current__placeholder-icon" aria-hidden>
        <svg viewBox="0 0 24 24" fill="none" width="28" height="28">
          <path
            d="M4 6h16v12H4V6zm3 3l7 3-7 3V9z"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
        </svg>
      </div>
      <p class="lw-current__placeholder-text">
        {{ loading ? '正在识别当前页面…' : '当前页面不是 B 站 / 抖音视频页' }}
      </p>
      <button
        type="button"
        class="lw-current__refresh"
        :disabled="loading"
        :title="loading ? '识别中' : '重新识别当前页面'"
        @click="refreshCurrentVideo"
      >
        <svg class="lw-current__refresh-icon" :class="{ 'is-spinning': loading }" viewBox="0 0 24 24" fill="none" width="14" height="14">
          <path
            d="M4 12a8 8 0 1 0 2.5-5.8"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
          <path d="M4 4v4h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        刷新
      </button>
    </div>

    <!-- 视频信息卡片 -->
    <article v-else class="lw-current__card">
      <div class="lw-current__cover">
        <img v-if="draft?.cover" :src="draft.cover" :alt="draft.title" />
        <div v-else class="lw-current__cover-fallback" aria-hidden>无封面</div>
      </div>
      <div class="lw-current__info">
        <div class="lw-current__meta-row">
          <span
            class="lw-current__platform"
            :style="{ backgroundColor: PLATFORM_BADGE_COLORS[draft!.platform] }"
          >
            {{ PLATFORM_LABELS[draft!.platform] }}
          </span>
          <button
            type="button"
            class="lw-current__refresh lw-current__refresh--inline"
            :disabled="loading"
            :title="loading ? '刷新中' : '刷新当前视频信息'"
            @click="refreshCurrentVideo"
          >
            <svg class="lw-current__refresh-icon" :class="{ 'is-spinning': loading }" viewBox="0 0 24 24" fill="none" width="14" height="14">
              <path
                d="M4 12a8 8 0 1 0 2.5-5.8"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              />
              <path d="M4 4v4h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
        <h2 class="lw-current__title" :title="draft!.title">{{ draft!.title }}</h2>
      </div>
    </article>
  </section>
</template>
