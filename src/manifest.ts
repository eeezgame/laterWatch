import { defineManifest } from '@crxjs/vite-plugin'

import pkg from '../package.json' with { type: 'json' }

export default defineManifest({
  manifest_version: 3,
  name: 'LaterWatch 稍后再看',
  version: pkg.version,
  description: '聚合 B 站、抖音网页视频与本地视频的稍后再看侧边栏，支持回收站式删除与恢复。',
  minimum_chrome_version: '114',
  icons: {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
  action: {
    default_title: '打开 LaterWatch 侧边栏',
    default_icon: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
  },
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  permissions: ['storage', 'sidePanel', 'activeTab', 'contextMenus'],
  host_permissions: ['https://*.bilibili.com/*', 'https://*.douyin.com/*'],
  content_scripts: [
    {
      matches: ['https://*.bilibili.com/*'],
      js: ['src/content/bilibili/index.ts'],
      run_at: 'document_idle',
    },
    {
      matches: ['https://*.douyin.com/*'],
      js: ['src/content/douyin/index.ts'],
      run_at: 'document_idle',
    },
  ],
})
