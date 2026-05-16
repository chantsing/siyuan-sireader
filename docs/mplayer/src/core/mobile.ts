import type { RuntimeAPI } from '@/core/player'
import { mountMobilePlayer, mountMobileTabs, unmountMobileApp } from '@/main'

type MobileOptions = {
  getRuntime: () => RuntimeAPI
}

export default class MobileManager {
  private root: HTMLElement | null = null
  private playerHost: HTMLElement | null = null
  private listHost: HTMLElement | null = null
  private restoreRuntime: (() => void) | null = null

  constructor(private options: MobileOptions) {}

  init() {
    if (this.restoreRuntime) return
    const runtime = this.options.getRuntime()
    const { openPlayerTab, playMediaItem } = runtime
    runtime.openPlayerTab = this.openPlayerTab
    runtime.playMediaItem = this.playMediaItem
    this.restoreRuntime = () => {
      runtime.openPlayerTab = openPlayerTab
      runtime.playMediaItem = playMediaItem
    }
  }

  destroy = () => {
    this.restoreRuntime?.()
    this.restoreRuntime = null
    unmountMobileApp()
    this.playerHost = null
    this.listHost = null
    this.root = null
  }

  private get runtime() { return this.options.getRuntime() }
  private get model() { return document.getElementById('model') }
  private get modelMain() { return document.getElementById('modelMain') }
  private get sidebar() { return document.getElementById('sidebar') }
  private get sideMask() { return document.querySelector('.side-mask') as HTMLElement | null }

  private async resolveMediaItem(mediaItem?: Record<string, any> | null) {
    if (!mediaItem) return null
    const { getStorage } = await import('@/composables/storage')
    const { BaseDriver } = await import('@/drivers/base/BaseDriver')
    const storage = await getStorage()
    const stored = mediaItem.id ? await storage.getItem(mediaItem.id) : null
    return BaseDriver.attachCloudAccount({ ...(stored || {}), ...mediaItem }, storage)
  }

  private waitController = async (retry = 160) => {
    while (!this.runtime.controller && retry-- > 0) await new Promise(resolve => setTimeout(resolve, 25))
    return this.runtime.controller
  }

  private setTitle(title = '播放器') {
    ;(this.model?.querySelector('.toolbar__text') as HTMLElement | null)?.replaceChildren(document.createTextNode(title))
  }

  private prepareModel() {
    this.sidebar && (this.sidebar.style.transform = '')
    if (this.sideMask) {
      this.sideMask.classList.add('fn__none')
      this.sideMask.style.opacity = ''
    }
  }

  private ensureRoot() {
    const modelMain = this.modelMain
    if (!modelMain) return
    if (this.root?.isConnected) return
    modelMain.style.overflow = 'hidden'
    modelMain.innerHTML = `
      <div data-mobile-player-root class="fn__flex fn__flex-column" style="height:100%;min-height:0;background:var(--b3-theme-background);">
        <div data-player style="flex:0 0 min(56.25vw,50vh);min-height:180px;background:#000;overflow:hidden"></div>
        <div data-list class="fn__flex fn__flex-column" style="flex:1;min-height:0;overflow:hidden"></div>
      </div>
    `
    this.root = modelMain.querySelector('[data-mobile-player-root]') as HTMLElement
    this.playerHost = this.root?.querySelector('[data-player]') as HTMLElement
    this.listHost = this.root?.querySelector('[data-list]') as HTMLElement
  }

  private ensureMounted = async () => {
    this.ensureRoot()
    if (!this.playerHost || !this.listHost) return
    if (!this.playerHost.dataset.ready) {
      await mountMobilePlayer(this.playerHost, this.runtime.pendingMedia || null)
      this.playerHost.dataset.ready = '1'
    }
    if (!this.listHost.dataset.ready) {
      await mountMobileTabs(this.listHost)
      this.listHost.dataset.ready = '1'
    }
  }

  private show = async () => {
    await this.ensureMounted()
    const model = this.model
    if (!model) return
    this.prepareModel()
    model.style.transform = 'translateY(0px)'
    model.style.zIndex = String(((window as any).siyuan?.zIndex || 10) + 1)
    if ((window as any).siyuan) (window as any).siyuan.zIndex = Number(model.style.zIndex) || (window as any).siyuan.zIndex
  }

  private open = async (mediaItem?: Record<string, any> | null, play = false) => {
    const media = await this.resolveMediaItem(mediaItem)
    this.runtime.pendingMedia = media
    this.setTitle(media?.title || media?.name || '播放器')
    await this.show()
    const controller = await this.waitController()
    if (play && media) await controller?.play?.(media)
  }

  private openPlayerTab = async (mediaItem?: Record<string, any> | null) => this.open(mediaItem)
  private playMediaItem = async (mediaItem: Record<string, any>) => this.open(mediaItem, true)
}
