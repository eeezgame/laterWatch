import { CONTEXT_MENU_IDS, RUNTIME_MESSAGE_TYPES, STORAGE_KEYS } from '@/shared/constants'
import type {
  AddWatchLaterResult,
  Platform,
  RuntimeMessage,
  RuntimeResponse,
  VideoDraft,
} from '@/shared/types'
import { getItem, setItem } from '@/shared/utils/storage'
import { createVideoItem, mergeWatchList, normalizeWatchList } from '@/shared/utils/video'

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => {
      console.error('[LaterWatch] 初始化侧边栏行为失败：', error)
    })

  registerContextMenus()
})

/** 创建右键菜单，仅在视频详情页显示 */
function registerContextMenus(): void {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_IDS.addCurrentVideo,
    title: '添加到稍后再看',
    contexts: ['page'],
    documentUrlPatterns: ['*://www.bilibili.com/video/*', '*://www.douyin.com/video/*'],
  })
}

/** 校验来自网页的草稿参数，拦截结构不完整的消息 */
function isVideoDraft(payload: unknown): payload is VideoDraft {
  if (!payload || typeof payload !== 'object') return false

  const draft = payload as Partial<VideoDraft>
  return (
    (draft.platform === 'bilibili' || draft.platform === 'douyin') &&
    typeof draft.videoId === 'string' &&
    draft.videoId.length > 0 &&
    typeof draft.title === 'string'
  )
}

/** 待看列表的唯一写入方：生成条目、去重合并、落盘 */
async function addWatchLater(payload: unknown): Promise<RuntimeResponse<AddWatchLaterResult>> {
  if (!isVideoDraft(payload)) {
    return { ok: false, error: '待看条目参数不完整' }
  }

  const stored = await getItem<unknown>(STORAGE_KEYS.watchList, [])
  const { items: nextItems, added } = mergeWatchList(
    normalizeWatchList(stored),
    createVideoItem(payload),
  )
  if (added) {
    await setItem(STORAGE_KEYS.watchList, nextItems)
  }

  return { ok: true, data: { added } }
}

/** 从 URL 判断平台 */
function resolvePlatform(url: string): Platform | null {
  if (url.includes('bilibili.com')) return 'bilibili'
  if (url.includes('douyin.com')) return 'douyin'
  return null
}

/** 处理右键菜单点击：提取当前视频信息并加入待看列表 */
async function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab,
): Promise<void> {
  if (info.menuItemId !== CONTEXT_MENU_IDS.addCurrentVideo || !tab.id || !tab.url) return

  const platform = resolvePlatform(tab.url)
  if (!platform) return

  try {
    const response = await chrome.tabs.sendMessage<RuntimeMessage, RuntimeResponse<VideoDraft>>(
      tab.id,
      {
        type: RUNTIME_MESSAGE_TYPES.extractVideoInfo,
      },
    )

    if (!response?.ok || !response.data) {
      console.warn('[LaterWatch] 右键菜单提取视频信息失败：', response?.error)
      return
    }

    const result = await addWatchLater(response.data)
    if (!result.ok) {
      console.warn('[LaterWatch] 右键菜单添加失败：', result.error)
    }
  } catch (error) {
    console.error('[LaterWatch] 右键菜单处理异常：', error)
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab) void handleContextMenuClick(info, tab)
})

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, _sender, sendResponse: (response: RuntimeResponse) => void) => {
    if (message.type === RUNTIME_MESSAGE_TYPES.ping) {
      sendResponse({ ok: true, data: 'pong' })
      return false
    }

    if (message.type === RUNTIME_MESSAGE_TYPES.addWatchLater) {
      void addWatchLater(message.payload)
        .then(sendResponse)
        .catch((error: unknown) => {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
        })
      return true
    }

    sendResponse({ ok: false, error: `不支持的消息类型：${message.type}` })
    return false
  },
)
