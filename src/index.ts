import { Plugin, getFrontend } from 'siyuan'
import '@/index.scss'
import PluginInfoString from '@/../plugin.json'
import { destroy, init, usePlugin } from '@/main'
import { PDF_SHORTCUT_COMMANDS } from '@/utils/keyboard'
import { diagnosticLog } from '@/core/diagnostics'

const { version } = PluginInfoString

export default class PluginSample extends Plugin {
  public isMobile: boolean
  public isBrowser: boolean
  public isLocal: boolean
  public isElectron: boolean
  public isInWindow: boolean
  public platform: ReturnType<typeof getFrontend>
  public readonly version = version
  private storageChangeTask: Promise<void> | null = null
  private readonly handleStorageChanged = () => {
    if (this.storageChangeTask) return this.storageChangeTask
    this.storageChangeTask = (async () => {
      diagnosticLog('info', 'sync.completed', { source: 'syncMergeResult' })
      window.dispatchEvent(new CustomEvent('sireader:storage-changed'))
    })().finally(() => { this.storageChangeTask = null })
    return this.storageChangeTask
  }

  async onload() {
    const frontEnd = getFrontend()
    this.platform = frontEnd
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
    await init(this)
    this.eventBus.on('sync-end', this.handleStorageChanged)
    this.eventBus.on('ws-main', this.handleWsMain)
    this.addHotkeys()
  }

  // SiYuan may emit this once per file while a sync is still in progress.
  onDataChanged() {
    // SiYuan calls this for dataChanges without unloading the plugin.
    // Refresh consumers only; never write or recover in this notification.
    window.dispatchEvent(new CustomEvent('sireader:storage-changed'))
  }

  private handleWsMain = (event: CustomEvent) => {
    const cmd = event.detail?.cmd
    if (cmd) diagnosticLog('debug', 'ws-main.command', { cmd })
    if (cmd === 'syncMergeResult') void this.handleStorageChanged()
  }

  private addHotkeys() {
    const cmds = {
      prevPage: { text: '上一页', hotkey: '', callback: () => window.dispatchEvent(new CustomEvent('sireader:prevPage')) },
      nextPage: { text: '下一页', hotkey: '', callback: () => window.dispatchEvent(new CustomEvent('sireader:nextPage')) },
      toggleBookmark: { text: '切换书签', hotkey: '', callback: () => window.dispatchEvent(new CustomEvent('sireader:toggleBookmark')) },
      quickNote: { text: '快速笔记', hotkey: '', callback: () => window.dispatchEvent(new CustomEvent('sireader:quickNote')) },
    }

    Object.entries(cmds).forEach(([k, { text, hotkey, callback }]) =>
      this.addCommand({ langKey: k, langText: (this.i18n as any)?.[k] || text, hotkey, callback }),
    )
    PDF_SHORTCUT_COMMANDS.forEach(([id, text]) => this.addCommand({
      langKey: 'pdf-' + id.replace(/:/g, '-'),
      langText: 'PDF ' + text,
      hotkey: '',
      callback: () => window.dispatchEvent(new CustomEvent('sireader:pdf-command', { detail: id })),
    }))
  }

  async onunload() {
    this.eventBus.off('sync-end', this.handleStorageChanged)
    this.eventBus.off('ws-main', this.handleWsMain)
    await destroy()
  }

  async uninstall() {
    const { clearStoredPluginData } = await import('@/core/storage')
    const { getDatabase } = await import('@/core/database')
    const books = await (await getDatabase()).getBooks().catch(() => [])
    await clearStoredPluginData(books)
    await this.removeData('config.json')
    await this.removeData('stats.json')
  }

  openSetting() {
    ;(window as any)._sy_plugin_sample?.openSetting?.()
  }
}
