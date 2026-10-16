import { registerVideoInfoExtractor } from '@/content/extractor'
import { mountWatchLaterFab } from '@/content/fab'
import { resolveDouyinTarget } from '@/content/fab/targets'
import { announceContentScriptReady } from '@/content/runtime'

announceContentScriptReady('douyin')

mountWatchLaterFab({
  platform: 'douyin',
  resolveTarget: resolveDouyinTarget,
})

registerVideoInfoExtractor('douyin')
