<template>
  <div class="plugin-app-main">
    <Stats :visible="showStats" @close="showStats=false" @open="handleOpenBook" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, provide } from 'vue'
import { createApp, type Component } from 'vue'
import { MotionPlugin } from '@vueuse/motion'
import { showMessage } from 'siyuan'
import { usePlugin, setOpenSettingHandler, registerCleanup } from '@/main'
import { useSetting, settingsManager } from '@/composables/useSetting'
import { useStats } from '@/composables/useStats'
import { READER_ICON_ID } from '@/utils/icon'
import { isMobile } from '@/utils/mobile'
import Settings from '@/components/Settings.vue'
import Stats from '@/components/Stats.vue'

const plugin = usePlugin()
const { settings, isLoaded } = useSetting(plugin)
const showStats = ref(false)

let settingsApp: any = null
let mobileReaderApp: any = null

// 打开设置并展开授权
const openSetting = () => {
  const btn = document.querySelector<HTMLElement>(`.dock__item[data-title="${plugin.i18n?.name || '思阅'}"]`)
  if (!btn?.classList.contains('dock__item--active')) btn?.click()
  setTimeout(() => (window as any)._openLicense?.(), 100)
}

// ===== 阅读器核心 =====
const FORMATS = ['.epub', '.pdf', '.mobi', '.azw3', '.azw', '.fb2', '.cbz', '.txt']

const fetchFile = async (url: string) => {
  try {
    const res = await fetch(url[0] === '/' || url.startsWith('http') ? url : `/${url}`)
    return res.ok ? new File([await res.blob()], url.split('/').pop()?.split('?')[0] || 'book') : null
  } catch { return null }
}

const mountReader = async (el: HTMLElement, props: any) => {
  if (!isLoaded.value) await new Promise(r => { const check = () => isLoaded.value ? r(true) : setTimeout(check, 50); check() })
  const { toRaw } = await import('vue')
  const { default: Reader } = await import('@/components/Reader.vue')
  const app = createApp(Reader as Component, { ...props, plugin, settings: JSON.parse(JSON.stringify(toRaw(settings.value))), i18n: plugin.i18n })
  app.mount(el)
  return app
}

// 暴露渲染接口供其他插件调用
;(window as any).sireader = {
  mountReader: async (el: HTMLElement, props: any) => await mountReader(el, props),
  openEpubTab: async (file: File, title?: string) => (await import('@/utils/bookOpen')).openReaderTab(plugin, title || file.name.replace(/\.[^.]+$/, ''), { file }, `${plugin.name}epub_reader`),
}

// 注册标签页
plugin.addTab({
  type: 'epub_reader',
  async init() {
    const { url, blockId, file } = this.data
    const f = file?.arrayBuffer ? file : url && await fetchFile(url)
    if (!f) return this.element.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--b3-theme-error)">加载失败</div>'
    ;(this as any)._app = await mountReader(this.element, { file: f, url, blockId })
  },
  destroy() { ;(this as any)._app?.unmount() }
})

plugin.addTab({
  type: 'custom_tab_book_reader',
  async init() {
    const { bookInfo } = this.data
    if (!bookInfo) return this.element.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--b3-theme-error)">加载失败</div>'
    ;(this as any)._app = await mountReader(this.element, { bookInfo })
  },
  destroy() { ;(this as any)._app?.unmount() }
})

// 链接打开书籍
const handleEbookLink = async (e: MouseEvent) => {
  const link = (e.target as HTMLElement).closest('a[href], [data-href], [data-url], span[data-type="a"]') as HTMLElement
  const url = link?.getAttribute('data-href') || link?.getAttribute('href') || link?.getAttribute('data-url')
  if (!url) return
  
  // 处理自定义协议 sireader://
  const parsed = (await import('@/composables/useSetting')).parseBookLink(url)
  if (parsed) {
    e.preventDefault(), e.stopPropagation()
    if (!parsed.bookUrl) return showMessage('无效的书籍链接', 3000, 'error')
    const { bookshelfManager } = await import('@/core/bookshelf')
    const { getBookWithFallback, openOrActivateBook } = await import('@/utils/bookOpen')
    const book = await getBookWithFallback(bookshelfManager, parsed.bookUrl)
    if (!book) return showMessage('书籍不存在', 3000, 'error')
    return openOrActivateBook(plugin, book, settings.value, () => 
      window.dispatchEvent(new CustomEvent('sireader:goto', { detail: { cfi: parsed.cfi, id: parsed.id } }))
    )
  }
  
  const cleanUrl = url.split('#')[0]
  if (!FORMATS.some(ext => cleanUrl.toLowerCase().endsWith(ext) || cleanUrl.toLowerCase().split('?')[0].endsWith(ext))) return
  
  // 处理文档内 assets 链接
  if (url.startsWith('assets/') || url.includes('/assets/')) {
    if (!settings.value.openDocAssets) return // 设置关闭时不处理
    e.preventDefault(), e.stopPropagation()
    const { bookshelfManager } = await import('@/core/bookshelf')
    const { getOrAddAssetBook, openOrActivateBook } = await import('@/utils/bookOpen')
    const file = await fetchFile(cleanUrl)
    if (!file) return showMessage('文件不存在', 3000, 'error')
    const book = await getOrAddAssetBook(bookshelfManager, url, file)
    if (!book) return showMessage('添加失败', 3000, 'error')
    return openOrActivateBook(plugin, book, settings.value)
  }
  
  // 普通文件链接
  e.preventDefault(), e.stopPropagation()
  const file = await fetchFile(cleanUrl)
  if (!file) return
  const { openReaderTab } = await import('@/utils/bookOpen')
  openReaderTab(plugin, file.name.replace(/\.[^.]+$/, ''), { file, url: cleanUrl, blockId: link.closest('[data-node-id]')?.getAttribute('data-node-id') }, `${plugin.name}epub_reader`, settings.value)
}

setOpenSettingHandler(openSetting)

const iconId = READER_ICON_ID
plugin.addDock({
  type: 'SiyuanReaderDock',
  config: { position: 'RightTop', size: { width: 680, height: 580 }, icon: iconId, title: plugin.i18n?.name || '思阅' },
  data: { plugin },
  async init() {
    const container = document.createElement('div')
    container.className = 'sireader-dock-content'
    container.style.cssText = 'width:100%;height:100%;overflow:auto'
    this.element.appendChild(container)
    
    // 等待设置加载
    if (!isLoaded.value) {
      container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--b3-theme-on-surface)">加载中...</div>'
      await new Promise(r => { const check = () => isLoaded.value ? r(true) : setTimeout(check, 50); check() })
      container.innerHTML = ''
    }
    
    // 挂载设置组件
    const { toRaw } = await import('vue')
    settingsApp = createApp(Settings, {
      modelValue: JSON.parse(JSON.stringify(toRaw(settings.value))),
      i18n: (this.data.plugin as typeof plugin).i18n,
      onSave: async () => await settingsManager.save(settings.value),
      'onUpdate:modelValue': (v: any) => settings.value = v
    })
    settingsApp.use(MotionPlugin).mount(container)
  },
  resize() {},
  destroy() { settingsApp?.unmount(); settingsApp = null }
})

plugin.addTopBar({ icon: `<svg><use xlink:href="#${iconId}"/></svg>`, title: '思阅', callback: openSetting })

// 启用底部右下角的阅读统计功能
const statsInstance = useStats(plugin)
statsInstance.init()
provide('stats', statsInstance)
provide('plugin', plugin)

// 处理统计面板切换
const handleStatsToggle = () => showStats.value = !showStats.value
const handleOpenBook = async (book: any) => {
  showStats.value = false
  const { getBookWithFallback, openOrActivateBook } = await import('@/utils/bookOpen')
  const { bookshelfManager } = await import('@/core/bookshelf')
  const full = await getBookWithFallback(bookshelfManager, book.url)
  if (!full) return showMessage('加载失败', 3000, 'error')
  openOrActivateBook(plugin, full, settings.value)
}

// 移动端 Reader 处理
const handleMobileReaderOpen = async (e: CustomEvent) => {
  const { book } = e.detail
  mobileReaderApp?.unmount()
  mobileReaderApp = null
  let container = document.getElementById('sireader-mobile-container')
  if (!container) {
    container = document.createElement('div')
    container.id = 'sireader-mobile-container'
    container.style.cssText = 'position:fixed;inset:0;z-index:100;background:var(--b3-theme-background)'
    document.body.appendChild(container)
  }
  container.style.display = 'block'
  const { toRaw } = await import('vue')
  const { default: Reader } = await import('@/components/Reader.vue')
  mobileReaderApp = createApp(Reader as Component, {
    bookInfo: book,
    plugin,
    settings: JSON.parse(JSON.stringify(toRaw(settings.value))),
    i18n: plugin.i18n
  })
  mobileReaderApp.mount(container)
}

const handleMobileReaderClose = () => {
  mobileReaderApp?.unmount()
  mobileReaderApp = null
  document.getElementById('sireader-mobile-container')?.style.setProperty('display', 'none')
}

onMounted(async () => {
  window.addEventListener('click', handleEbookLink, true)
  window.addEventListener('stats:toggle', handleStatsToggle as any)
  registerCleanup(() => {
    window.removeEventListener('click', handleEbookLink, true)
    window.removeEventListener('stats:toggle', handleStatsToggle as any)
  })
  
  if (isMobile()) {
    window.addEventListener('reader:mobile-open', handleMobileReaderOpen as any)
    window.addEventListener('reader:mobile-close', handleMobileReaderClose)
    registerCleanup(() => {
      window.removeEventListener('reader:mobile-open', handleMobileReaderOpen as any)
      window.removeEventListener('reader:mobile-close', handleMobileReaderClose)
    })
  }
})
</script>

<style lang="scss" scoped>
.plugin-app-main {
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>

<style>
/* Lucide Icons */
.lucide { width: 1em; height: 1em; }
</style>
