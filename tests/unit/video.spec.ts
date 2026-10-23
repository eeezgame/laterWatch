import { describe, expect, it } from 'vitest'

import type { VideoItem } from '@/shared/types'
import {
  createVideoItem,
  createVideoItemId,
  extractBilibiliVideoId,
  extractDouyinVideoId,
  findExistingVideoTab,
  mergeWatchList,
  normalizeVideoUrl,
  reorderVisibleItems,
} from '@/shared/utils/video'

function createItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'bilibili:BV1xx411c7mD',
    platform: 'bilibili',
    title: '标题',
    url: 'https://www.bilibili.com/video/BV1xx411c7mD',
    addedAt: 1,
    ...overrides,
  }
}

describe('视频标识解析', () => {
  it('从 B 站各种链接形式中解析视频号', () => {
    expect(extractBilibiliVideoId('https://www.bilibili.com/video/BV1xx411c7mD')).toBe(
      'BV1xx411c7mD',
    )
    expect(
      extractBilibiliVideoId('//www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333.999'),
    ).toBe('BV1xx411c7mD')
    expect(extractBilibiliVideoId('https://www.bilibili.com/video/av170001')).toBe('av170001')
  })

  it('非视频链接返回 null', () => {
    expect(extractBilibiliVideoId('https://space.bilibili.com/123')).toBeNull()
    expect(extractDouyinVideoId('https://www.douyin.com/user/MS4wLjAB')).toBeNull()
    expect(extractDouyinVideoId('')).toBeNull()
  })

  it('从抖音链接与弹窗参数中解析视频号', () => {
    expect(extractDouyinVideoId('https://www.douyin.com/video/7300123456789?mode=1')).toBe(
      '7300123456789',
    )
    expect(extractDouyinVideoId('/video/7300123456789')).toBe('7300123456789')
    expect(extractDouyinVideoId('https://www.douyin.com/discover?modal_id=7300123456789')).toBe(
      '7300123456789',
    )
    // 用户主页弹窗：modal_id 是当前视频 ID，同 URL 中的 vid 不是
    expect(
      extractDouyinVideoId(
        'https://www.douyin.com/user/MS4wLjABAAAA?from_tab_name=main&modal_id=7699551142255296713&relation=1&vid=7699214338276206194',
      ),
    ).toBe('7699551142255296713')
    // 精选板块弹窗
    expect(
      extractDouyinVideoId('https://www.douyin.com/jingxuan?modal_id=7672749364330237220'),
    ).toBe('7672749364330237220')
  })
})

describe('待看条目生成', () => {
  it('生成规范地址与去重键', () => {
    expect(normalizeVideoUrl('bilibili', 'BV1xx411c7mD')).toBe(
      'https://www.bilibili.com/video/BV1xx411c7mD',
    )
    expect(normalizeVideoUrl('douyin', '7300123456789')).toBe(
      'https://www.douyin.com/video/7300123456789',
    )
    expect(createVideoItemId('douyin', '7300123456789')).toBe('douyin:7300123456789')
  })

  it('整理标题并写入添加时间，标题为空时兜底', () => {
    const item = createVideoItem(
      { platform: 'douyin', videoId: '7300123456789', title: ' 多   空格标题 ' },
      1000,
    )

    expect(item).toEqual({
      id: 'douyin:7300123456789',
      platform: 'douyin',
      title: '多 空格标题',
      url: 'https://www.douyin.com/video/7300123456789',
      addedAt: 1000,
    })

    expect(createVideoItem({ platform: 'douyin', videoId: '1', title: '   ' }, 1).title).toBe(
      '未命名视频',
    )
  })

  it('仅在存在封面时写入 cover 字段', () => {
    const withoutCover = createVideoItem({ platform: 'bilibili', videoId: 'BV1', title: '标题' }, 1)
    const withCover = createVideoItem(
      { platform: 'bilibili', videoId: 'BV1', title: '标题', cover: ' https://c.jpg ' },
      1,
    )

    expect('cover' in withoutCover).toBe(false)
    expect(withCover.cover).toBe('https://c.jpg')
  })
})

describe('复用已打开的视频标签页', () => {
  const item = createItem({ id: 'bilibili:BV1xx411c7mD' })

  it('命中同一视频的不同链接形式时返回该标签页', () => {
    const tabs = [
      { id: 1, url: 'https://www.bilibili.com/' },
      { id: 2, url: '//www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333.999' },
    ]

    expect(findExistingVideoTab(tabs, item)).toEqual(tabs[1])
  })

  it('无同视频标签页时返回 undefined', () => {
    const tabs = [{ id: 1, url: 'https://www.bilibili.com/video/BV1other' }]

    expect(findExistingVideoTab(tabs, item)).toBeUndefined()
  })

  it('跳过地址缺失的标签页', () => {
    const tabs = [{ id: 1 }, { id: 2, url: 'https://www.bilibili.com/video/BV1xx411c7mD' }]

    expect(findExistingVideoTab(tabs, item)?.id).toBe(2)
  })

  it('按平台区分，B 站条目不会命中抖音标签页', () => {
    const douyinItem = createItem({ id: 'douyin:7300123456789', platform: 'douyin' })
    const tabs = [{ id: 1, url: 'https://www.douyin.com/video/7300123456789?mode=1' }]

    expect(findExistingVideoTab(tabs, douyinItem)).toEqual(tabs[0])
    expect(findExistingVideoTab(tabs, item)).toBeUndefined()
  })
})

describe('待看列表合并去重', () => {
  it('新条目置顶插入', () => {
    const existing = [createItem({ id: 'bilibili:BV1', addedAt: 2 })]
    const incoming = createItem({ id: 'douyin:730', platform: 'douyin', addedAt: 3 })

    const result = mergeWatchList(existing, incoming)

    expect(result.added).toBe(true)
    expect(result.items.map((item) => item.id)).toEqual(['douyin:730', 'bilibili:BV1'])
  })

  it('已存在且未删除时保持列表不变', () => {
    const existing = [createItem()]
    const result = mergeWatchList(existing, createItem({ title: '新标题' }))

    expect(result.added).toBe(false)
    expect(result.items).toBe(existing)
  })

  it('回收站内的同一条目被替换并置顶，等价于顺带恢复', () => {
    const recycled = createItem({ deletedAt: 99 })
    const existing = [createItem({ id: 'douyin:730', platform: 'douyin' }), recycled]
    const incoming = createItem({ addedAt: 5 })

    const result = mergeWatchList(existing, incoming)

    expect(result.added).toBe(true)
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toBe(incoming)
    expect(result.items[0].deletedAt).toBeUndefined()
  })
})

describe('拖拽重排可见条目', () => {
  it('按给定顺序重排全部可见条目', () => {
    const items = [createItem({ id: 'a' }), createItem({ id: 'b' }), createItem({ id: 'c' })]

    expect(reorderVisibleItems(items, ['c', 'a', 'b']).map((item) => item.id)).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('只填充被拖拽条目原本占据的槽位，其余条目原地不动', () => {
    // b 不在可见范围内（例如被平台筛选排除），拖拽 a / c / d 时它的位置不应改变
    const items = [
      createItem({ id: 'a' }),
      createItem({ id: 'b' }),
      createItem({ id: 'c' }),
      createItem({ id: 'd' }),
    ]

    expect(reorderVisibleItems(items, ['d', 'a', 'c']).map((item) => item.id)).toEqual([
      'd',
      'b',
      'a',
      'c',
    ])
  })

  it('顺序与给定顺序一致时内容保持不变', () => {
    const items = [createItem({ id: 'a' }), createItem({ id: 'b' })]

    expect(reorderVisibleItems(items, ['a', 'b']).map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('空顺序或含未知 id 时原样返回列表', () => {
    const items = [createItem({ id: 'a' }), createItem({ id: 'b' })]

    expect(reorderVisibleItems(items, [])).toBe(items)
    expect(reorderVisibleItems(items, ['missing', 'a'])).toEqual(items)
  })
})
