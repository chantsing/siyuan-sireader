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
import { createTxtBook, isTxtSource } from '@/core/txt/book'
import { isMobile } from '@/utils/mobile'
import { FootnoteHandler } from 'foliate-js/footnotes.js'
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
const isDark = (c = '') => { const m = c.match(/\d+(\.\d+)?/g)?.slice(0, 3).map(Number); return !!m && (m[0] * 299 + m[1] * 587 + m[2] * 114) / 1000 < 128 }

const fontBlobCache = new Map<string, Promise<string | null>>()
const isSupportedFont = (buffer: ArrayBuffer): boolean => {
  if (buffer.byteLength < 4) return false
  const magic = new DataView(buffer).getUint32(0, false)
  return magic === 0x00010000 || magic === 0x4F54544F || magic === 0x774F4646 || magic === 0x774F4632
}
const getFontMimeType = (buffer: ArrayBuffer): string => {
  const magic = new DataView(buffer).getUint32(0, false)
  if (magic === 0x00010000) return 'font/truetype'
  if (magic === 0x4F54544F) return 'font/opentype'
  if (magic === 0x774F4646) return 'font/woff'
  if (magic === 0x774F4632) return 'font/woff2'
  return 'font/truetype'
}
const fetchFontAsBlob = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const buffer = await response.arrayBuffer()
    if (!isSupportedFont(buffer)) return null
    const blob = new Blob([buffer], { type: getFontMimeType(buffer) })
    const blobUrl = URL.createObjectURL(blob)
    const testFont = new FontFace('__test__', `url("${blobUrl}")`)
    await testFont.load()
    return blobUrl
  } catch {
    return null
  }
}
const getFontBlobUrl = async (url: string): Promise<string | null> => {
  if (fontBlobCache.has(url)) return fontBlobCache.get(url)!
  const promise = fetchFontAsBlob(url)
  fontBlobCache.set(url, promise)
  return promise
}


const watchTheme = (cb: () => void) => {
  const observer = new MutationObserver(() => requestAnimationFrame(cb))
  observer.observe(document.documentElement, { attributeFilter: ['data-theme-mode', 'class'] })
  return observer
}

const getStyleTag = (id: string) =>
  document.getElementById(id) || Object.assign(document.head.appendChild(document.createElement('style')), { id })
const setAttr = (el: Element, name: string, value: string, on: any = true) => on ? el.setAttribute(name, value) : el.removeAttribute(name)
const numericNotePattern = /^.{0,2}\d+$/
const inlineFootnoteSelector = '.js_readerFooterNote,.zhangyue-footnote,.duokan-footnote,.qqreader-footnote'
const footnoteSelector = `${inlineFootnoteSelector},.footnote-link,.footnote`
const footnoteLinkClasses = ['duokan-footnote', 'footnote-link', 'footnote']
const shouldCheckAsFootnote = (a: HTMLAnchorElement) => {
  if (!numericNotePattern.test(a.textContent?.trim() || '')) return false
  // 仅在导航容器（目录/脚注列表）内才视为非脚注引用，
  // 避免之前向上遍历到 <section> 时把正文中密集的脚注标误判为目录链接
  const navParent = a.closest('nav, ol, ul')
  if (navParent) {
    const count = Array.from(navParent.querySelectorAll('a')).filter(link => link !== a && numericNotePattern.test(link.textContent?.trim() || '')).length
    if (count >= 2) return false
  }
  return true
}
const footnoteText = (el: HTMLElement, target?: Element | null) =>
  (el.getAttribute('data-wr-footernote') || el.getAttribute('zy-footnote') || el.querySelector('img')?.getAttribute('alt') || el.getAttribute('alt') || (target as HTMLElement | null)?.getAttribute?.('alt') || el.textContent || '').trim()
const inlineFootnote = (target: Element | null) => {
  const el = target?.closest?.(inlineFootnoteSelector) as HTMLElement | null
  if (!el || el.closest('a[href]')) return null
  const text = footnoteText(el, target)
  return text.trim() ? { el, text: text.trim() } : null
}
const normalizeFootnoteTypes = (doc?: Document) => {
  if (!doc) return
  doc.querySelectorAll('[type~="noteref"],[type~="footnote"],[type~="endnote"],[type~="note"],[type~="rearnote"]').forEach(el => {
    const type = el.getAttribute('type')
    if (type && !el.getAttribute('epub:type')) el.setAttribute('epub:type', type)
  })
  doc.querySelectorAll('aside,section').forEach(el => {
    if (el.hasAttribute('data-sr-footnote')) return
    const epubType = el.getAttribute('epub:type') || el.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || ''
    const role = el.getAttribute('role') || ''
    if (/\b(footnote|endnote|rearnote)\b/.test(epubType) || /\bdoc-(footnote|endnote)\b/.test(role)) {
      el.setAttribute('data-sr-footnote', 'true')
    }
  })
  // 收集本 section 内脚注内容的 id，用于检测同 section 脚注引用链接
  const footnoteIds = new Set<string>()
  doc.querySelectorAll('aside[data-sr-footnote],section[data-sr-footnote]').forEach(el => {
    if (el.id) footnoteIds.add(el.id)
  })
  // 为脚注引用链接补全 role="doc-noteref"，
  // 规避 HTML 解析模式下 foliate-js getTypes 通过 getNamedItem('epub:type') 读取不稳定的问题，
  // 让 isFootnoteReference 走 getRoles 这一可靠路径（yes 分支直接命中）
  doc.querySelectorAll('a[href]').forEach(a => {
    const epubType = a.getAttribute('epub:type') || a.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || ''
    const type = a.getAttribute('type') || ''
    const hash = (a.getAttribute('href') || '').split('#')[1]
    if (/\bnoteref\b/.test(epubType) || /\bnoteref\b/.test(type) || (hash && footnoteIds.has(hash))) {
      const role = a.getAttribute('role') || ''
      if (!/\bdoc-noteref\b/.test(role)) {
        a.setAttribute('role', role ? `${role} doc-noteref` : 'doc-noteref')
      }
    }
  })
}

const isFootnoteClick = (target: Element | null) => {
  const a = target?.closest?.('a')
  const key = [a?.className, a?.id, a?.getAttribute('href'), a?.getAttribute('type'), a?.getAttribute('role'), a?.getAttribute('epub:type'), a?.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type')].join(' ')
  return !!target?.closest?.(`sup,${footnoteSelector}`) || /\b(doc-)?(note|noteref|footnote|endnote|rearnote|biblio(ref|entry)?)\b|fn\d/i.test(key)
}

const mediaTarget = (target: Element | null) => {
  if (!target || isFootnoteClick(target)) return null
  if (target.localName === 'img') return { type: 'image', el: target, image: (target as HTMLImageElement).currentSrc || (target as HTMLImageElement).src, text: (target as HTMLImageElement).alt || (target as HTMLElement).title || '图片标注' }
  const svgImage = target.localName === 'image' ? target : target.closest('image') || target.closest('svg')?.querySelector('image')
  const href = svgImage?.getAttribute('href') || svgImage?.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
  if (href) return { type: 'image', el: svgImage as Element, image: /^data:|^blob:|^[a-z]+:/i.test(href) ? href : new URL(href, target.ownerDocument.baseURI).href, text: '图片标注' }
  const table = target.localName === 'table' ? target : target.closest('table')
  return table ? { type: 'table', el: table, html: table.outerHTML, text: table.textContent?.replace(/\s+/g, ' ').trim() || '表格' } : null
}

const recoverTransformErrors = (book: any) => book?.transformTarget?.addEventListener('data', (event: Event) => {
  const { detail } = event as CustomEvent
  detail.data = Promise.resolve(detail.data).catch(e => (console.error(`Failed to load ${detail.name}:`, e), ''))
})
let openQueue = Promise.resolve()
const enqueueOpen = <T>(task: () => Promise<T>) => {
  const next = openQueue.catch(() => {}).then(task)
  openQueue = next.catch(() => {}).then(() => {})
  return next
}

const readText = (value: any): string => {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(readText).find(Boolean) || ''
  if (value && typeof value === 'object') return readText(value.label ?? value.name ?? value.value ?? value.text ?? '')
  return ''
}
const sourceNameOf = (source: File | string | any) => source instanceof File
  ? source.name
  : typeof source === 'string'
    ? source.split(/[?#]/)[0]
    : ''
const isKnownEbookSource = (source: File | string | any) => /\.(epub|mobi|azw3|azw|fb2|cbz)$/i.test(sourceNameOf(source))

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
  setAttr(renderer, 'flow', scroll ? 'scrolled' : 'paginated')
  setAttr(renderer, 'max-column-count', String(columns))
  setAttr(renderer, 'animated', '', !scroll && pageAnimation === 'slide')
  setAttr(renderer, 'gap', `${gap}%`, gap > 0)
  setAttr(renderer, 'margin', `${margin}px`, margin > 0)
  setAttr(renderer, 'max-inline-size', `${maxInlineSize}px`, maxInlineSize)
  setAttr(renderer, 'max-block-size', `${maxBlockSize}px`, maxBlockSize)
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
    foliate-view::part(container){background:transparent!important}
    foliate-view::part(filter){${filters.length ? `filter:${filters.join(' ')}` : ''}}
  `
}

function applyViewTheme(view: FoliateView, theme: any) {
  const bg = getViewBackground(theme)
  const pageBg = theme.bgImg ? 'transparent' : bg
  view.style.setProperty('--sr-epub-bg', bg)
  view.style.setProperty('--sr-epub-page-bg', pageBg)
  Object.assign(view.style, { background: bg, color: theme.color })
  Object.assign(view.renderer?.style || {}, { background: pageBg, color: theme.color })
  if (view.parentElement) view.parentElement.style.background = bg
}

async function applyCustomCSS(view: FoliateView, settings: ReaderSettings) {
  const {
    textSettings: text = { fontFamily: 'inherit', fontSize: 16, fontWeight: 400, letterSpacing: 0, customFont: { fontFamily: '', fontFile: '' } },
    paragraphSettings: paragraph = { lineHeight: 1.8, textIndent: 2, paragraphSpacing: 1 }
  } = settings
  const theme = getTheme(settings)
  const mobile = isMobile()
  const forceColor = isDark(theme.bg) ? `p,li,dd,blockquote{color:${theme.color}!important}` : ''
  const transparentContent = theme.bgImg ? 'html,body,section,article,main,div,p,blockquote,ul,ol,li,table,thead,tbody,tr,td,th{background-color:transparent!important}' : ''
  const darkText = ['#000', '#000000', 'black', 'rgb(0,0,0)', 'rgb(0, 0, 0)'].map(c => `font[color="${c}"],[style*="color:${c}"],[style*="color: ${c}"]`).join(',')
  const customFont = text.fontFamily === 'custom' ? text.customFont?.fontFamily : ''
  let font = customFont ? `"${customFont}", sans-serif` : text.fontFamily || 'inherit'
  if (font === 'inherit') {
    try {
      const bodyFont = getComputedStyle(document.body).fontFamily.trim()
      if (bodyFont && bodyFont !== 'inherit') {
        font = bodyFont
      } else {
        const siyuanFont = getComputedStyle(document.documentElement).getPropertyValue('--b3-font-family').trim()
        font = siyuanFont || 'inherit'
      }
    } catch {
      font = 'inherit'
    }
  }
  const textSettings = text as any
  if (textSettings.fontFamilyZh || textSettings.fontFamilyEn) {
    const zhFont = textSettings.fontFamilyZh || font
    const enFont = textSettings.fontFamilyEn || font
    font = `"${zhFont}", "${enFont}", ${font}`
  }
  let fontFace = ''
  if (customFont && text.customFont?.fontFile) {
    const fontUrl = `${location.origin}/plugins/custom-fonts/${encodeURI(text.customFont.fontFile)}`
    const blobUrl = await getFontBlobUrl(fontUrl)
    if (blobUrl) {
      fontFace = `@font-face{font-family:"${customFont}";src:url("${blobUrl}");font-display:swap}`
    }
  }
  const css = [
    `@namespace epub "http://www.idpf.org/2007/ops";`,
    fontFace,
    `
    html{
      background:transparent!important;
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
      background-color:transparent!important;
      color:${theme.color}!important;
      font-family:${font}!important;
      font-size:${text.fontSize}px!important;
      font-weight:${text.fontWeight}!important;
      letter-spacing:${text.letterSpacing}em!important;
      margin:0!important;
      box-sizing:border-box!important;
      scrollbar-width:none!important;
      -ms-overflow-style:none!important;
      ${mobile ? 'width:100%!important;min-width:100%!important;max-width:none!important;display:block!important;' : ''}
    }
    body::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}
    body,body>*{background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important}
    ${transparentContent}
    body,body *{font-family:${font}!important}
    p,li,dd,blockquote,span,div{font-weight:${text.fontWeight}!important}
    p:not(:has(img)),li,blockquote,dd{line-height:${paragraph.lineHeight}!important;text-align:start;text-indent:${paragraph.textIndent}em!important;margin-bottom:${paragraph.paragraphSpacing}em!important}
    img,svg,p:has(img),figure,figure *{background-color:transparent!important}
    p:has(img){text-indent:0!important;margin:0!important}
    ${forceColor}
    ${darkText}{color:${theme.color}!important}
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
    aside[epub\\:type~="footnote"],
    aside[epub\\:type~="endnote"],
    aside[epub\\:type~="rearnote"],
    section[epub\\:type~="footnote"],
    section[epub\\:type~="endnote"],
    section[epub\\:type~="rearnote"],
    [role~="doc-footnote"],
    [role~="doc-endnote"],
    [data-sr-footnote]{display:none!important}
  `
  ].join('')
  const renderer = view.renderer as any
  if (renderer?.__sireaderStyleSig !== css) {
    renderer?.setStyles?.(css)
    renderer && (renderer.__sireaderStyleSig = css)
  }
  Object.assign((view.renderer as HTMLElement | undefined)?.style || {}, { scrollbarWidth: 'none', msOverflowStyle: 'none' })
  return font
}

function getCurrentLocation(view: FoliateView): Location | null {
  try {
    const renderer = view.renderer as any
    if (renderer?.index !== undefined) return { index: renderer.index ?? 0, fraction: renderer.fraction ?? 0, cfi: view.lastLocation?.cfi }
    return view.lastLocation ? { index: view.lastLocation.index ?? 0, fraction: view.lastLocation.fraction ?? 0, cfi: view.lastLocation.cfi } : null
  } catch (error) {
    console.error('[FoliateView] Failed to get location:', error)
    return null
  }
}

const applyMarginal = (el: HTMLElement | undefined, text: string, margin = 48, fontFamily?: string) => {
  if (!el) return
  el.textContent = text
  const styles: Record<string, string> = {
    textAlign: 'start',
    fontSize: `${Math.max(0, Math.min(12, margin * 0.75))}px`,
    lineHeight: '1',
  }
  if (fontFamily) {
    styles.fontFamily = fontFamily
  }
  Object.assign(el.style, styles)
}

function updateMarginals(view: FoliateView, fontFamily?: string) {
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
  applyMarginal(head, chapter || title, margin, fontFamily)
  applyMarginal(foot, footer, margin, fontFamily)
}

function refreshMarginals(view: FoliateView, fontFamily?: string) {
  requestAnimationFrame(() => requestAnimationFrame(() => updateMarginals(view, fontFamily)))
  setTimeout(() => updateMarginals(view, fontFamily), 0)
}

function refreshRenderer(view: FoliateView, fontFamily?: string) {
  requestAnimationFrame(() => { ;(view.renderer as any)?.render?.(); refreshMarginals(view, fontFamily) })
}

export class FoliateReader {
  private view: FoliateView
  private container: HTMLElement
  private settings: ReaderSettings
  private plugin: Plugin
  private eventListeners = new Map<string, Set<Function>>()
  private themeObserver?: MutationObserver
  private resizeObserver?: ResizeObserver
  private resizeTimer: any = null
  private lastResizeWidth = 0
  private footnote = new FootnoteHandler()
  private footnoteAnchor: HTMLElement | null = null
  private footnoteHref = ''
  private epubDocs = new Set<Document>()
  private footnoteHistory: any[] = []
  private footnoteIndex = -1
  private destroyed = false
  private closeFootnote = () => document.querySelectorAll<HTMLElement>('[data-footnote-tooltip]').forEach(el => Object.assign(el.style, { display: 'none', opacity: '0', transform: 'translateY(-8px)' }))
  private closeFloaters = () => { this.closeFootnote(); this.emit('content-interaction') }
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
    this.resizeObserver = new ResizeObserver(() => this.scheduleResize())
    this.resizeObserver.observe(this.container)
    this.listenToSettingsChanges()
  }

  async open(file: File | string | any | (() => Promise<File | string | any>), format?: string) {
    await enqueueOpen(async () => {
      if (this.destroyed) return
      const input = typeof file === 'function' ? await file() : file
      const source = (isTxtSource(input) || (format === 'txt' && !isKnownEbookSource(input))) ? await createTxtBook(input) : input
      if (this.destroyed) return
      await this.view.open(source)
      if (this.destroyed) return this.view.close?.()
      recoverTransformErrors(this.view.book)
      const renderer = this.view.renderer as any
      if (renderer && !renderer.__sireaderMarginalsBound) {
        renderer.__sireaderMarginalsBound = true
        renderer.addEventListener('load', (async (event: CustomEvent) => {
          refreshMarginals(this.view)
          const doc = event.detail?.doc as Document | undefined
          if (doc?.head) {
            this.epubDocs.add(doc)
            await this.injectFontOverride(doc)
          }
        }) as EventListener)
        renderer.addEventListener('relocate', refreshMarginals.bind(null, this.view))
      }
      this.applySettings()
      await this.view.init?.({})
      await applyCustomCSS(this.view, this.settings)
      if (this.destroyed) return this.view.close?.()
      if (this.marks) await this.marks.init()
      this.emit('loaded', { book: this.view.book })
    })
  }

  private async applySettings() {
    configureView(this.view, this.settings)
    const fontFamily = await applyCustomCSS(this.view, this.settings)
    await Promise.all(Array.from(this.epubDocs).map(doc => this.injectFontOverride(doc)))
    refreshRenderer(this.view, fontFamily)
  }

  private async injectFontOverride(doc: Document) {
    if (!doc?.head) return
    let styleEl = doc.querySelector('style[data-sireader-font]')
    if (!styleEl) {
      styleEl = doc.createElement('style')
      styleEl.setAttribute('data-sireader-font', 'true')
      doc.head.appendChild(styleEl)
    }
    const { textSettings } = this.settings
    const customFont = textSettings.fontFamily === 'custom' ? textSettings.customFont?.fontFamily : ''
    let fontVal = customFont ? `"${customFont}", sans-serif` : textSettings.fontFamily || 'inherit'
    let fontFaceRules = ''
    if (customFont && textSettings.customFont?.fontFile) {
      const fontUrl = `${location.origin}/plugins/custom-fonts/${encodeURI(textSettings.customFont.fontFile)}`
      const blobUrl = await getFontBlobUrl(fontUrl)
      if (blobUrl) {
        fontFaceRules = `@font-face{font-family:"${customFont}";src:url("${blobUrl}");font-display:swap}`
      }
    }
    if (fontVal === 'inherit') {
      fontVal = getComputedStyle(document.body).fontFamily.trim() || 'inherit'
      const fontFamilies = fontVal.match(/"([^"]+)"|'([^']+)'|(\w[\w\s-]*)/g)?.map(f => f.replace(/["']/g, '').trim()).filter(Boolean) || []
      const matchFontFace = (rule: string) => {
        const match = rule.match(/font-family:\s*["']?([^"';]+)["']?/i)
        if (!match) return false
        const ruleFamily = match[1].replace(/["']/g, '').trim()
        return fontFamilies.some(f => f.toLowerCase() === ruleFamily.toLowerCase())
      }
      const inlineFontFaces = Array.from(document.querySelectorAll('style'))
        .map(el => (el as HTMLStyleElement).textContent || '')
        .join('\n')
        .match(/@font-face\s*\{[\s\S]*?\}/g) || []
        .filter(matchFontFace)
      fontFaceRules = inlineFontFaces.join('\n')
      const linkHrefs = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .map(el => (el as HTMLLinkElement).href)
        .filter(href => href && href.startsWith(location.origin))
      Promise.all(linkHrefs.map(href => fetch(href).then(r => r.text()).catch(() => '')))
        .then(cssContents => {
          const externalFontFaces = cssContents.join('\n').match(/@font-face\s*\{[\s\S]*?\}/g) || []
            .filter(matchFontFace)
          const allFontFaces = [...inlineFontFaces, ...externalFontFaces]
          const override = `${allFontFaces.join('\n')}\nhtml,body,body *{font-family:${fontVal}!important}`
          if (styleEl!.textContent !== override) {
            styleEl!.textContent = override
          }
        })
    }
    const textSettingsAny = textSettings as any
    if (textSettingsAny.fontFamilyZh || textSettingsAny.fontFamilyEn) {
      const zhFont = textSettingsAny.fontFamilyZh || fontVal
      const enFont = textSettingsAny.fontFamilyEn || fontVal
      fontVal = `"${zhFont}", "${enFont}", ${fontVal}`
    }
    const fontOverride = `${fontFaceRules}\nhtml,body,body *{font-family:${fontVal}!important}`
    if (styleEl.textContent !== fontOverride) {
      styleEl.textContent = fontOverride
    }
  }

  private scheduleResize() {
    const width = Math.round(this.container.clientWidth)
    if (!width || Math.abs(width - this.lastResizeWidth) < 4) return
    this.lastResizeWidth = width
    this.resize(180)
  }

  resize = (delay = 60) => {
    if (!this.container.isConnected) return
    clearTimeout(this.resizeTimer)
    this.resizeTimer = setTimeout(() => this.applySettings(), delay)
  }

  private handleLoad(detail: any) { normalizeFootnoteTypes(detail?.doc); refreshMarginals(this.view); this.bindContentMedia(detail?.doc, detail?.index); this.emit('load', detail) }

  private cfiFor(doc: Document, index: number | undefined, node: Node) {
    try { const range = doc.createRange(); range.selectNode(node); return index !== undefined ? (this.view as any).getCFI(index, range) : '' } catch { return '' }
  }

  private bindContentMedia(doc?: Document, index?: number) {
    if (!doc) return
    doc.querySelectorAll('img').forEach((img: HTMLImageElement) => { img.onerror = () => { img.style.display = 'none' } })
    if ((doc as any).__sireaderImageMenu) return
    ;(doc as any).__sireaderImageMenu = true
    const emitMedia = (event: MouseEvent, media: any, name: string) => {
      const rect = (doc.defaultView?.frameElement as HTMLIFrameElement | null)?.getBoundingClientRect()
      this.emit(name, { item: { id: '', type: 'note', format: 'epub', cfi: this.cfiFor(doc, index, media.el), text: media.text, image: media.image, html: media.html, chapter: this.view.lastLocation?.tocItem?.label || '' }, x: event.clientX + (rect?.left || 0), y: event.clientY + (rect?.top || 0) })
    }
    const openMenu = (event: MouseEvent) => {
      const media = mediaTarget(event.target as Element | null)
      if (!media) return false
      this.closeFloaters()
      event.preventDefault(); event.stopPropagation()
      emitMedia(event, media, media.type === 'table' ? 'table-menu' : 'image-menu')
      return true
    }
    doc.addEventListener('contextmenu', openMenu as EventListener)
    doc.addEventListener('click', ((event: MouseEvent) => {
      const target = event.target as Element | null
      const note = inlineFootnote(target)
      if (note) return event.preventDefault(), event.stopPropagation(), this.renderInlineFootnote(note.el, note.text)
      const media = mediaTarget(target)
      if (!media) return target?.closest?.('a[href]') ? undefined : this.closeFloaters()
      this.closeFloaters()
      event.preventDefault(); event.stopPropagation()
      emitMedia(event, media, media.type === 'table' ? 'table-open' : 'image-open')
    }) as EventListener)
  }

  private setupEventListeners() {
    this.footnote.addEventListener('before-render', ((e: CustomEvent) => {
      const view = e.detail.view as FoliateView
      view.style.cssText = 'display:block;width:100%;height:min(360px,calc(100vh - 120px))'
      view.addEventListener('link', ((event: CustomEvent) => {
        event.preventDefault()
        let id = this.footnoteHref.split('#')[1]
        try { id = id && decodeURIComponent(id) } catch {}
        if (id && event.detail.a?.id === id) return
        const detail = { ...event.detail, follow: true }
        this.footnoteHistory = [...this.footnoteHistory.slice(0, this.footnoteIndex + 1), detail]
        this.footnoteIndex = this.footnoteHistory.length - 1
        this.footnote.handle(this.view.book, { detail, preventDefault: () => event.preventDefault() } as any)?.catch(() => this.view.goTo(detail.href))
      }) as EventListener)
      view.addEventListener('load', ((event: CustomEvent) => normalizeFootnoteTypes(event.detail?.doc)) as EventListener)
      view.renderer?.setAttribute?.('flow', 'scrolled')
      view.renderer?.setAttribute?.('no-background', '')
      view.renderer?.setStyles?.('body{padding:14px!important;font-size:13px!important;line-height:1.7!important;color:var(--b3-theme-on-surface)!important;background:var(--b3-theme-surface)!important}a{color:var(--b3-theme-primary)!important}')
    }) as EventListener)
    this.footnote.addEventListener('render', ((e: CustomEvent) => this.renderFootnote(e.detail)) as EventListener)
    this.view.addEventListener('relocate', ((e: CustomEvent) => {
      refreshMarginals(this.view)
      this.emit('relocate', e.detail)
    }) as EventListener)
    this.view.addEventListener('load', ((e: CustomEvent) => this.handleLoad(e.detail)) as EventListener)
    this.view.addEventListener('external-link', ((e: CustomEvent) => this.emit('external-link', e.detail)) as EventListener)

    this.view.addEventListener('link', ((e: CustomEvent) => {
      const { a, href } = e.detail
      if (!a || !href) return this.emit('link', e.detail)
      this.closeFloaters()
      this.footnoteAnchor = a
      this.footnoteHistory = [e.detail]
      this.footnoteIndex = 0
      // 同文档脚注引用：直接从当前文档提取脚注内容，绕过 book.resolveHref / #showFragment 链路
      // 规避 foliate-js 在解析同文档链接时可能返回 null 导致弹窗失败的问题
      const rawHref = a.getAttribute('href') || ''
      const hashIdx = rawHref.indexOf('#')
      if (hashIdx >= 0) {
        const id = rawHref.slice(hashIdx + 1)
        const doc = a.ownerDocument
        try {
          const target = doc?.getElementById(id)
          if (target && target.hasAttribute('data-sr-footnote')) {
            e.preventDefault()
            this.renderSameDocFootnote(a, target)
            return
          }
        } catch {}
      }
      if (footnoteLinkClasses.some(cls => a.classList.contains(cls))) e.detail.follow = true
      if (shouldCheckAsFootnote(a)) e.detail.check = true
      const handled = this.footnote.handle(this.view.book, e as any)
      if (handled) return handled.catch(() => this.emit('link', e.detail))
      this.emit('link', e.detail)
    }) as EventListener)
  }

  private getFootnoteTooltip() {
    let tooltip = document.querySelector('[data-footnote-tooltip]') as HTMLDivElement | null
    if (tooltip) return tooltip
    tooltip = document.createElement('div')
    tooltip.setAttribute('data-footnote-tooltip', '')
    tooltip.style.cssText = 'position:fixed;display:none;width:min(360px,calc(100vw - 20px));background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:99999;pointer-events:auto;overflow:hidden;transition:all .2s'
    document.body.appendChild(tooltip)
    return tooltip
  }

  private renderInlineFootnote(el: HTMLElement, text: string) {
    const tooltip = this.getFootnoteTooltip()
    const i = this.plugin.i18n
    tooltip.innerHTML = createTooltip({ icon: '#iconMark', iconColor: '#ef4444', title: i.footnote || '脚注', content: '<div data-footnote-content style="max-height:min(360px,calc(100vh - 120px));overflow:auto;user-select:text;padding:14px;font-size:13px;line-height:1.7;white-space:pre-wrap"></div>' })
    tooltip.querySelector('[data-footnote-content]')!.textContent = text
    const rect = el.getBoundingClientRect()
    const frameRect = (el.ownerDocument.defaultView?.frameElement as HTMLIFrameElement | null)?.getBoundingClientRect()
    showTooltip(tooltip, (frameRect?.left || 0) + rect.left, (frameRect?.top || 0) + rect.bottom + 8)
  }

  private renderSameDocFootnote(anchor: HTMLElement, target: Element) {
    const tooltip = this.getFootnoteTooltip()
    const i = this.plugin.i18n
    tooltip.innerHTML = createTooltip({ icon: '#iconMark', iconColor: '#ef4444', title: i.footnote || '脚注', content: '<div data-footnote-content style="max-height:min(360px,calc(100vh - 120px));overflow:auto;user-select:text;padding:14px;font-size:13px;line-height:1.7"></div>' })
    const content = tooltip.querySelector('[data-footnote-content]')!
    content.innerHTML = target.innerHTML
    const rect = anchor.getBoundingClientRect()
    const frameRect = (anchor.ownerDocument.defaultView?.frameElement as HTMLIFrameElement | null)?.getBoundingClientRect()
    showTooltip(tooltip, (frameRect?.left || 0) + rect.left, (frameRect?.top || 0) + rect.bottom + 8)
  }

  private renderFootnote({ view, href, type, target }: any) {
    const a = this.footnoteAnchor
    if (!a) return
    this.footnoteHref = href || ''
    const tooltip = this.getFootnoteTooltip()
    const i = this.plugin.i18n
    const title = type === 'endnote' ? i.endnote || '尾注' : type === 'biblioentry' ? i.reference || '参考' : type === 'definition' ? i.glossary || '术语' : i.footnote || '脚注'
    tooltip.innerHTML = createTooltip({ icon: '#iconMark', iconColor: '#ef4444', title: `${title} (${i.clickToJump || '点击跳转'})`, content: `${this.footnoteIndex > 0 ? '<button data-footnote-back style="margin:8px 0 0 8px;padding:4px 8px;border:1px solid var(--b3-border-color);border-radius:6px;background:var(--b3-theme-background);color:var(--b3-theme-on-surface);cursor:pointer">←</button>' : ''}<div data-footnote-content style="height:min(360px,calc(100vh - 120px));overflow:auto;user-select:text"></div>`, id: target?.id ? `#${target.id}` : '' })
    tooltip.querySelector('[data-footnote-content]')?.replaceChildren(view)
    tooltip.querySelector('[data-footnote-back]')?.addEventListener('click', () => {
      const detail = this.footnoteHistory[--this.footnoteIndex]
      detail && this.footnote.handle(this.view.book, { detail: { ...detail, follow: true }, preventDefault: () => {} } as any)
    })
    const header = tooltip.firstElementChild as HTMLElement | null
    if (header) {
      header.style.cursor = 'pointer'
      header.onclick = () => { hideTooltip(tooltip!, 0); this.goTo(href).catch(() => {}) }
    }
    const rect = a.getBoundingClientRect()
    const frameRect = (a.ownerDocument.defaultView?.frameElement as HTMLIFrameElement | null)?.getBoundingClientRect()
    const x = (frameRect?.left || 0) + rect.left, y = (frameRect?.top || 0) + rect.bottom + 8
    let timer: any
    showTooltip(tooltip, x, y)
    a.onmouseenter = () => { clearTimeout(timer); showTooltip(tooltip!, x, y) }
    a.onmouseleave = () => { timer = setTimeout(() => hideTooltip(tooltip!), 100) }
    tooltip.onmouseenter = () => clearTimeout(timer)
    tooltip.onmouseleave = () => hideTooltip(tooltip)
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
    this.destroyed = true
    await this.marks?.destroy()
    this.themeObserver?.disconnect()
    this.resizeObserver?.disconnect()
    clearTimeout(this.resizeTimer)
    this.eventListeners.clear()
    this.view.close?.()
    this.view.book?.destroy?.()
    try { this.view.remove() } catch {}
  }
}

export function createReader(options: ReaderOptions): FoliateReader {
  return new FoliateReader(options)
}
