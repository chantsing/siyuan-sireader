import { createApp, type Component } from 'vue'
import { openTab, type Plugin } from 'siyuan'
import type { ReaderSettings } from '@/composables/useSetting'
import { bookshelfManager } from '@/core/bookshelf'
import { openOnlineReaderTab, openOrActivateBook } from '@/utils/bookOpen'
import Weread from './Weread.vue'

const TITLE = '微信读书'
const TAB_ID = 'weread'

export const normalizeWereadReaderUrl = (url = '') => {
  try {
    const parsed = new URL(url)
    const id = parsed.hostname === 'weread.qq.com' ? parsed.pathname.match(/^\/web\/reader\/([^/#?]+)/)?.[1] : ''
    return id ? `https://weread.qq.com/web/reader/${id.split('k')[0]}` : ''
  } catch {
    return ''
  }
}

export const isWereadReaderUrl = (url = '') => !!normalizeWereadReaderUrl(url)

const findLinkedBook = async (bookUrl: string, cfi = '') => {
  const direct = await bookshelfManager.getBook(bookUrl)
  if (direct) return direct
  const candidates = [...new Set([normalizeWereadReaderUrl(bookUrl), normalizeWereadReaderUrl(cfi)].filter(Boolean))]
  for (const url of candidates) {
    const book = await bookshelfManager.getBook(url)
    if (book) return book
  }
  if (!candidates.length) return null
  const books = await bookshelfManager.getBooks()
  return books.find((book: any) => candidates.includes(normalizeWereadReaderUrl(book.url || book.path || ''))) || null
}

export const openWereadReaderLink = async (plugin: Plugin, settings: Pick<ReaderSettings, 'openMode'>, bookUrl: string, cfi = bookUrl, id?: string) => {
  const url = cfi || bookUrl
  if (!isWereadReaderUrl(bookUrl) && !isWereadReaderUrl(url)) return false
  const afterOpen = () => window.dispatchEvent(new CustomEvent('sireader:goto', { detail: { cfi: url, id } }))
  const book = await findLinkedBook(bookUrl, url)
  if (book) openOrActivateBook(plugin, book, settings, afterOpen)
  else openOnlineReaderTab(plugin, TITLE, url, settings, afterOpen)
  return true
}

export const registerWeread = (plugin: Plugin) => {
  const openWereadTab = () => openTab({
    app: (plugin as any).app,
    custom: { icon: 'iconWeread', title: TITLE, data: {}, id: `${plugin.name}${TAB_ID}` },
  })

  plugin.addTab({
    type: TAB_ID,
    init() {
      this.element.innerHTML = ''
      this.element.style.cssText = 'height:100%;overflow:hidden'
      ;(this as any)._app = createApp(Weread as Component, { i18n: plugin.i18n })
      ;(this as any)._app.mount(this.element)
    },
    resize() {},
    destroy() { ;(this as any)._app?.unmount() },
  })

  plugin.addTopBar({ icon: '<svg><use xlink:href="#iconWeread"/></svg>', title: TITLE, callback: openWereadTab })
  plugin.addCommand({ langKey: 'openWeread', langText: `打开${TITLE}`, hotkey: '', callback: openWereadTab })
  return openWereadTab
}
