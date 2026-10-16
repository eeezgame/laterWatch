import { beforeEach, vi } from 'vitest'

type StorageRecords = Record<string, unknown>

interface StorageChange {
  oldValue?: unknown
  newValue?: unknown
}

type StorageChangeListener = (changes: Record<string, StorageChange>, areaName: string) => void

type RuntimeMessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response?: unknown) => void,
) => boolean | undefined

const storageData = new Map<string, unknown>()
const changeListeners = new Set<StorageChangeListener>()
const messageListeners = new Set<RuntimeMessageListener>()

function resolveKeys(keys?: string | string[] | null): string[] {
  if (keys === undefined || keys === null) return [...storageData.keys()]
  return Array.isArray(keys) ? keys : [keys]
}

const chromeStorageMock = {
  storage: {
    local: {
      async get(keys?: string | string[] | null): Promise<StorageRecords> {
        return resolveKeys(keys).reduce<StorageRecords>((acc, key) => {
          if (storageData.has(key)) acc[key] = storageData.get(key)
          return acc
        }, {})
      },
      async set(items: StorageRecords): Promise<void> {
        const changes: Record<string, StorageChange> = {}

        Object.entries(items).forEach(([key, value]) => {
          const oldValue = storageData.get(key)
          if (oldValue === value) return
          changes[key] = { oldValue, newValue: value }
          storageData.set(key, value)
        })

        if (Object.keys(changes).length === 0) return
        changeListeners.forEach((listener) => listener(changes, 'local'))
      },
      async remove(keys: string | string[]): Promise<void> {
        resolveKeys(keys).forEach((key) => storageData.delete(key))
      },
      async clear(): Promise<void> {
        storageData.clear()
      },
    },
    onChanged: {
      addListener(listener: StorageChangeListener): void {
        changeListeners.add(listener)
      },
      removeListener(listener: StorageChangeListener): void {
        changeListeners.delete(listener)
      },
      hasListener(listener: StorageChangeListener): boolean {
        return changeListeners.has(listener)
      },
    },
  },
  runtime: {
    onInstalled: {
      addListener(): void {
        // 测试中不触发 onInstalled，占位以支持 background 模块导入
      },
    },
    onMessage: {
      addListener(listener: RuntimeMessageListener): void {
        messageListeners.add(listener)
      },
      removeListener(listener: RuntimeMessageListener): void {
        messageListeners.delete(listener)
      },
      hasListener(listener: RuntimeMessageListener): boolean {
        return messageListeners.has(listener)
      },
    },
    /** 模拟把消息投递给 background 监听器，与真实运行时一致地遵守 return true 的异步约定 */
    sendMessage(message?: unknown): Promise<unknown> {
      return new Promise((resolve) => {
        let responded = false
        const sendResponse = (response?: unknown): void => {
          responded = true
          resolve(response)
        }

        const keepChannelOpen = [...messageListeners].some(
          (listener) => listener(message, {}, sendResponse) === true,
        )
        if (!keepChannelOpen && !responded) resolve(undefined)
      })
    },
  },
  contextMenus: {
    create(): void {
      // 测试中不验证菜单创建，占位以支持 background 模块导入
    },
    onClicked: {
      addListener(): void {
        // 测试中不触发菜单点击，占位以支持 background 模块导入
      },
    },
  },
  tabs: {
    sendMessage(): Promise<unknown> {
      return Promise.resolve(undefined)
    },
    create(): void {
      // 测试中不验证标签页创建，占位以支持侧边栏跳转逻辑
    },
    query(): Promise<unknown[]> {
      // 默认无已打开标签页，具体用例可通过 spyOn 覆盖返回值
      return Promise.resolve([])
    },
    update(): Promise<unknown> {
      return Promise.resolve(undefined)
    },
  },
  windows: {
    update(): Promise<unknown> {
      return Promise.resolve(undefined)
    },
  },
}

vi.stubGlobal('chrome', chromeStorageMock)

beforeEach(() => {
  storageData.clear()
  changeListeners.clear()
  // messageListeners 故意不清空：background 常驻监听器需跨用例存活
})
