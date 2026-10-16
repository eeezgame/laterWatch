const TOAST_ROOT_ID = 'lw-toast-root'
const TOAST_DURATION = 1800

export type ToastTone = 'normal' | 'error'

export interface ToastController {
  show(message: string, tone?: ToastTone): void
}

/** 轻量 toast：单例节点挂在 documentElement 上，不影响页面结构与布局 */
export function createToast(): ToastController {
  let host: HTMLDivElement | null = null
  let timer: number | undefined

  function ensureHost(): HTMLDivElement {
    const existing = document.getElementById(TOAST_ROOT_ID)
    if (existing instanceof HTMLDivElement) return existing

    const element = document.createElement('div')
    element.id = TOAST_ROOT_ID
    document.documentElement.appendChild(element)

    return element
  }

  return {
    show(message: string, tone: ToastTone = 'normal'): void {
      host = ensureHost()
      host.textContent = message
      host.classList.toggle('lw-toast--error', tone === 'error')
      host.classList.add('is-visible')

      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        host?.classList.remove('is-visible')
      }, TOAST_DURATION)
    },
  }
}
