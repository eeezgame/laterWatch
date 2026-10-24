import type { VideoItem } from '@/shared/types'

export const FAB_ADD_LABEL = 'lw:稍后再看'
export const FAB_ADDED_LABEL = 'lw:已添加'

export interface FabState {
  label: string
  /** 已添加态为只读，不允许再次点击 */
  disabled: boolean
}

/** 收集已在待看清单内的条目 id，回收站中的条目不参与判定 */
export function collectAddedIds(items: VideoItem[]): Set<string> {
  return new Set(items.filter((item) => !item.deletedAt).map((item) => item.id))
}

/** 依据已添加集合推演按钮文案与禁用状态 */
export function resolveFabState(addedIds: ReadonlySet<string>, videoItemId: string): FabState {
  const added = addedIds.has(videoItemId)
  return {
    label: added ? FAB_ADDED_LABEL : FAB_ADD_LABEL,
    disabled: added,
  }
}
