import { registerVideoInfoExtractor } from '@/content/extractor'
import { mountWatchLaterFab } from '@/content/fab'
import { resolveBilibiliTarget } from '@/content/fab/targets'
import { announceContentScriptReady } from '@/content/runtime'

announceContentScriptReady('bilibili')

mountWatchLaterFab({
  platform: 'bilibili',
  resolveTarget: resolveBilibiliTarget,
})

registerVideoInfoExtractor('bilibili')
