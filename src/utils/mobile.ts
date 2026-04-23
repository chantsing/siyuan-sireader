/**
 * 移动端管理器
 */
import type { Plugin } from 'siyuan'
import { getFrontend } from 'siyuan'
import { bookshelfManager } from '@/core/bookshelf'

export const isMobile = () => getFrontend().endsWith('mobile')

export const initMobile = (_p: Plugin) => {
  if (isMobile()) window.addEventListener('popstate', () => window.dispatchEvent(new CustomEvent('reader:close')))
}

export const saveMobilePosition = async (bookUrl: string, position: any) => {
  if (!isMobile()) return
  await bookshelfManager.saveSetting(`mobile_pos_${bookUrl}`, position)
}

export const getMobilePosition = async (bookUrl: string) => {
  if (!isMobile()) return null
  return await bookshelfManager.getSetting(`mobile_pos_${bookUrl}`)
}
