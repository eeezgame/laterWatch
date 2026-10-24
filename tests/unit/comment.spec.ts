import { describe, expect, it } from 'vitest'

import { parseCommentSegments, parseTimeAnchor } from '@/shared/utils/comment'

describe('parseTimeAnchor', () => {
  it('MM:SS 格式换算为秒数', () => {
    expect(parseTimeAnchor('02:15')).toBe(135)
    expect(parseTimeAnchor('00:00')).toBe(0)
    expect(parseTimeAnchor('9:05')).toBe(545)
    expect(parseTimeAnchor('59:59')).toBe(3599)
  })

  it('HH:MM:SS 格式换算为秒数', () => {
    expect(parseTimeAnchor('1:02:15')).toBe(3735)
    expect(parseTimeAnchor('00:01:30')).toBe(90)
    expect(parseTimeAnchor('01:00:00')).toBe(3600)
  })

  it('秒数 ≥ 60 时视为非法（分钟数允许到 99）', () => {
    expect(parseTimeAnchor('02:60')).toBeNull()
    expect(parseTimeAnchor('00:99')).toBeNull()
    // 60:00 = 60 分钟，合法
    expect(parseTimeAnchor('60:00')).toBe(3600)
    expect(parseTimeAnchor('01:60:00')).toBeNull()
  })

  it('非时间字符串返回 null', () => {
    expect(parseTimeAnchor('abc')).toBeNull()
    expect(parseTimeAnchor('2024-01-01')).toBeNull()
  })
})

describe('parseCommentSegments', () => {
  it('纯文本评论拆为单个 text 片段', () => {
    expect(parseCommentSegments('这段评论没有时间锚点')).toEqual([
      { type: 'text', content: '这段评论没有时间锚点' },
    ])
  })

  it('MM:SS 锚点被识别为 anchor 片段并携带秒数', () => {
    expect(parseCommentSegments('精彩片段在 02:15 处')).toEqual([
      { type: 'text', content: '精彩片段在 ' },
      { type: 'anchor', content: '02:15', time: 135 },
      { type: 'text', content: ' 处' },
    ])
  })

  it('HH:MM:SS 锚点同样被识别', () => {
    expect(parseCommentSegments('开头 1:02:15 结尾')).toEqual([
      { type: 'text', content: '开头 ' },
      { type: 'anchor', content: '1:02:15', time: 3735 },
      { type: 'text', content: ' 结尾' },
    ])
  })

  it('一条评论中可包含多个时间锚点', () => {
    expect(parseCommentSegments('00:00 开场 05:30 高潮')).toEqual([
      { type: 'anchor', content: '00:00', time: 0 },
      { type: 'text', content: ' 开场 ' },
      { type: 'anchor', content: '05:30', time: 330 },
      { type: 'text', content: ' 高潮' },
    ])
  })

  it('非法时间（秒数 ≥ 60）按纯文本处理，不生成锚点', () => {
    const segments = parseCommentSegments('错误时间 02:99 不算锚点')
    expect(segments).toEqual([
      { type: 'text', content: '错误时间 ' },
      { type: 'text', content: '02:99' },
      { type: 'text', content: ' 不算锚点' },
    ])
  })

  it('空字符串返回空片段数组', () => {
    expect(parseCommentSegments('')).toEqual([])
  })
})
