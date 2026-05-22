/**
 * Foliate Reader - 统一阅读器
 * 整合 View 创建、配置、标记管理等功能
 */

import type { Plugin } from 'siyuan'
import type { FoliateView, Location } from './types'
import type { ReaderSettings } from '@/composables/useSetting'
import { PRESET_THEMES } from '@/composables/useSetting'
import { createTooltip, hideTooltip, showTooltip } from '@/core/MarkManager'
import { EPUBSearch } from './search'
import { isMobile } from '@/utils/mobile'
import 'foliate-js/view.js'

export interface ReaderOptions {
  container: HTMLElement
  settings: ReaderSettings
  plugin: Plugin
}

const resolveColor = (color: string) =>
  color.startsWith('var(')
    ? getComputedStyle(document.documentElement).getPropertyValue(color.slice(4, -1)).trim()
    : color

const resolveTheme = (theme: any) => ({ ...theme, bg: resolveColor(theme.bg), color: resolveColor(theme.color) })
const getTheme = (settings: ReaderSettings) =>
  resolveTheme(settings.theme === 'custom' ? settings.customTheme : PRESET_THEMES[settings.theme] || PRESET_THEMES.default)
const getViewBackground = (theme: any) => theme.bgImg ? `${theme.bg} url("${theme.bgImg}") center/cover no-repeat` : theme.bg
const getAttrSet = (el: Element | null | undefined, ns: string | null, name: string) =>
  new Set((ns ? el?.getAttributeNS?.(ns, name) : el?.getAttribute?.(name))?.split(' '))
const isBackLink = (el: Element | null | undefined, types: Set<string>, roles: Set<string>) =>
  types.has('backlink') || roles.has('doc-backlink') || /back|return/i.test((el as HTMLElement | null)?.className || '')
const getNoteType = (i: any, roles: Set<string>, types: Set<string>, cls: string) => {
  const key = [...roles, ...types, cls].join()
  return /endnote|rearnote/i.test(key) ? i.endnote || '尾注'
    : /footnote/i.test(key) ? i.footnote || '脚注'
    : /biblio|reference/i.test(key) ? i.reference || '参考'
    : /gloss|definition/i.test(key) ? i.glossary || '术语'
    : /note/i.test(key) ? i.annotation || '注释'
    : i.note || '注释'
}

const watchTheme = (cb: () => void) => {
  const observer = new MutationObserver(() => requestAnimationFrame(cb))
  observer.observe(document.documentElement, { attributeFilter: ['data-theme-mode', 'class'] })
  return observer
}

const getStyleTag = (id: string) =>
  document.getElementById(id) || Object.assign(document.head.appendChild(document.createElement('style')), { id })
const noteRefNumberPattern = /^[\[\(]?\d+[\]\)]?$/
const noteRefSymbolPattern = /^[\[\(]?[*†‡]+[\]\)]?$/

const readText = (value: any): string => {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(readText).find(Boolean) || ''
  if (value && typeof value === 'object') return readText(value.label ?? value.name ?? value.value ?? value.text ?? '')
  return ''
}

function createFoliateView(container: HTMLElement): FoliateView {
  const view = document.createElement('foliate-view') as FoliateView
  view.style.cssText = 'display:block;width:100%;height:100%'
  view.setAttribute('persist', 'false')
  container.appendChild(view)
  return view
}

function getLayoutMetrics(settings: ReaderSettings) {
  const { viewMode = 'single', layoutSettings: layout = { gap: 0, headerFooterMargin: 0 } } = settings
  const scroll = viewMode === 'scroll'
  const columns = isMobile() || scroll ? 1 : viewMode === 'double' ? 2 : 1
  return {
    scroll,
    columns,
    gap: Math.max(0, layout.gap || 0),
    margin: Math.max(0, layout.headerFooterMargin || 0),
    maxInlineSize: layout.maxInlineSize || 0,
    maxBlockSize: layout.maxBlockSize || 0,
  }
}

function configureView(view: FoliateView, settings: ReaderSettings) {
  const renderer = view.renderer
  if (!renderer) return
  const { pageAnimation = 'slide', visualSettings } = settings
  const { scroll, columns, gap, margin, maxInlineSize, maxBlockSize } = getLayoutMetrics(settings)
  const set = (name: string, value: string) => renderer.setAttribute(name, value)
  set('flow', scroll ? 'scrolled' : 'paginated')
  set('max-column-count', String(columns))
  !scroll && pageAnimation === 'slide' ? set('animated', '') : renderer.removeAttribute('animated')
  gap > 0 ? set('gap', `${gap}%`) : renderer.removeAttribute('gap')
  margin > 0 ? set('margin', `${margin}px`) : renderer.removeAttribute('margin')
  maxInlineSize ? set('max-inline-size', `${maxInlineSize}px`) : renderer.removeAttribute('max-inline-size')
  maxBlockSize ? set('max-block-size', `${maxBlockSize}px`) : renderer.removeAttribute('max-block-size')
  applyVisualFilter(visualSettings)
  applyViewTheme(view, getTheme(settings))
}

function applyVisualFilter(visual: any = {}) {
  const filters = [
    visual.brightness !== 1 && `brightness(${visual.brightness})`,
    visual.contrast !== 1 && `contrast(${visual.contrast})`,
    visual.sepia > 0 && `sepia(${visual.sepia})`,
    visual.saturate !== 1 && `saturate(${visual.saturate})`,
    visual.invert && 'invert(1) hue-rotate(180deg)'
  ].filter(Boolean)
  getStyleTag('sireader-visual-filter').textContent = `
    foliate-view::part(container),foliate-view::part(filter){background:var(--sr-epub-bg)!important}
    foliate-view::part(filter){${filters.length ? `filter:${filters.join(' ')}` : ''}}
  `
}

function applyViewTheme(view: FoliateView, theme: any) {
  const bg = getViewBackground(theme)
  view.style.setProperty('--sr-epub-bg', bg)
  Object.assign(view.style, { background: bg, color: theme.color })
  Object.assign(view.renderer?.style || {}, {
    background: bg,
    color: theme.color,
  })
  if (view.parentElement) view.parentElement.style.background = bg
}

function applyCustomCSS(view: FoliateView, settings: ReaderSettings) {
  const {
    textSettings: text = { fontFamily: 'inherit', fontSize: 16, letterSpacing: 0, customFont: { fontFamily: '', fontFile: '' } },
    paragraphSettings: paragraph = { lineHeight: 1.8, textIndent: 2, paragraphSpacing: 1 }
  } = settings
  const theme = getTheme(settings)
  const mobile = isMobile()
  const customFont = text.fontFamily === 'custom' ? text.customFont?.fontFamily : ''
  const font = customFont ? `"${customFont}", sans-serif` : text.fontFamily || 'inherit'
  const fontFace = customFont
    ? `@font-face{font-family:"${customFont}";src:url("${location.origin}/plugins/custom-fonts/${text.customFont.fontFile}")}`
    : ''
  view.renderer?.setStyles?.([
    `@namespace epub "http://www.idpf.org/2007/ops";`,
    fontFace,
    `
    html{
      background:${getViewBackground(theme)}!important;
      color:${theme.color}!important;
      ${mobile ? '' : 'color-scheme:light dark'}
      width:100%!important;
      min-width:100%!important;
      min-height:100%!important;
      box-sizing:border-box!important;
      scrollbar-width:none!important;
      -ms-overflow-style:none!important;
      ${mobile ? '-webkit-touch-callout:none!important;' : ''}
    }
    html::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}
    body{
      background:transparent!important;
      color:${theme.color}!important;
      font-family:${font}!important;
      font-size:${text.fontSize}px!important;
      letter-spacing:${text.letterSpacing}em!important;
      margin:0!important;
      box-sizing:border-box!important;
      scrollbar-width:none!important;
      -ms-overflow-style:none!important;
      ${mobile ? 'width:100%!important;min-width:100%!important;max-width:none!important;display:block!important;' : ''}
    }
    body::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}
    *{font-family:${font}!important;font-size:inherit!important}
    body,p,div,span,a,li,td,th,blockquote,pre,code,h1,h2,h3,h4,h5,h6{font-family:${font}!important}
    h1,h2,h3,h4,h5,h6,p,div,span,li,td,th{font-size:inherit!important}
    p,li,blockquote,dd{line-height:${paragraph.lineHeight}!important;text-align:start;text-indent:${paragraph.textIndent}em!important;margin-bottom:${paragraph.paragraphSpacing}em!important}
    ${mobile ? 'body>*{max-width:100%!important}img,svg,video,table,pre,code{max-width:100%!important}' : ''}
    [align="left"]{text-align:left!important}
    [align="right"]{text-align:right!important}
    [align="center"]{text-align:center!important}
    [align="justify"]{text-align:justify!important}
    pre{white-space:pre-wrap!important}
    aside[epub|type~="footnote"],
    aside[epub|type~="endnote"],
    aside[epub|type~="rearnote"],
    section[epub|type~="footnote"],
    section[epub|type~="endnote"],
    section[epub|type~="rearnote"],
    [role~="doc-footnote"],
    [role~="doc-endnote"]{display:none!important}
  `
  ].join(''))
  Object.assign((view.renderer as HTMLElement | undefined)?.style || {}, {
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
  })
}

function getCurrentLocation(view: FoliateView): Location | null {
  try {
    const renderer = view.renderer as any
    if (renderer?.index !== undefined) return { index: renderer.index ?? 0, fraction: renderer.fraction ?? 0, cfi: view.lastLocation?.cfi }
    if (view.lastLocation) return { index: view.lastLocation.index ?? 0, fraction: view.lastLocation.fraction ?? 0, cfi: view.lastLocation.cfi }
    return null
  } catch (error) {
    console.error('[FoliateView] Failed to get location:', error)
    return null
  }
}

const applyMarginal = (el: HTMLElement | undefined, text: string, margin = 48) => {
  if (!el) return
  el.textContent = text
  Object.assign(el.style, {
    textAlign: 'start',
    fontSize: `${Math.max(0, Math.min(12, margin * 0.75))}px`,
    lineHeight: '1',
  })
}

function updateMarginals(view: FoliateView) {
  const renderer = view.renderer as any
  const head = renderer?.heads?.[0] as HTMLElement | undefined
  const foot = renderer?.feet?.[0] as HTMLElement | undefined
  if (!head || !foot) return
  const margin = parseFloat(getComputedStyle(renderer).getPropertyValue('--_margin')) || 48
  const title = readText(view.book?.metadata?.title)
  const chapter = readText(view.lastLocation?.tocItem?.label) || title
  const chapterPages = Number.isFinite(renderer?.page) && Number.isFinite(renderer?.pages) && renderer.pages > 2
    ? `${Math.min(renderer.pages - 2, Math.max(1, renderer.page))}/${renderer.pages - 2}`
    : ''
  const totalFraction = view.lastLocation?.fraction
  const footer = [chapterPages, typeof totalFraction === 'number' ? `${Math.round(totalFraction * 100)}%` : '']
    .filter(Boolean)
    .join(' · ')
  applyMarginal(head, chapter || title, margin)
  applyMarginal(foot, footer, margin)
}

function refreshMarginals(view: FoliateView) {
  requestAnimationFrame(() => requestAnimationFrame(() => updateMarginals(view)))
  setTimeout(() => updateMarginals(view), 0)
}

function refreshRenderer(view: FoliateView) {
  requestAnimationFrame(() => {
    ;(view.renderer as any)?.render?.()
    refreshMarginals(view)
  })
}

export class FoliateReader {
  private view: FoliateView
  private container: HTMLElement
  private settings: ReaderSettings
  private plugin: Plugin
  private eventListeners = new Map<string, Set<Function>>()
  private themeObserver?: MutationObserver
  private resizeObserver?: ResizeObserver
  private syncThemeObserver = (auto: boolean) => auto
    ? this.themeObserver ||= watchTheme(() => this.applySettings())
    : (this.themeObserver?.disconnect(), this.themeObserver = undefined)

  public marks: any
  public searchManager: EPUBSearch

  constructor(options: ReaderOptions) {
    this.container = options.container
    this.settings = options.settings
    this.plugin = options.plugin
    this.view = createFoliateView(options.container)
    this.searchManager = new EPUBSearch(this.view)
    this.setupEventListeners()
    this.resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => this.applySettings()))
    this.resizeObserver.observe(this.container)
    this.listenToSettingsChanges()
  }

  async open(file: File | string | any) {
    await this.view.open(file)
    const renderer = this.view.renderer as any
    if (renderer && !renderer.__sireaderMarginalsBound) {
      renderer.__sireaderMarginalsBound = true
      const refresh = () => refreshMarginals(this.view)
      renderer.addEventListener('load', refresh)
      renderer.addEventListener('relocate', refresh)
    }
    this.applySettings()
    refreshMarginals(this.view)
    if (this.marks) await this.marks.init()
    this.emit('loaded', { book: this.view.book })
  }

  private applySettings() {
    configureView(this.view, this.settings)
    applyCustomCSS(this.view, this.settings)
    refreshRenderer(this.view)
  }

  private setupEventListeners() {
    this.view.addEventListener('relocate', ((e: CustomEvent) => {
      refreshMarginals(this.view)
      this.emit('relocate', e.detail)
    }) as EventListener)
    this.view.addEventListener('load', ((e: CustomEvent) => {
      refreshMarginals(this.view)
      this.emit('load', e.detail)
    }) as EventListener)
    this.view.addEventListener('external-link', ((e: CustomEvent) => this.emit('external-link', e.detail)) as EventListener)

    this.view.addEventListener('load', ((e: CustomEvent) => {
      const { doc } = e.detail || {}
      if (!doc) return
      doc.querySelectorAll('img').forEach((img: HTMLImageElement) => { img.onerror = () => { img.style.display = 'none' } })
    }) as EventListener)

    this.view.addEventListener('link', ((e: CustomEvent) => {
      const { a, href } = e.detail
      if (!a || !href) return this.emit('link', e.detail)
      const types = getAttrSet(a, 'http://www.idpf.org/2007/ops', 'type')
      const roles = getAttrSet(a, null, 'role')
      const cls = a.className || ''
      const id = a.id || ''
      const txt = a.textContent?.trim() || ''
      const isSuper = (el: HTMLElement | null) => !!el && (el.matches('sup') || /^(super|top|\d)/.test(getComputedStyle(el).verticalAlign))
      const isRef = ['doc-noteref', 'doc-biblioref', 'doc-glossref', 'doc-footnote', 'doc-endnote'].some(role => roles.has(role))
        || ['noteref', 'biblioref', 'glossref', 'footnote', 'endnote', 'note', 'rearnote'].some(type => types.has(type))
        || (
          !isBackLink(a, types, roles)
          && (
            /note|foot|end|ref|annotation|comment|fn/i.test(cls + id)
            || ((isSuper(a) || (a.children.length === 1 && isSuper(a.children[0] as HTMLElement)) || isSuper(a.parentElement as HTMLElement))
              && (/^[\[\(]?\d+[\]\)]?$/.test(txt) || /^[\[\(]?[*†‡]+[\]\)]?$/.test(txt)))
          )
        )
      if (!isRef) return this.emit('link', e.detail)
      e.preventDefault()
      this.showFootnote(a, href).catch(() => {})
    }) as EventListener)
  }

  private async showFootnote(a: HTMLElement, href: string) {
    try {
      const target = await this.view.book.resolveHref(href)
      const section = this.view.book.sections[target?.index]
      if (!section) return
      const html = await (await fetch(await section.load())).text()
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const el = target.anchor(doc)
      if (!el) return

      const types = getAttrSet(el, 'http://www.idpf.org/2007/ops', 'type')
      const roles = getAttrSet(el, null, 'role')
      const cls = el.className || ''
      const id = el.id || ''
      const i = this.plugin.i18n
      const noteType = getNoteType(i, roles, types, cls)

      const clone = el.cloneNode(true) as HTMLElement
      clone.querySelectorAll('a').forEach(link => {
        const linkTypes = getAttrSet(link, 'http://www.idpf.org/2007/ops', 'type')
        const linkRoles = getAttrSet(link, null, 'role')
        if (isBackLink(link, linkTypes, linkRoles)) link.remove()
      })

      const range = doc.createRange()
      const contentWrap = document.createElement('div')
      clone.matches('li,aside,div,section,p') ? range.selectNodeContents(clone) : range.selectNode(clone)
      contentWrap.appendChild(range.cloneContents())

      let tooltip = document.querySelector('[data-footnote-tooltip]') as HTMLDivElement | null
      if (!tooltip) {
        tooltip = document.createElement('div')
        tooltip.setAttribute('data-footnote-tooltip', '')
        tooltip.style.cssText = 'position:fixed;display:none;width:340px;background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:99999;pointer-events:auto;overflow:hidden;transition:all .2s'
        document.body.appendChild(tooltip)
      }

      const content = `<div style="padding:14px;font-size:13px;line-height:1.7;max-height:300px;overflow-y:auto;user-select:text">${contentWrap.innerHTML.trim() || '无内容'}</div>`
      tooltip.innerHTML = createTooltip({
        icon: '#iconMark',
        iconColor: '#ef4444',
        title: `${noteType} (${i.clickToJump || '点击跳转'})`,
        content,
        id: id ? `#${id}` : ''
      })

      const header = tooltip.firstElementChild as HTMLElement | null
      if (header) {
        header.style.cursor = 'pointer'
        header.onclick = () => {
          hideTooltip(tooltip!, 0)
          this.goTo(href).catch(() => {})
        }
      }

      const rect = a.getBoundingClientRect()
      const iframe = a.ownerDocument.defaultView?.frameElement as HTMLIFrameElement | null
      const frameRect = iframe?.getBoundingClientRect()
      const x = (frameRect?.left || 0) + rect.left
      const y = (frameRect?.top || 0) + rect.bottom + 8
      let timer: any
      showTooltip(tooltip, x, y)
      a.onmouseenter = () => { clearTimeout(timer); showTooltip(tooltip!, x, y) }
      a.onmouseleave = () => { timer = setTimeout(() => hideTooltip(tooltip!), 100) }
      tooltip.onmouseenter = () => clearTimeout(timer)
      tooltip.onmouseleave = () => hideTooltip(tooltip)
    } catch (error) {
      console.error('[Footnote]', error)
    }
  }

  private listenToSettingsChanges() {
    window.addEventListener('sireaderSettingsUpdated', ((e: CustomEvent) => this.updateSettings(e.detail)) as EventListener)
    this.syncThemeObserver(this.settings.theme === 'auto')
  }

  private check = () => this.view.renderer || (console.warn('[Reader] Renderer not ready'), null)

  async goTo(target: string | number | Location) { this.check() && await this.view.goTo(target) }
  async goToTextStart() { this.check() && await this.view.goToTextStart?.() }
  async goLeft() { this.check() && await this.view.goLeft() }
  async goRight() { this.check() && await this.view.goRight() }
  async prev() { this.check() && await this.view.prev() }
  async next() { this.check() && await this.view.next() }
  async goToFraction(fraction: number) { this.check() && await this.view.goToFraction(fraction) }

  getLocation = () => getCurrentLocation(this.view)
  getProgress = () => this.view.lastLocation

  canGoBack = () => this.view.history?.canGoBack ?? false
  canGoForward = () => this.view.history?.canGoForward ?? false
  goBack = () => this.view.history?.back()
  goForward = () => this.view.history?.forward()

  async *search(query: string, options?: any) {
    yield* this.searchManager.search(query, options)
  }

  clearSearch = () => this.searchManager.clear()
  nextSearchResult = () => this.searchManager.next()
  prevSearchResult = () => this.searchManager.prev()
  getSearchResults = () => this.searchManager.getResults()
  getCurrentSearchResult = () => this.searchManager.getCurrent()

  async select(target: string | Location) {
    if ((this.view as any).select) await (this.view as any).select(target)
  }

  deselect = () => (this.view as any).deselect?.()

  getSelectedText(): { text: string; range: Range } | null {
    try {
      for (const { doc } of this.view.renderer?.getContents?.() || []) {
        const selection = doc.defaultView?.getSelection()
        if (selection && !selection.isCollapsed) return { text: selection.toString(), range: selection.getRangeAt(0) }
      }
    } catch (error) {
      console.error('[Reader] Selection error:', error)
    }
    return null
  }

  on(event: string, cb: Function) {
    (this.eventListeners.get(event) || (this.eventListeners.set(event, new Set()), this.eventListeners.get(event)!)).add(cb)
  }

  off = (event: string, cb: Function) => this.eventListeners.get(event)?.delete(cb)
  private emit(event: string, data?: any) {
    this.eventListeners.get(event)?.forEach(cb => {
      try { cb(data) } catch (error) { console.error(`[Reader] Event error (${event}):`, error) }
    })
  }

  updateSettings(settings: ReaderSettings) {
    this.syncThemeObserver(settings.theme === 'auto')
    this.settings = settings
    this.applySettings()
  }

  getBook = () => this.view.book
  getView = () => this.view

  async destroy() {
    await this.marks?.destroy()
    this.themeObserver?.disconnect()
    this.resizeObserver?.disconnect()
    this.eventListeners.clear()
    try { this.view.remove() } catch {}
  }
}

export function createReader(options: ReaderOptions): FoliateReader {
  return new FoliateReader(options)
}
