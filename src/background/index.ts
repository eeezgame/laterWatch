import { CONTEXT_MENU_IDS, RUNTIME_MESSAGE_TYPES, STORAGE_KEYS } from '@/shared/constants'
import type {
  AddWatchLaterResult,
  Platform,
  RuntimeMessage,
  RuntimeResponse,
  VideoDraft,
} from '@/shared/types'
import { getItem, setItem } from '@/shared/utils/storage'
import {
  createVideoItem,
  createVideoItemId,
  mergeWatchList,
  normalizeWatchList,
  resolveVideoKeyFromUrl,
} from '@/shared/utils/video'

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
    documentUrlPatterns: [
      '*://www.bilibili.com/video/*',
      '*://www.douyin.com/video/*',
      // 抖音弹窗视频页：用户主页 / 精选等板块通过 modal_id 参数播放视频
      '*://www.douyin.com/user/*',
      '*://www.douyin.com/jingxuan*',
    ],
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

/**
 * 缓存每个活动 tab 当前的视频草稿，key = tab.id
 * 用于在 content script 主动上报后，侧栏 queryCurrentVideo 能直接命中最新数据。
 */
const currentVideoByTab = new Map<number, VideoDraft>()

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, sender, sendResponse: (response: RuntimeResponse) => void) => {
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

    if (message.type === RUNTIME_MESSAGE_TYPES.queryCurrentVideo) {
      const force = (message.payload as { force?: boolean } | undefined)?.force === true
      void queryCurrentVideo(force).then(sendResponse)
      return true
    }

    if (message.type === RUNTIME_MESSAGE_TYPES.currentVideoChanged) {
      const tabId = sender.tab?.id
      // 只在内容脚本上报时处理：background 自己的广播也会回到本监听器，
      // 若不加来源判断会反复转播（扩展页面之间互相震）。
      if (tabId) {
        const draft = message.payload as VideoDraft | undefined
        if (draft) currentVideoByTab.set(tabId, draft)
        else currentVideoByTab.delete(tabId)

        // 广播给所有 runtime context（包括侧栏），侧栏用它实时刷新卡片
        void chrome.runtime
          .sendMessage({
            type: RUNTIME_MESSAGE_TYPES.currentVideoChanged,
            payload: message.payload ?? null,
          })
          // 侧栏未打开时没有接收方，忽略该错误
          .catch(() => {})
      }
      sendResponse({ ok: true })
      return false
    }

    sendResponse({ ok: false, error: `不支持的消息类型：${message.type}` })
    return false
  },
)

/** tab 关闭时清理缓存 */
chrome.tabs.onRemoved.addListener((tabId) => {
  currentVideoByTab.delete(tabId)
})

/**
 * 侧栏调用：查询当前活动标签页的视频信息。
 * 正常查询优先读 content script 主动上报的缓存；
 * force=true（用户点击刷新按钮）时跳过缓存，直接向 content script 拉取最新，
 * 与右键菜单"添加到稍后再看"的提取逻辑保持一致。
 * 无论哪种模式，成功提取后都会回写缓存。
 */
async function queryCurrentVideo(force = false): Promise<RuntimeResponse<VideoDraft | null>> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !tab.url) {
    return { ok: false, data: null }
  }

  if (!force) {
    // 优先读缓存（content script 主动上报过的最新数据）；
    // 但缓存必须仍对应当前 tab 地址里的视频，SPA 切到新视频后旧缓存立即作废。
    const cached = currentVideoByTab.get(tab.id)
    const tabVideoKey = resolveVideoKeyFromUrl(tab.url)
    if (cached && tabVideoKey === createVideoItemId(cached.platform, cached.videoId)) {
      return { ok: true, data: cached }
    }
  }

  const platform = resolvePlatform(tab.url)
  if (!platform) {
    return { ok: false, data: null }
  }

  // 直接向 content script 拉取；force 模式与右键菜单完全等价。
  // 非 force 且缓存未命中时，沿用 background 层的一次短延时重试兜底。
  try {
    const response = await sendAndWait(tab.id, { type: RUNTIME_MESSAGE_TYPES.queryCurrentVideo })
    if (response?.ok && response.data) {
      // 回写缓存，让后续查询命中
      currentVideoByTab.set(tab.id, response.data)
      return { ok: true, data: response.data }
    }
  } catch {
    if (!force) {
      // 首次 sendMessage 失败（content script 尚未注入），等 600ms 再试一次
      await new Promise((resolve) => setTimeout(resolve, 600))
      try {
        const response = await sendAndWait(tab.id, {
          type: RUNTIME_MESSAGE_TYPES.queryCurrentVideo,
        })
        if (response?.ok && response.data) {
          currentVideoByTab.set(tab.id, response.data)
          return { ok: true, data: response.data }
        }
      } catch {
        // 重试仍失败，交给侧栏
      }
    }
  }

  return { ok: false, data: null }
}

/** chrome.tabs.sendMessage 的泛型薄包装 */
function sendAndWait(
  tabId: number,
  message: RuntimeMessage,
): Promise<RuntimeResponse<VideoDraft | null>> {
  return chrome.tabs.sendMessage(tabId, message) as Promise<RuntimeResponse<VideoDraft | null>>
}
