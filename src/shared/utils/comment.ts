/**
 * 评论文本中可点击的时间锚点匹配规则：
 * - MM:SS  如 02:15、9:05
 * - HH:MM:SS  如 1:02:15、00:01:30
 * 数字两侧用单词边界约束，避免把版本号、日期等误判为时间。
 */
const TIME_ANCHOR_PATTERN = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g

/** 评论片段：纯文本或可点击的时间锚点 */
export interface CommentSegment {
  type: 'text' | 'anchor'
  /** 原始文本片段 */
  content: string
  /** 仅 anchor 类型有值：换算后的总秒数 */
  time?: number
}

/**
 * 把形如 02:15 / 1:02:15 的时间字符串换算成秒数。
 * 分钟 / 秒数 ≥ 60 时视为非法，返回 null。
 */
export function parseTimeAnchor(raw: string): number | null {
  const parts = raw.split(':').map((part) => Number.parseInt(part, 10))
  if (parts.some((part) => Number.isNaN(part))) return null

  if (parts.length === 2) {
    const [minutes, seconds] = parts
    if (seconds >= 60) return null
    return minutes * 60 + seconds
  }

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts
    if (minutes >= 60 || seconds >= 60) return null
    return hours * 3600 + minutes * 60 + seconds
  }

  return null
}

/**
 * 把评论文本拆成「纯文本 + 时间锚点」片段序列，
 * 供侧栏渲染时把锚点替换为可点击元素。
 */
export function parseCommentSegments(comment: string): CommentSegment[] {
  const segments: CommentSegment[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  TIME_ANCHOR_PATTERN.lastIndex = 0
  while ((match = TIME_ANCHOR_PATTERN.exec(comment)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: comment.slice(lastIndex, match.index) })
    }

    const time = parseTimeAnchor(match[0])
    segments.push(
      time === null
        ? { type: 'text', content: match[0] }
        : { type: 'anchor', content: match[0], time },
    )
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < comment.length) {
    segments.push({ type: 'text', content: comment.slice(lastIndex) })
  }

  return segments
}
