import { describe, expect, it } from 'vitest'

import { getItem, removeItem, setItem } from '@/shared/utils/storage'

describe('shared/utils/storage', () => {
  it('读取不存在的键时返回兜底值', async () => {
    await expect(getItem('lw:missing', 'fallback')).resolves.toBe('fallback')
  })

  it('写入后可原样读回', async () => {
    const payload = [
      { id: '1', platform: 'bilibili' as const, title: '示例', url: 'https://x', addedAt: 1 },
    ]

    await setItem('lw:watch-list', payload)

    await expect(getItem('lw:watch-list', [])).resolves.toEqual(payload)
  })

  it('删除后重新读取返回兜底值', async () => {
    await setItem('lw:settings', { theme: 'light' })
    await removeItem('lw:settings')

    await expect(getItem('lw:settings', {})).resolves.toEqual({})
  })
})
