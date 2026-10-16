import type { RuntimeMessage, RuntimeResponse } from '@/shared/types'

/**
 * 向 background 发送运行时消息，并把异常 / 空响应统一归一化为失败结果，
 * 调用方只需判断 response.ok。
 */
export async function sendRuntimeMessage<T = unknown>(
  type: string,
  payload?: unknown,
): Promise<RuntimeResponse<T>> {
  const message: RuntimeMessage = payload === undefined ? { type } : { type, payload }

  try {
    const response: unknown = await chrome.runtime.sendMessage(message)
    if (!response || typeof response !== 'object') {
      return { ok: false, error: '运行时消息响应为空' }
    }
    return response as RuntimeResponse<T>
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
