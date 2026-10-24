<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, nextTick, ref, watch } from 'vue'

import { PLATFORM_LABELS, RUNTIME_MESSAGE_TYPES } from '@/shared/constants'
import { parseCommentSegments } from '@/shared/utils/comment'
import type { VideoItem } from '@/shared/types'
import { findExistingVideoTab } from '@/shared/utils/video'

import { useWatchListStore } from '../stores/watchlist'

/** 长按该时长后进入拖拽排序模式 */
const LONG_PRESS_MS = 300
/** 长按期间指针位移超过该像素即视为点击/滚动，取消拖拽 */
const PRESS_MOVE_TOLERANCE = 8

const store = useWatchListStore()
const { visibleItems, loading, currentVideoKey, filter } = storeToRefs(store)

const listRef = ref<HTMLUListElement | null>(null)

/** 拖拽中的条目顺序（仅内存态，松手才落盘），null 表示未在拖拽 */
const dragOrder = ref<string[] | null>(null)
const draggingId = ref<string | null>(null)
/** 拖拽结束会紧跟一次 click，先屏蔽以免误触发打开视频 */
const suppressClick = ref(false)

/** 当前活动标签页视频对应的条目 id（用于高亮和自动滚动） */
const highlightId = ref<string | null>(null)

/** 正在编辑评论的条目 id，null 表示无条目处于编辑态 */
const editingId = ref<string | null>(null)
/** 编辑态下 textarea 的草稿内容 */
const editDraft = ref('')

let pressTimer: number | null = null
let pressOrigin: { x: number; y: number } | null = null

/** 渲染顺序：拖拽中按内存顺序实时重排，否则用存储顺序 */
const displayItems = computed(() => {
  const order = dragOrder.value
  if (!order) return visibleItems.value

  const byId = new Map(visibleItems.value.map((item) => [item.id, item]))
  return order.map((id) => byId.get(id)).filter((item): item is VideoItem => Boolean(item))
})

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
  if (suppressClick.value) return

  void openVideoInTab(item).catch((error: unknown) => {
    console.error('[LaterWatch] 打开视频失败：', error)
  })
}

/**
 * 点击时间锚点：让右侧视频播放器跳转到指定秒数。
 * 已打开同一视频时激活标签页并发送 seek；未打开时新开标签页（页面加载后可再次点击锚点跳转）。
 */
async function seekTo(item: VideoItem, time: number): Promise<void> {
  const tabs = await chrome.tabs.query({})
  const existing = findExistingVideoTab(tabs, item)

  if (existing && existing.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true })
    if (existing.windowId !== undefined) {
      await chrome.windows.update(existing.windowId, { focused: true })
    }
    await chrome.tabs.sendMessage(existing.id, {
      type: RUNTIME_MESSAGE_TYPES.seekVideo,
      payload: { time },
    })
    return
  }

  await chrome.tabs.create({ url: item.url })
}

/** 进入评论编辑态：把当前评论填入草稿 */
function startEdit(item: VideoItem): void {
  editingId.value = item.id
  editDraft.value = item.comment ?? ''
}

/** 保存评论：trim 后写入存储，空字符串等价于清除评论 */
function saveEdit(item: VideoItem): void {
  void store.updateComment(item.id, editDraft.value).catch((error: unknown) => {
    console.error('[LaterWatch] 保存评论失败：', error)
  })
  editingId.value = null
  editDraft.value = ''
}

/** 取消编辑：丢弃草稿 */
function cancelEdit(): void {
  editingId.value = null
  editDraft.value = ''
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

function clearPressTimer(): void {
  if (pressTimer === null) return

  window.clearTimeout(pressTimer)
  pressTimer = null
}

/** 指针纵向位置落在第几个条目上，用作拖拽落点 */
function resolveDropIndex(clientY: number): number {
  const nodes = listRef.value?.querySelectorAll('.lw-list__item')
  if (!nodes || nodes.length === 0) return -1

  for (let index = 0; index < nodes.length; index += 1) {
    if (clientY < nodes[index].getBoundingClientRect().bottom) return index
  }

  return nodes.length - 1
}

function beginDrag(item: VideoItem): void {
  draggingId.value = item.id
  dragOrder.value = displayItems.value.map((current) => current.id)
}

/** 把拖拽中的条目移到目标下标，实现实时重排 */
function relocateDragging(targetIndex: number): void {
  const order = dragOrder.value
  const id = draggingId.value
  if (!order || !id) return

  const from = order.indexOf(id)
  if (from < 0 || from === targetIndex) return

  const next = [...order]
  next.splice(from, 1)
  next.splice(targetIndex, 0, id)
  dragOrder.value = next
}

function onWindowPointerMove(event: PointerEvent): void {
  if (pressTimer !== null && pressOrigin) {
    const distance = Math.hypot(event.clientX - pressOrigin.x, event.clientY - pressOrigin.y)
    if (distance > PRESS_MOVE_TOLERANCE) clearPressTimer()
  }

  if (!dragOrder.value || !draggingId.value) return

  const targetIndex = resolveDropIndex(event.clientY)
  if (targetIndex >= 0) relocateDragging(targetIndex)
}

/** 结束本次指针会话并移除全局监听 */
function endPointerSession(): void {
  clearPressTimer()
  pressOrigin = null

  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('pointerup', onWindowPointerUp)
  window.removeEventListener('pointercancel', onWindowPointerUp)
}

function onWindowPointerUp(): void {
  const order = dragOrder.value

  endPointerSession()
  draggingId.value = null
  dragOrder.value = null

  if (!order) return

  // 紧随其后的 click 属于同一次拖拽手势，屏蔽掉以免误触发打开视频
  suppressClick.value = true
  window.setTimeout(() => {
    suppressClick.value = false
  }, 0)

  void store.reorderVisible(order).catch((error: unknown) => {
    console.error('[LaterWatch] 保存排序失败：', error)
  })
}

/** 列表项按下：启动长按计时，到点后进入拖拽模式 */
function onItemPointerDown(item: VideoItem, event: PointerEvent): void {
  if (event.button !== 0) return
  // 删除按钮与评论条有自己的点击行为，不参与拖拽
  if (
    (event.target as HTMLElement).closest('.lw-list__remove') ||
    (event.target as HTMLElement).closest('.lw-list__comment')
  )
    return

  clearPressTimer()
  pressOrigin = { x: event.clientX, y: event.clientY }
  pressTimer = window.setTimeout(() => {
    pressTimer = null
    beginDrag(item)
  }, LONG_PRESS_MS)

  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp)
  window.addEventListener('pointercancel', onWindowPointerUp)
}

/** currentVideoKey 变化时更新高亮；filter 变化后重新渲染列表也需要滚动定位 */
function scrollToHighlighted(): void {
  void nextTick(() => {
    const ul = listRef.value
    if (!ul) return
    const target = ul.querySelector<HTMLElement>('.lw-list__item.is-current-video')
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })
}

watch(
  currentVideoKey,
  (key) => {
    highlightId.value = key
    scrollToHighlighted()
  },
  { immediate: true },
)

watch(filter, () => {
  scrollToHighlighted()
})
</script>

<template>
  <section class="lw-list">
    <p v-if="loading" class="lw-list__hint">正在加载待看列表…</p>
    <p v-else-if="visibleItems.length === 0" class="lw-list__hint">
      暂无待看视频，可在 B 站 / 抖音页面添加或导入本地视频
    </p>
    <ul
      v-else
      ref="listRef"
      class="lw-list__items"
      :class="{ 'is-reordering': draggingId !== null }"
    >
      <li
        v-for="item in displayItems"
        :key="item.id"
        class="lw-list__item"
        :class="{
          'is-dragging': item.id === draggingId,
          'is-current-video': item.id === highlightId,
        }"
        @pointerdown="(event: PointerEvent) => onItemPointerDown(item, event)"
      >
        <div class="lw-list__main">
          <button
            type="button"
            class="lw-list__open"
            :class="{ 'is-completed': item.completedAt }"
            :title="`打开视频：${item.title}（长按可拖动排序）`"
            @click="openVideo(item)"
          >
            <span class="lw-list__cover">
              <img
                v-if="item.cover"
                :src="item.cover"
                alt=""
                loading="lazy"
                @error="onCoverError"
              />
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
        </div>

        <!-- 评论条：每个条目至多一条，评论文本中的时间戳会渲染为可点击锚点 -->
        <div v-if="item.comment && editingId !== item.id" class="lw-list__comment">
          <span class="lw-comment__text">
            <template v-for="(seg, idx) in parseCommentSegments(item.comment)" :key="idx">
              <span v-if="seg.type === 'text'">{{ seg.content }}</span>
              <button
                v-else
                type="button"
                class="lw-comment__anchor"
                :title="`跳转到 ${seg.content}`"
                @click="seekTo(item, seg.time!)"
              >
                {{ seg.content }}
              </button>
            </template>
          </span>
          <button
            type="button"
            class="lw-comment__edit"
            :title="`编辑评论：${item.title}`"
            @click="startEdit(item)"
          >
            编辑
          </button>
        </div>

        <!-- 评论编辑态 -->
        <div v-else-if="editingId === item.id" class="lw-list__comment">
          <textarea
            v-model="editDraft"
            class="lw-comment__textarea"
            rows="2"
            placeholder="添加评论，形如 02:15 的时间会自动成为可点击锚点"
          />
          <div class="lw-comment__actions">
            <button type="button" class="lw-comment__save" @click="saveEdit(item)">保存</button>
            <button type="button" class="lw-comment__cancel" @click="cancelEdit">取消</button>
          </div>
        </div>

        <!-- 无评论时的添加入口 -->
        <button
          v-else
          type="button"
          class="lw-list__comment lw-comment__add"
          :title="`为 ${item.title} 添加评论`"
          @click="startEdit(item)"
        >
          添加评论
        </button>
      </li>
    </ul>
  </section>
</template>
