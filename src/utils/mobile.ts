import type { Plugin } from 'siyuan'
import { getFrontend } from 'siyuan'
import { bookshelfManager } from '@/core/bookshelf'

export const isMobile = () => getFrontend().endsWith('mobile')

export const initMobile = (_p: Plugin) => {
  if (!isMobile()) return
  window.addEventListener('popstate', () => window.dispatchEvent(new CustomEvent('reader:mobile-close')))
}

export const saveMobilePosition = async (bookUrl: string, position: any) => {
  if (!isMobile()) return
  await bookshelfManager.saveSetting(`mobile_pos_${bookUrl}`, position)
}

export const getMobilePosition = async (bookUrl: string) => {
  if (!isMobile()) return null
  return await bookshelfManager.getSetting(`mobile_pos_${bookUrl}`)
}

export const focusMobileEditable = (target: EventTarget | null) => {
  if (!isMobile()) return
  const el = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target : null
  if (!el || el.disabled || el.readOnly) return
  requestAnimationFrame(() => setTimeout(() => {
    el.focus({ preventScroll: true })
    try {
      const pos = el.value?.length ?? 0
      el.setSelectionRange?.(pos, pos)
    } catch {}
  }, 0))
}
