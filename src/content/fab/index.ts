import { RUNTIME_MESSAGE_TYPES, STORAGE_KEYS } from '@/shared/constants'
import type { AddWatchLaterResult, Platform, VideoDraft, VideoItem } from '@/shared/types'
import { sendRuntimeMessage } from '@/shared/utils/messaging'
import { getItem } from '@/shared/utils/storage'
import { createVideoItemId, normalizeWatchList } from '@/shared/utils/video'

import '@/content/fab/style.css'

import { collectAddedIds, resolveFabState } from './state'
import type { CoverTarget } from './targets'
import { createToast } from './toast'

const FAB_ROOT_ID = 'lw-fab-root'
/** 封面左上角的内边距（左上角避免与 B 站/抖音原生「稍后再看」按钮重叠） */
const FAB_OFFSET = 8
/** 鼠标离开封面到按钮之间的缓冲时间 */
const HIDE_DELAY = 150

const FAB_CONTENT = `
<svg class="lw-fab__icon lw-fab__icon--clock" viewBox="0 0 24 24" aria-hidden="true">
  <circle cx="12" cy="12" r="8.5" />
  <path d="M12 7.2V12l3.2 1.9" />
</svg>
<svg class="lw-fab__icon lw-fab__icon--check" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M5 12.8l4.2 4.2L19 7.2" />
</svg>
<span class="lw-fab__label"></span>
`

export interface WatchLaterFabAdapter {
  platform: Platform
  resolveTarget(node: Element | null): CoverTarget | null
}

/**
 * 在目标站点挂载「稍后再看」悬浮按钮：按钮与 toast 均为挂载在 documentElement
 * 上的单例节点，用坐标跟随鼠标所在封面，不修改页面自身 DOM 结构。
 */
export function mountWatchLaterFab(adapter: WatchLaterFabAdapter): void {
  if (document.getElementById(FAB_ROOT_ID)) return

  const host = document.createElement('button')
  host.id = FAB_ROOT_ID
  host.type = 'button'
  host.className = 'is-hidden'
  host.innerHTML = FAB_CONTENT
  document.documentElement.appendChild(host)

  const label = host.querySelector('.lw-fab__label')
  const toast = createToast()
  const addedIds = new Set<string>()

  let currentTarget: CoverTarget | null = null
  let currentItemId = ''
  let hideTimer: number | undefined

  function positionHost(): void {
    if (!currentTarget) return

    const rect = currentTarget.element.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      hideHost()
      return
    }

    host.style.top = `${rect.top + FAB_OFFSET}px`
    host.style.left = `${rect.left + FAB_OFFSET}px`
  }

  function applyState(): void {
    const state = resolveFabState(addedIds, currentItemId)
    if (label) label.textContent = state.label
    host.classList.toggle('is-added', state.disabled)
    host.disabled = state.disabled
  }

  function hideHost(): void {
    currentTarget = null
    currentItemId = ''
    host.classList.add('is-hidden')
    host.disabled = false
  }

  function clearHideTimer(): void {
    if (hideTimer === undefined) return
    window.clearTimeout(hideTimer)
    hideTimer = undefined
  }

  function scheduleHide(): void {
    clearHideTimer()
    hideTimer = window.setTimeout(() => {
      hideTimer = undefined
      hideHost()
    }, HIDE_DELAY)
  }

  function showFor(target: CoverTarget): void {
    currentTarget = target
    currentItemId = createVideoItemId(adapter.platform, target.videoId)
    applyState()
    positionHost()
    host.classList.remove('is-hidden')
  }

  function onMouseOver(event: MouseEvent): void {
    const node = event.target
    if (!(node instanceof Element)) return

    // 鼠标移到按钮自身时保持当前状态，避免「封面 → 按钮」途中消失
    if (host.contains(node)) {
      clearHideTimer()
      return
    }

    const target = adapter.resolveTarget(node)
    if (!target) {
      scheduleHide()
      return
    }

    clearHideTimer()
    const itemId = createVideoItemId(adapter.platform, target.videoId)
    if (currentTarget?.element === target.element && currentItemId === itemId) return

    showFor(target)
  }

  function onViewportChange(): void {
    if (currentTarget) positionHost()
  }

  function syncAddedIds(items: VideoItem[]): void {
    addedIds.clear()
    collectAddedIds(items).forEach((id) => addedIds.add(id))
    if (currentTarget) applyState()
  }

  async function addCurrentTarget(): Promise<void> {
    if (!currentTarget || host.disabled) return

    const target = currentTarget
    const itemId = currentItemId
    const draft: VideoDraft = {
      platform: adapter.platform,
      videoId: target.videoId,
      title: target.title,
    }
    if (target.cover) draft.cover = target.cover

    host.disabled = true
    const response = await sendRuntimeMessage<AddWatchLaterResult>(
      RUNTIME_MESSAGE_TYPES.addWatchLater,
      draft,
    )

    if (!response.ok) {
      host.disabled = false
      toast.show('添加失败，请重试', 'error')
      return
    }

    addedIds.add(itemId)
    if (currentItemId === itemId) applyState()
    else host.disabled = false

    toast.show(response.data?.added === false ? '该视频已在稍后再看中' : '已加入稍后再看')
  }

  host.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    void addCurrentTarget()
  })

  document.addEventListener('mouseover', onMouseOver, true)
  window.addEventListener('scroll', onViewportChange, { capture: true, passive: true })
  window.addEventListener('resize', onViewportChange, { passive: true })

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return

    const change = changes[STORAGE_KEYS.watchList]
    if (!change) return

    syncAddedIds(normalizeWatchList(change.newValue))
  })

  void getItem<unknown>(STORAGE_KEYS.watchList, []).then((value) => {
    syncAddedIds(normalizeWatchList(value))
  })
}
