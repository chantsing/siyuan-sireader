/**
 * Foliate Reader - 统一阅读器
 * 整合 View 创建、配置、标记管理等所有功能
 */

import type { Plugin } from 'siyuan'
import type { FoliateView, Location } from './types'
import type { ReaderSettings } from '@/composables/useSetting'
import { PRESET_THEMES } from '@/composables/useSetting'
import { createTooltip, showTooltip, hideTooltip } from '@/core/MarkManager'
import { EPUBSearch } from './search'
import 'foliate-js/view.js'

export interface ReaderOptions {
  container: HTMLElement
  settings: ReaderSettings
  plugin: Plugin
}

// ===== 工具函数 =====
const resolveColor = (c: string) => c.startsWith('var(') ? getComputedStyle(document.documentElement).getPropertyValue(c.slice(4, -1)).trim() : c
const resolveTheme = (t: any) => ({ ...t, bg: resolveColor(t.bg), color: resolveColor(t.color) })
const watchTheme = (cb: () => void) => new MutationObserver(() => requestAnimationFrame(() => requestAnimationFrame(cb))).observe(document.documentElement, { attributeFilter: ['data-theme-mode', 'class'] })
const getTheme = (s: ReaderSettings) => resolveTheme(s.theme === 'custom' ? s.customTheme : PRESET_THEMES[s.theme] || PRESET_THEMES.default)

// ===== View 工具函数 =====

function createFoliateView(container: HTMLElement): FoliateView {
  const view = document.createElement('foliate-view') as FoliateView
  view.style.cssText = 'width:100%;height:100%'
  view.setAttribute('persist', 'false')
  container.appendChild(view)
  return view
}

function configureView(view: FoliateView, s: ReaderSettings) {
  if (!view) return
  const r = view.renderer
  if (!r) return
  const { viewMode = 'single', pageAnimation = 'slide', layoutSettings: l = { gap: 5, headerFooterMargin: 0 }, visualSettings: v } = s
  const isScroll = viewMode === 'scroll'
  const set = (n: string, val: string) => r.setAttribute(n, val)
  const toggle = (n: string, cond: boolean, val = '') => cond ? set(n, val) : r.removeAttribute(n)
  set('flow', isScroll ? 'scrolled' : 'paginated')
  set('max-column-count', viewMode === 'double' ? '2' : '1')
  toggle('animated', !isScroll && pageAnimation === 'slide')
  set('gap', `${l.gap}%`)
  set('max-inline-size', '800px')
  toggle('margin', l.headerFooterMargin > 0, `${l.headerFooterMargin}px`)
  applyVisualFilter(v)
  applyViewTheme(view, getTheme(s))
}

function applyVisualFilter(v: any = {}) {
  document.getElementById('sireader-visual-filter')?.remove()
  const filters = [v.brightness !== 1 && `brightness(${v.brightness})`, v.contrast !== 1 && `contrast(${v.contrast})`, v.sepia > 0 && `sepia(${v.sepia})`, v.saturate !== 1 && `saturate(${v.saturate})`, v.invert && 'invert(1) hue-rotate(180deg)'].filter(Boolean)
  if (filters.length) Object.assign(document.head.appendChild(document.createElement('style')), { id: 'sireader-visual-filter', textContent: `foliate-view::part(filter){filter:${filters.join(' ')}}` })
}

function applyViewTheme(view: FoliateView, th: any) {
  Object.assign(view.style, { background: th.bgImg ? `url("${th.bgImg}") center/cover no-repeat` : th.bg, color: th.color })
}

function applyCustomCSS(view: FoliateView, s: ReaderSettings) {
  if (!view || !view.renderer) return
  const { 
    textSettings: t = { fontFamily: 'inherit', fontSize: 16, letterSpacing: 0, customFont: { fontFamily: '', fontFile: '' } }, 
    paragraphSettings: p = { lineHeight: 1.8, textIndent: 2, paragraphSpacing: 1 }, 
    layoutSettings: l = { marginHorizontal: 40, marginVertical: 20 } 
  } = s
  
  const th = getTheme(s)
  const isCustomFont = t.fontFamily === 'custom' && t.customFont?.fontFamily
  const font = isCustomFont ? `"${t.customFont.fontFamily}", sans-serif` : t.fontFamily || 'inherit'
  
  // 自定义字体 @font-face 声明
  const fontFace = isCustomFont 
    ? `@font-face{font-family:"${t.customFont.fontFamily}";src:url("${location.origin}/plugins/custom-fonts/${t.customFont.fontFile}")}` 
    : ''
  
  // 背景样式
  const bgStyle = th.bgImg 
    ? `background:url("${th.bgImg}") center/cover no-repeat` 
    : `background:${th.bg}`
  
  // ===== CSS 规则构建 =====
  
  // 1. 命名空间声明
  const namespace = `@namespace epub "http://www.idpf.org/2007/ops";`
  
  // 2. 基础样式：html 和 body
  const baseStyles = `
    html{color-scheme:light dark}
    body{
      ${bgStyle}!important;
      color:${th.color}!important;
      font-family:${font}!important;
      font-size:${t.fontSize}px!important;
      letter-spacing:${t.letterSpacing}em!important;
      padding:${l.marginVertical}px ${l.marginHorizontal}px!important;
    }
  `
  
  // 3. 字体和字号强制应用：覆盖所有文本元素（解决部分书籍字体和字号不生效的问题）
  const fontForceStyles = `
    *{font-family:${font}!important;font-size:inherit!important}
    body,p,div,span,a,li,td,th,blockquote,pre,code{font-family:${font}!important}
    h1,h2,h3,h4,h5,h6{font-family:${font}!important;font-size:inherit!important}
  `
  
  // 4. 段落排版样式
  const paragraphStyles = `
    p,li,blockquote,dd{line-height:${p.lineHeight}!important;text-align:start;text-indent:${p.textIndent}em!important;margin-bottom:${p.paragraphSpacing}em!important}
    p,div,span,li,td,th{font-size:inherit!important}
  `
  
  // 5. 对齐方式样式
  const alignStyles = `
    [align="left"]{text-align:left!important}
    [align="right"]{text-align:right!important}
    [align="center"]{text-align:center!important}
    [align="justify"]{text-align:justify!important}
  `
  
  // 6. 代码块样式
  const codeStyles = `pre{white-space:pre-wrap!important}`
  
  // 7. 隐藏脚注/尾注元素（防止脚注内容显示在正文中）
  const footnoteHideStyles = `
    aside[epub|type~="footnote"],
    aside[epub|type~="endnote"],
    aside[epub|type~="rearnote"],
    section[epub|type~="footnote"],
    section[epub|type~="endnote"],
    section[epub|type~="rearnote"],
    [role~="doc-footnote"],
    [role~="doc-endnote"]{
      display:none!important;
    }
  `
  
  // 组合所有样式
  const styles = [namespace,fontFace,baseStyles,fontForceStyles,paragraphStyles,alignStyles,codeStyles,footnoteHideStyles].join('')
  view.renderer.setStyles?.(styles)
}

function getCurrentLocation(view: FoliateView): Location | null {
  if (!view) return null
  try {
    const renderer = view.renderer as any
    if (renderer?.index !== undefined) return { index: renderer.index ?? 0, fraction: renderer.fraction ?? 0, cfi: view.lastLocation?.cfi }
    if (view.lastLocation) return { index: view.lastLocation.index ?? 0, fraction: view.lastLocation.fraction ?? 0, cfi: view.lastLocation.cfi }
    return null
  } catch (e) {
    console.error('[FoliateView] Failed to get location:', e)
    return null
  }
}

function destroyView(view: FoliateView) {
  try { view.remove() } catch {}
}

/**
 * Foliate Reader 主类
 */
export class FoliateReader {
  private view: FoliateView
  private container: HTMLElement
  private settings: ReaderSettings
  private plugin: Plugin

  // 统一标记管理器（从外部设置）
  public marks: any

  // 搜索管理器
  public searchManager: EPUBSearch

  // 事件监听器
  private eventListeners = new Map<string, Set<Function>>()

  constructor(options: ReaderOptions) {
    this.container = options.container
    this.settings = options.settings
    this.plugin = options.plugin

    // 创建 View
    this.view = createFoliateView(this.container)

    // 创建搜索管理器
    this.searchManager = new EPUBSearch(this.view)

    // 设置事件监听
    this.setupEventListeners()

    // 监听设置变化
    this.listenToSettingsChanges()
  }

  /**
   * 打开书籍
   */
  async open(file: File | string | any) {
    await this.view.open(file)
    this.applySettings()
    if (this.marks) await this.marks.init()
    this.emit('loaded', { book: this.view.book })
  }

  /**
   * 应用设置
   */
  private applySettings() {
    configureView(this.view, this.settings)
    applyCustomCSS(this.view, this.settings)
    requestAnimationFrame(() => (this.view.renderer as any)?.render?.())
  }

  /**
   * 设置事件监听
   */
  private setupEventListeners() {
    ['relocate', 'load', 'external-link'].forEach(event => {
      this.view.addEventListener(event, ((e: CustomEvent) => this.emit(event, e.detail)) as EventListener)
    })
    
    // 图片加载错误处理
    this.view.addEventListener('load', ((e: CustomEvent) => {
      const { doc } = e.detail || {}
      if (!doc) return
      
      // 隐藏加载失败的图片
      doc.querySelectorAll('img').forEach((img: HTMLImageElement) => img.onerror = () => img.style.display = 'none')
    }) as EventListener)
    
    // 脚注处理
    this.view.addEventListener('link', ((e: CustomEvent) => {
      const { a, href } = e.detail
      if (!a || !href) { this.emit('link', e.detail); return }
      const types = new Set(a?.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type')?.split(' '))
      const roles = new Set(a?.getAttribute?.('role')?.split(' '))
      const cls = a?.className || '', id = a?.id || '', txt = a?.textContent?.trim() || ''
      const isSuper = (el: HTMLElement) => el && (el.matches('sup') || /^(super|top|\d)/.test(getComputedStyle(el).verticalAlign))
      const isRef = ['doc-noteref', 'doc-biblioref', 'doc-glossref', 'doc-footnote', 'doc-endnote'].some(r => roles.has(r)) || ['noteref', 'biblioref', 'glossref', 'footnote', 'endnote', 'note', 'rearnote'].some(t => types.has(t)) || !(types.has('backlink') || roles.has('doc-backlink') || /back|return/i.test(cls + id)) && (/note|foot|end|ref|annotation|comment|fn/i.test(cls + id) || (isSuper(a) || a.children.length === 1 && isSuper(a.children[0] as HTMLElement) || isSuper(a.parentElement as HTMLElement)) && (/^[\[\(]?\d+[\]\)]?$/.test(txt) || /^[\[\(]?[*†‡§¶#]+[\]\)]?$/.test(txt)))
      isRef ? (e.preventDefault(), this.showFootnote(a, href).catch(() => {})) : this.emit('link', e.detail)
    }) as EventListener)
  }

  private async showFootnote(a: HTMLElement, href: string) {
    try {
      const target = await this.view.book.resolveHref(href), section = this.view.book.sections[target?.index]
      if (!section) return
      const doc = new DOMParser().parseFromString(await (await fetch(await section.load())).text(), 'text/html'), el = target.anchor(doc)
      if (!el) return
      
      const types = new Set(el?.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type')?.split(' '))
      const roles = new Set(el?.getAttribute?.('role')?.split(' '))
      const cls = el?.className || '', id = el?.id || '', i = this.plugin.i18n
      const noteType = /endnote|rearnote/i.test([...roles, ...types, cls].join()) ? i.endnote || '尾注' : /footnote/i.test([...roles, ...types, cls].join()) ? i.footnote || '脚注' : /biblio|reference/i.test([...roles, ...types, cls].join()) ? i.reference || '参考文献' : /gloss|definition/i.test([...roles, ...types, cls].join()) ? i.glossary || '术语' : /note/i.test([...roles, ...types, cls].join()) ? i.annotation || '注释' : i.note || '注'
      
      const clone = el.cloneNode(true) as HTMLElement
      clone.querySelectorAll('a').forEach(l => { const t = new Set(l.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type')?.split(' ')), r = new Set(l.getAttribute?.('role')?.split(' ')); (t.has('backlink') || r.has('doc-backlink') || /back|return/i.test(l.className)) && l.remove() })
      
      const range = doc.createRange(), div = document.createElement('div')
      clone.matches('li,aside,div,section,p') ? range.selectNodeContents(clone) : range.selectNode(clone)
      div.appendChild(range.cloneContents())
      
      let tooltip = document.querySelector('[data-footnote-tooltip]') as HTMLDivElement
      if (!tooltip) {
        tooltip = document.createElement('div'); tooltip.setAttribute('data-footnote-tooltip', ''); tooltip.style.cssText = 'position:fixed;display:none;width:340px;background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:99999;pointer-events:auto;overflow:hidden;transition:all .2s'; document.body.appendChild(tooltip)
      }
      
      const content = `<div style="padding:14px;font-size:13px;line-height:1.7;max-height:300px;overflow-y:auto;user-select:text">${div.innerHTML.trim() || '无内容'}</div>`
      tooltip.innerHTML = createTooltip({ icon: '#iconMark', iconColor: '#ef4444', title: `${noteType} (${i.clickToJump || '点击跳转'})`, content, id: id ? `#${id}` : '' })
      
      const header = tooltip.firstElementChild as HTMLElement
      if (header) { header.style.cursor = 'pointer'; header.onclick = () => { hideTooltip(tooltip, 0); this.goTo(href).catch(() => {}) } }
      
      const rect = a.getBoundingClientRect(), iframe = a.ownerDocument.defaultView?.frameElement as HTMLIFrameElement, ir = iframe?.getBoundingClientRect(), x = (ir?.left || 0) + rect.left, y = (ir?.top || 0) + rect.bottom + 8
      let timer: any
      showTooltip(tooltip, x, y)
      a.onmouseenter = () => { clearTimeout(timer); showTooltip(tooltip, x, y) }
      a.onmouseleave = () => timer = setTimeout(() => hideTooltip(tooltip), 100)
      tooltip.onmouseenter = () => clearTimeout(timer)
      tooltip.onmouseleave = () => hideTooltip(tooltip)
    } catch (e) { console.error('[Footnote]', e) }
  }

  /**
   * 监听设置变化
   */
  private listenToSettingsChanges() {
    window.addEventListener('sireaderSettingsUpdated', ((e: CustomEvent) => this.updateSettings(e.detail)) as EventListener)
    this.settings.theme === 'auto' && watchTheme(() => this.applySettings())
  }

  /**
   * 导航方法
   */
  private check = () => this.view.renderer || (console.warn('[Reader] Renderer not ready'), null)
  async goTo(target: string | number | Location) { 
    if (!this.check()) return
    try {
      await this.view.goTo(target)
    } catch (error) {
      console.warn('[Reader] Failed to go to target:', error)
    }
  }
  async goLeft() { this.check() && await this.view.goLeft() }
  async goRight() { this.check() && await this.view.goRight() }
  async prev() { this.check() && await this.view.prev() }
  async next() { this.check() && await this.view.next() }
  async goToFraction(fraction: number) { this.check() && await this.view.goToFraction(fraction) }

  /**
   * 位置和进度
   */
  getLocation = () => getCurrentLocation(this.view)
  getProgress = () => this.view.lastLocation

  /**
   * 历史导航
   */
  canGoBack = () => this.view.history?.canGoBack ?? false
  canGoForward = () => this.view.history?.canGoForward ?? false
  goBack = () => this.view.history?.back()
  goForward = () => this.view.history?.forward()

  /**
   * 搜索
   */
  async *search(query: string, options?: any) {
    yield* this.searchManager.search(query, options)
  }

  clearSearch = () => this.searchManager.clear()
  nextSearchResult = () => this.searchManager.next()
  prevSearchResult = () => this.searchManager.prev()
  getSearchResults = () => this.searchManager.getResults()
  getCurrentSearchResult = () => this.searchManager.getCurrent()

  /**
   * 选择文本
   */
  async select(target: string | Location) {
    if ((this.view as any).select) await (this.view as any).select(target)
  }

  deselect = () => (this.view as any).deselect?.()

  /**
   * 获取选中的文本
   */
  getSelectedText(): { text: string; range: Range } | null {
    try {
      for (const { doc } of this.view.renderer?.getContents?.() || []) {
        const sel = doc.defaultView?.getSelection()
        if (sel && !sel.isCollapsed) return { text: sel.toString(), range: sel.getRangeAt(0) }
      }
    } catch (e) {
      console.error('[Reader] Selection error:', e)
    }
    return null
  }

  /**
   * 事件系统
   */
  on(event: string, cb: Function) { 
    this.eventListeners.has(event) || this.eventListeners.set(event, new Set())
    this.eventListeners.get(event)!.add(cb)
  }
  off = (event: string, cb: Function) => this.eventListeners.get(event)?.delete(cb)
  private emit(event: string, data?: any) { 
    this.eventListeners.get(event)?.forEach(cb => { 
      try { cb(data) } catch (e) { console.error(`[Reader] Event error (${event}):`, e) } 
    }) 
  }

  /**
   * 设置和信息
   */
  updateSettings(settings: ReaderSettings) { this.settings = settings; this.applySettings() }
  getBook = () => this.view.book
  getView = () => this.view

  /**
   * 销毁
   */
  async destroy() { 
    await this.marks?.destroy()
    this.eventListeners.clear()
    destroyView(this.view) 
  }
}

/**
 * 创建 Reader 实例
 */
export function createReader(options: ReaderOptions): FoliateReader {
  return new FoliateReader(options)
}

// ===== 导出工具函数 =====

export { createFoliateView, configureView, applyCustomCSS, getCurrentLocation, destroyView }