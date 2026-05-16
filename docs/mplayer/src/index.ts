import { Dialog, Plugin, getFrontend, showMessage } from 'siyuan'
import '@/styles/mediaView.css'
import { getAPI } from '@/core/player'
import { LicenseManager } from '@/core/license'
import MobileManager from '@/core/mobile'
import { init, destroy } from '@/main'
import { getIconSvg } from '@/utils/icons'
import { canUseMediaProxy, startWebDAVProxy, stopWebDAVProxy } from '@/utils/webdav-proxy'

// ===== 常量与运行时 =====
const SIDEBAR_TITLE = '媒体播放器'
const runtime = () => getAPI()
const miniBarEvents = ['mediaPlayerConfigChange', 'playerDestroy', 'mediaPlayerMiniClose', 'mediaPlayerMiniOpen']
const miniBarButtonIds = ['media-player-mini-prev', 'media-player-mini-toggle', 'media-player-mini-next', 'media-player-mini-popup']

const openSidebar = () => document.querySelector(`.dock__item[aria-label*="${SIDEBAR_TITLE}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

const createMiniStatusBar = (plugin: Plugin) => {
  const createButton = (id: string, label: string, handler: () => void) => {
    const button = document.createElement('div')
    button.className = 'toolbar__item ariaLabel'
    button.id = id
    button.dataset.action = id
    button.setAttribute('aria-label', label)
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      handler()
    })
    return button
  }

  const buttons = [
    createButton(miniBarButtonIds[0], '上一项', () => runtime().playPrev?.()),
    createButton(miniBarButtonIds[1], '播放/暂停', () => runtime().toggle?.()),
    createButton(miniBarButtonIds[2], '下一项', () => runtime().playNext?.()),
    createButton(miniBarButtonIds[3], '打开迷你播放器', () => window.dispatchEvent(new CustomEvent('mediaPlayerMiniToggle'))),
  ]
  const [prevButton, playButton, nextButton, popupButton] = buttons

  let timer = 0
  const render = () => {
    const api = runtime()
    const media = api.controller?.getCurrentMedia?.()
    buttons.forEach((button) => { button.style.display = media ? 'flex' : 'none' })
    if (!media) return

    const playing = !!api.player && !(api.player.paused ?? api.player.video?.paused)
    prevButton.innerHTML = getIconSvg('lucide-skip-back', 16)
    playButton.innerHTML = getIconSvg(playing ? 'lucide-pause' : 'lucide-play', 16)
    nextButton.innerHTML = getIconSvg('lucide-skip-forward', 16)
    popupButton.innerHTML = getIconSvg('lucide-picture-in-picture-2', 16)
    playButton.setAttribute('aria-label', playing ? '暂停' : '播放')
    buttons.forEach((button) => { button.title = String(media.title || media.name || '媒体播放器') })
  }

  miniBarEvents.forEach((event) => window.addEventListener(event, render))
  render()
  timer = window.setInterval(render, 1000)
  buttons.forEach((button) => plugin.addStatusBar({ element: button, position: 'right' }))

  return () => {
    miniBarEvents.forEach((event) => window.removeEventListener(event, render))
    if (timer) window.clearInterval(timer)
    buttons.forEach((button) => button.remove())
  }
}

// ===== 命令注册 =====
const registerCommands = (plugin: Plugin) => {
  // 需要播放器上下文的命令统一先走这里
  const ensurePlayer = (callback: () => void, skipCheck = false) => {
    if (skipCheck || runtime().controller?.getCurrentMedia?.()) return callback()
    showMessage(plugin.i18n.openPlayer || '请先打开播放器')
    return runtime().openPlayerTab?.()
  }

  // 统一注册命令：不内置快捷键，全部留空给用户自定义
  const add = (langKey: string, langText: string, callback: () => void, skipCheck = false) =>
    plugin.addCommand({
      langKey,
      langText: (plugin.i18n.hotkeys?.[langKey] as string) || langText,
      hotkey: '',
      callback: () => ensurePlayer(callback, skipCheck),
    })

  // 播放控制类命令
  ;[
    ['togglePlay', '播放/暂停', () => runtime().toggle?.()],
    ['seekForward', '快进10秒', () => runtime().seek?.(10)],
    ['seekBackward', '后退10秒', () => runtime().seek?.(-10)],
    ['prevTrack', '上一项', () => runtime().triggerAction?.('prev')],
    ['nextTrack', '下一项', () => runtime().triggerAction?.('next')],
    ['increaseSpeed', '加速', () => runtime().increaseSpeed?.()],
    ['decreaseSpeed', '减速', () => runtime().decreaseSpeed?.()],
    ['toggleCustomSpeed', '切换倍率', () => runtime().toggleCustomSpeed?.()],
    ['screenshot', '截图', () => runtime().triggerAction?.('screenshot')],
    ['timestamp', '时间戳', () => runtime().triggerAction?.('timestamp')],
    ['loopSegment', '循环片段', () => runtime().triggerAction?.('loopSegment')],
    ['mediaNotes', '媒体笔记', () => runtime().triggerAction?.('mediaNotes')],
    ['openSidebar', '打开侧栏', openSidebar, true],
  ].forEach(([key, text, callback, skipCheck]) =>
    add(key as string, text as string, callback as () => void, !!skipCheck),
  )

  // 输入链接播放
  add('playFromURL', '输入链接播放', () => {
    const dialog = new Dialog({
      title: '输入链接播放',
      width: '520px',
      content: `
        <div class="b3-dialog__content">
          <input class="b3-text-field fn__block" placeholder="请输入媒体链接">
        </div>
        <div class="b3-dialog__action">
          <button class="b3-button b3-button--cancel">取消</button>
          <button class="b3-button b3-button--text">播放</button>
        </div>
      `,
    })

    const input = dialog.element.querySelector('input') as HTMLInputElement
    const submit = () => {
      const url = input.value.trim()
      if (!url) return
      runtime().playMediaItem?.({ url, title: url.split('/').pop() || '未命名媒体' })
      dialog.destroy()
    }

    input.addEventListener('keydown', (event) => event.key === 'Enter' && submit())
    dialog.element.querySelectorAll('button')[1]?.addEventListener('click', submit)
    setTimeout(() => input.focus(), 100)
  }, true)
}

// ===== 插件主体 =====
export default class MediaPlayerPlugin extends Plugin {
  public isMobile!: boolean
  public isBrowser!: boolean
  private mobileManager: MobileManager | null = null
  private destroyMiniStatusBar: (() => void) | null = null

  async onload() {
    const frontEnd = getFrontend()
    this.isMobile = frontEnd === 'mobile' || frontEnd === 'browser-mobile'
    this.isBrowser = frontEnd.includes('browser')
    ;(window as any).__mediaPlayerMobile = this.isMobile
    if (canUseMediaProxy()) void startWebDAVProxy().catch(error => console.error('[MediaPlayer] Failed to start WebDAV proxy:', error))

    init(this)
    this.destroyMiniStatusBar = createMiniStatusBar(this)
    registerCommands(this)
    if (this.isMobile) this.mobileManager = new MobileManager({ getRuntime: () => getAPI() })
    // 启动即校验与日活上报（每天最多一次）
    LicenseManager.load(this).catch(() => {})
  }

  async onLayoutReady() {
    if (!this.isMobile) return
    this.mobileManager?.init()
  }

  onunload() {
    ;(window as any).__mediaPlayerMobile = false
    this.mobileManager?.destroy()
    this.mobileManager = null
    this.destroyMiniStatusBar?.()
    this.destroyMiniStatusBar = null
    stopWebDAVProxy()
    destroy()
    console.log('[MediaPlayer] Plugin unloaded')
  }

  async uninstall() {
    console.log('[MediaPlayer] 媒体播放器插件已卸载')
  }

  // 设置入口统一复用已有侧栏打开逻辑
  openSetting() {
    ;(window as any)._mediaPlayerOpenSetting?.()
  }
}
