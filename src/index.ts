import { Plugin, getFrontend } from 'siyuan'
import '@/index.scss'
import PluginInfoString from '@/../plugin.json'
import { destroy, init, usePlugin } from '@/main'

const { version } = PluginInfoString

export default class PluginSample extends Plugin {
  public isMobile: boolean
  public isBrowser: boolean
  public isLocal: boolean
  public isElectron: boolean
  public isInWindow: boolean
  public platform: SyFrontendTypes
  public readonly version = version

  async onload() {
    const frontEnd = getFrontend()
    this.platform = frontEnd as SyFrontendTypes
    this.isMobile = frontEnd === 'mobile' || frontEnd === 'browser-mobile'
    this.isBrowser = frontEnd.includes('browser')
    this.isLocal = location.href.includes('127.0.0.1') || location.href.includes('localhost')
    this.isInWindow = location.href.includes('window.html')
    try {
      const req = typeof window !== 'undefined' && typeof (window as any).require === 'function'
        ? (window as any).require
        : null
      req?.('@electron/remote')?.require?.('@electron/remote/main')
      this.isElectron = !!req
    } catch {
      this.isElectron = false
    }

    usePlugin(this)
    init(this)
    this.addHotkeys()

    import('@/utils/migration')
      .then(({ ensureMigrationCompleted }) => ensureMigrationCompleted())
      .catch(error => console.error('[SiReader] Migration init failed:', error))

    import('@/components/deck/siyuan-card')
      .then(({ enableAutoSync }) => enableAutoSync())
      .catch(error => console.error('[SiReader] Deck autosync init failed:', error))
  }

  private addHotkeys() {
    const cmds = {
      prevPage: { text: '上一页', hotkey: '', callback: () => window.dispatchEvent(new CustomEvent('sireader:prevPage')) },
      nextPage: { text: '下一页', hotkey: '', callback: () => window.dispatchEvent(new CustomEvent('sireader:nextPage')) },
      toggleBookmark: { text: '切换书签', hotkey: '', callback: () => window.dispatchEvent(new CustomEvent('sireader:toggleBookmark')) },
      quickNote: { text: '快速笔记', hotkey: '', callback: () => window.dispatchEvent(new CustomEvent('sireader:quickNote')) },
      pdfZoomIn: { text: 'PDF放大', hotkey: '', callback: () => window.dispatchEvent(new CustomEvent('sireader:pdfZoomIn')) },
      pdfZoomOut: { text: 'PDF缩小', hotkey: '', callback: () => window.dispatchEvent(new CustomEvent('sireader:pdfZoomOut')) },
      pdfZoomReset: { text: 'PDF重置缩放', hotkey: '', callback: () => window.dispatchEvent(new CustomEvent('sireader:pdfZoomReset')) },
      pdfRotate: { text: 'PDF旋转', hotkey: '', callback: () => window.dispatchEvent(new CustomEvent('sireader:pdfRotate')) },
      pdfSearch: { text: 'PDF搜索', hotkey: '', callback: () => window.dispatchEvent(new CustomEvent('sireader:pdfSearch')) },
      pdfPrint: { text: 'PDF打印', hotkey: '', callback: () => window.dispatchEvent(new CustomEvent('sireader:pdfPrint')) },
      pdfFirstPage: { text: 'PDF首页', hotkey: '', callback: () => window.dispatchEvent(new CustomEvent('sireader:pdfFirstPage')) },
      pdfLastPage: { text: 'PDF末页', hotkey: '', callback: () => window.dispatchEvent(new CustomEvent('sireader:pdfLastPage')) },
      pdfPageUp: { text: 'PDF上一页', hotkey: '', callback: () => window.dispatchEvent(new CustomEvent('sireader:pdfPageUp')) },
      pdfPageDown: { text: 'PDF下一页', hotkey: '', callback: () => window.dispatchEvent(new CustomEvent('sireader:pdfPageDown')) },
    }

    Object.entries(cmds).forEach(([k, { text, hotkey, callback }]) =>
      this.addCommand({ langKey: k, langText: text, hotkey, callback }),
    )
  }

  async onunload() {
    destroy()
    console.log('[SiReader] plugin unloaded')
  }

  async uninstall() {
    const { clearStoredPluginData } = await import('@/core/bookStore')
    const { getDatabase } = await import('@/core/database')
    const books = await (await getDatabase()).getBooks().catch(() => [])
    await clearStoredPluginData(books)
    await this.removeData('config.json')
    await this.removeData('stats.json')
    console.log('[SiReader] plugin data removed')
  }

  openSetting() {
    window._sy_plugin_sample.openSetting()
  }
}
