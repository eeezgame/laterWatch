import { PLATFORM_LABELS } from '@/shared/constants'
import type { Platform } from '@/shared/types'

/**
 * 站点内容脚本的就绪标识，便于开发阶段确认脚本已注入目标站点。
 */
export function announceContentScriptReady(platform: Platform): void {
  console.info(`[LaterWatch] ${PLATFORM_LABELS[platform]} 站点内容脚本已注入`)
}
