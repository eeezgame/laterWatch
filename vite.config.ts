import { fileURLToPath, URL } from 'node:url'

import { crx } from '@crxjs/vite-plugin'
import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin } from 'vite'

import manifest from './src/manifest.ts'

const DEV_SERVER_PORT = 5173

/**
 * 开发服务就绪后输出明确的启动标识，提示如何加载插件。
 */
function devStartupBanner(): Plugin {
  return {
    name: 'laterwatch:dev-startup-banner',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address()
        const port = typeof address === 'object' && address ? address.port : DEV_SERVER_PORT

        server.config.logger.info(
          [
            '',
            '  [LaterWatch] 侧边栏插件 dev server 启动成功',
            `  → 开发服务地址：http://localhost:${port}`,
            '  → 插件产物目录：dist/',
            '  → 加载方式：chrome://extensions 开启「开发者模式」后，加载已解压的扩展程序并选择 dist/ 目录',
            '',
          ].join('\n'),
        )
      })
    },
  }
}

export default defineConfig({
  plugins: [vue(), crx({ manifest }), devStartupBanner()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome114',
    sourcemap: false,
  },
  server: {
    port: DEV_SERVER_PORT,
    strictPort: true,
    proxy: {
      // 预留 B 站开放接口联调代理，本地开发时规避跨域限制
      '/api/bilibili': {
        target: 'https://api.bilibili.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/bilibili/, ''),
      },
    },
  },
})
