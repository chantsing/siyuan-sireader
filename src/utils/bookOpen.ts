import { openTab } from 'siyuan'
import type { Plugin } from 'siyuan'
import { bookshelfManager, type Book } from '@/core/bookshelf'
import type { ReaderSettings } from '@/composables/useSetting'
import { isMobile } from '@/utils/mobile'

type TabPosition = 'right' | 'bottom'
type NativePdfTarget = { kind: 'asset' | 'pdf'; path: string }
type OpenModeSettings = Pick<ReaderSettings, 'openMode' | 'openDocAssets'>

// 查找已打开的阅读器标签页
export const findOpenedTab = (bookName: string, pluginName: string) => {
  const type = `${pluginName}custom_tab_online_reader`
  const find = (o: any, id: string): any => o?.id === id ? o : o?.children?.reduce((r: any, c: any) => r || find(c, id), null)
  for (const el of document.querySelectorAll<HTMLElement>('.layout-tab-bar .item[data-id]')) {
    if ((el.getAttribute('data-title') || el.querySelector('.item__text')?.textContent) !== bookName) continue
    if (find((window as any).siyuan?.layout?.centerLayout, el.getAttribute('data-id')!)?.model?.type === type) return el
  }
  return null
}

// 获取书籍
export const getBookWithFallback = async (manager: typeof bookshelfManager, bookUrl: string) => {
  return await manager.getBook(bookUrl)
}

const getTabPosition = (settings: Pick<ReaderSettings, 'openMode'>): TabPosition =>
  ({ rightTab: 'right', bottomTab: 'bottom' }[settings.openMode] || 'right')

const normalizeNativePdfPath = (path: string) => {
  if (!path || /^https?:\/\//i.test(path) || /^file:\/\//i.test(path)) return null
  if (path.startsWith('/data/public/')) return { kind: 'asset' as const, path: path.replace(/^\/data\/public\//i, 'public/') }
  if (path.startsWith('/public/')) return { kind: 'asset' as const, path: path.replace(/^\/public\//i, 'public/') }
  if (path.startsWith('public/')) return { kind: 'asset' as const, path }
  if (path.startsWith('/assets/')) return { kind: 'pdf' as const, path: path.replace(/^\/assets\//i, 'assets/') }
  if (path.startsWith('assets/')) return { kind: 'pdf' as const, path }
  return { kind: 'pdf' as const, path: path.replace(/^asset:\/\//i, '') }
}

export const getSiyuanPdfTarget = (book: Book, settings: OpenModeSettings): NativePdfTarget | null => {
  if (settings.openDocAssets || book.format !== 'pdf') return null
  const sourcePath = book.url.startsWith('asset://') ? book.url.replace('asset://', '') : (book.path || book.url || '')
  return normalizeNativePdfPath(sourcePath)
}

export const openWithSiyuanPdf = (plugin: Plugin, book: Book, settings: OpenModeSettings, onReady?: () => void) => {
  const target = getSiyuanPdfTarget(book, settings)
  if (!target) return false

  openTab({
    app: (plugin as any).app,
    [target.kind]: { path: target.path },
    position: getTabPosition(settings),
    afterOpen: onReady
  })
  return true
}

// 获取或添加assets书籍
export const getOrAddAssetBook = async (manager: typeof bookshelfManager, assetPath: string, file: File) => {
  const bookUrl = `asset://${assetPath}`
  
  const existing = await manager.getBook(bookUrl)
  if (existing) return existing
  
  try {
    await manager.addAssetBook(assetPath, file)
    window.dispatchEvent(new CustomEvent('sireader:bookshelf-updated'))
    return await manager.getBook(bookUrl)
  } catch (e) {
    console.error('[添加书籍]', e)
    return null
  }
}

// 打开或激活书籍
export const openOrActivateBook = (plugin: Plugin, book: Book, settings: ReaderSettings, onReady?: () => void) => {
  if (isMobile()) {
    window.dispatchEvent(new CustomEvent('reader:open', { detail: { book } }))
    onReady?.()
    return
  }

  if (openWithSiyuanPdf(plugin, book, settings, onReady)) return
  
  const tab = findOpenedTab(book.title, plugin.name)
  if (tab) {
    tab.click()
    onReady?.()
    return
  }
  
  openTab({
    app: (plugin as any).app,
    custom: {
      icon: 'siyuan-reader-icon',
      title: book.title,
      data: { bookInfo: book },
      id: `${plugin.name}custom_tab_online_reader`
    },
    position: getTabPosition(settings),
    afterOpen: onReady
  })
}
