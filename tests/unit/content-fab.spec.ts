import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  collectAddedIds,
  FAB_ADD_LABEL,
  FAB_ADDED_LABEL,
  resolveFabState,
} from '@/content/fab/state'
import { resolveBilibiliTarget, resolveDouyinTarget } from '@/content/fab/targets'
import type { VideoItem } from '@/shared/types'

const COVER_RECT = {
  top: 100,
  left: 40,
  right: 280,
  bottom: 235,
  width: 240,
  height: 135,
  x: 40,
  y: 100,
} as unknown as DOMRect

let rectSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  document.body.innerHTML = ''
  document.title = '页面标题'
  rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(COVER_RECT)
})

describe('B 站封面目标解析', () => {
  it('从卡片封面抽取视频号、标题与封面地址', () => {
    document.body.innerHTML = `
      <div class="bili-video-card">
        <a class="bili-video-card__wrap" href="//www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333" title="B 站视频标题">
          <img src="https://i0.hdslb.com/cover.jpg" alt="">
        </a>
      </div>
    `

    const image = document.querySelector('img')
    const target = resolveBilibiliTarget(image)

    expect(target).toMatchObject({
      platform: 'bilibili',
      videoId: 'BV1xx411c7mD',
      title: 'B 站视频标题',
      cover: 'https://i0.hdslb.com/cover.jpg',
    })
    expect(target?.element).toBe(image)
  })

  it('标题缺失时退化为页面标题', () => {
    document.body.innerHTML = `<a href="/video/BV1aaaaaa1111"><img src="https://i0.hdslb.com/d.jpg"></a>`
    document.title = 'B 站 - 首页'

    expect(resolveBilibiliTarget(document.querySelector('img'))?.title).toBe('B 站 - 首页')
  })

  it('非视频锚点返回 null', () => {
    document.body.innerHTML = `<a href="/read/manga/1"><img src="https://i0.hdslb.com/x.jpg"></a>`

    expect(resolveBilibiliTarget(document.querySelector('img'))).toBeNull()
  })

  it('尺寸过小的封面不生成目标', () => {
    document.body.innerHTML = `<a href="/video/BV1aaaaaa1111"><img src="https://i0.hdslb.com/x.jpg"></a>`
    rectSpy.mockReturnValue({ ...COVER_RECT, width: 20, height: 20 } as unknown as DOMRect)

    expect(resolveBilibiliTarget(document.querySelector('img'))).toBeNull()
  })
})

describe('抖音封面目标解析', () => {
  it('支持相对链接并优先使用封面 alt 作为标题', () => {
    document.body.innerHTML = `
      <div class="card">
        <a href="/video/7300123456789">
          <img alt="抖音短视频标题" src="https://p3.douyinpic.com/cover.jpeg">
        </a>
      </div>
    `

    const target = resolveDouyinTarget(document.querySelector('img'))

    expect(target).toMatchObject({
      platform: 'douyin',
      videoId: '7300123456789',
      title: '抖音短视频标题',
      cover: 'https://p3.douyinpic.com/cover.jpeg',
    })
  })

  it('非视频链接不生成目标', () => {
    document.body.innerHTML = `<a href="/user/MS4wLjAB"><img src="https://p3.douyinpic.com/a.jpeg"></a>`

    expect(resolveDouyinTarget(document.querySelector('img'))).toBeNull()
  })
})

describe('悬浮按钮状态', () => {
  const items: VideoItem[] = [
    {
      id: 'bilibili:BV1xx411c7mD',
      platform: 'bilibili',
      title: '待看中',
      url: 'https://www.bilibili.com/video/BV1xx411c7mD',
      addedAt: 1,
    },
    {
      id: 'douyin:7300123456789',
      platform: 'douyin',
      title: '已删除',
      url: 'https://www.douyin.com/video/7300123456789',
      addedAt: 2,
      deletedAt: 3,
    },
  ]

  it('回收站中的条目不参与已添加判定', () => {
    const addedIds = collectAddedIds(items)

    expect(addedIds.has('bilibili:BV1xx411c7mD')).toBe(true)
    expect(addedIds.has('douyin:7300123456789')).toBe(false)
  })

  it('已添加态为只读，未添加态可点击', () => {
    const addedIds = collectAddedIds(items)

    expect(resolveFabState(addedIds, 'bilibili:BV1xx411c7mD')).toEqual({
      label: FAB_ADDED_LABEL,
      disabled: true,
    })
    expect(resolveFabState(addedIds, 'douyin:7300123456789')).toEqual({
      label: FAB_ADD_LABEL,
      disabled: false,
    })
  })
})
