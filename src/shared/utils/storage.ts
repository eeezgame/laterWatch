/**
 * chrome.storage.local 的 Promise 封装，作为插件本地数据的统一读写入口。
 */
export async function getItem<T>(key: string, fallback: T): Promise<T> {
  const result = await chrome.storage.local.get(key)
  const value = result[key] as T | undefined
  return value === undefined ? fallback : value
}

export async function setItem<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value })
}

export async function removeItem(key: string): Promise<void> {
  await chrome.storage.local.remove(key)
}
