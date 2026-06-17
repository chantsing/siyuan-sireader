/**
 * PDF渲染器 - 基于PDF.js懒加载优化
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PDFViewerOptions, PDFLocation } from './types'
import { markRaw } from 'vue'
import { PRESET_THEMES } from '@/composables/useSetting'

// 动态加载思源内置PDF.js
let pdfjsLib: any = null
const PDF_RUNTIME_PATH = '/stage/protyle/js/pdf/pdf.min.mjs'
const PDF_WORKER_PATH = '/stage/protyle/js/pdf/pdf.worker.min.mjs'
const requestIdle = (cb: () => void) => (window.requestIdleCallback || window.requestAnimationFrame)(cb)
const loadPDFJS = async () => {
  if (pdfjsLib) return pdfjsLib
  pdfjsLib = await import(PDF_RUNTIME_PATH)
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_PATH
  return pdfjsLib
}

// 工具函数
const resolveColor = (c: string) => c.startsWith('var(') ? getComputedStyle(document.documentElement).getPropertyValue(c.slice(4, -1)).trim() : c
const resolveTheme = (t: any) => ({ ...t, bg: resolveColor(t.bg), color: resolveColor(t.color) })
const watchTheme = (cb: () => void) => {
  let raf = 0
  const observer = new MutationObserver(() => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(cb)
  })
  observer.observe(document.documentElement, { attributeFilter: ['data-theme-mode', 'class'] })
  return observer
}
const isDarkBg = (bg: string) => { const h = bg?.replace('#', '') || '0'; return parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16) < 0x808080 }
const parseRgb = (c: string) => { const t = document.createElement('div'); t.style.color = c; document.body.appendChild(t); const rgb = getComputedStyle(t).color.match(/\d+/g)!.map(Number); document.body.removeChild(t); return rgb }
const getThemeSignature = (settings: any) => {
  const th = resolveTheme(settings.theme === 'custom' ? settings.customTheme : PRESET_THEMES[settings.theme] || PRESET_THEMES.default)
  const { visualSettings: v = {} } = settings
  const filter = [v.brightness !== 1 && `brightness(${v.brightness})`, v.contrast !== 1 && `contrast(${v.contrast})`, v.sepia > 0 && `sepia(${v.sepia})`, v.saturate !== 1 && `saturate(${v.saturate})`, (v.invert || isDarkBg(th.bg)) && 'invert(1) hue-rotate(180deg)'].filter(Boolean).join(' ') || 'none'
  return { th, filter, signature: `${th.bg}|${th.color}|${filter}` }
}

export class PDFViewer {
  private pdf: PDFDocumentProxy | null = null
  private container: HTMLElement
  private scale = 1.0
  private autoScaleMode: 'custom' | 'fit-width' = 'custom'
  private rotation = 0
  private pages = markRaw(new Map<number, any>())
  private rendered = new Set<number>()
  private current = 1
  private onChange?: (page: number) => void
  private pageReadyListeners = new Set<(page: number) => void>()
  private observer?: IntersectionObserver
  private renderQueue: number[] = []
  private rendering = false
  private themeSettings: any = null
  private themeObserver?: MutationObserver
  private resizeObserver?: ResizeObserver
  private resizeTimer: any = null
  private lastResizeWidth = 0
  private renderVersion = 0
  private themeSignature = ''
  private wheelZoomTimer: any = null

  constructor(opt: PDFViewerOptions) {
    this.container = opt.container
    this.scale = opt.scale || 1.0
    this.onChange = opt.onPageChange
    this.setupResizeObserver()
    this.container.addEventListener('wheel', this.handleWheelZoom, { passive: false })
  }

  // 应用主题
  applyTheme(settings: any) {
    this.themeSettings = settings
    const { th, filter, signature } = getThemeSignature(settings)
    if (!th) return
    const s = this.container.style, img = th.bgImg, fixUrl = (u: string) => u.startsWith('http') || u.startsWith('/') ? u : `/${u}`
    Object.assign(s, { color: th.color, backgroundColor: img ? 'transparent' : th.bg, backgroundImage: img ? `url("${fixUrl(img)}")` : '', backgroundSize: img ? 'cover' : '', backgroundPosition: img ? 'center' : '', backgroundRepeat: img ? 'no-repeat' : '' })
    s.setProperty('--page-bg-color', th.bg)
    s.setProperty('--pdf-canvas-filter', filter)
    this.themeSignature = signature
    this.container.querySelectorAll('.pdf-page canvas').forEach((c: any) => c.style.filter = filter)
    if (settings.theme === 'auto') {
      this.themeObserver ||= watchTheme(() => this.updateTheme(this.themeSettings))
    } else if (this.themeObserver) {
      this.themeObserver.disconnect()
      this.themeObserver = undefined
    }
  }

  // 打开PDF文档
  async open(src: string | ArrayBuffer) {
    const pdfjs = await loadPDFJS()
    this.pdf = markRaw(await pdfjs.getDocument({
      ...(typeof src === 'string' ? { url: src } : { data: src }),
      cMapUrl: '/stage/protyle/js/pdf/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/stage/protyle/js/pdf/standard_fonts/',
      useSystemFonts: false,
      disableFontFace: false,
      isEvalSupported: false,
      maxImageSize: -1
    }).promise) as any
    this.pages.set(1, markRaw(await this.pdf.getPage(1)))
    await this.fitWidth()
    this.setupScroll()
  }

  // 创建页面占位符
  private async createPlaceholders() {
    if (!this.pdf) return
    const n = this.pdf.numPages
    this.container.innerHTML = ''
    Object.assign(this.container.style, { display: 'block' })
    const frag = document.createDocumentFragment(), firstPage = this.pages.get(1) || await this.pdf.getPage(1), vp = firstPage.getViewport({ scale: this.scale, rotation: this.rotation })
    for (let i = 1; i <= n; i++) {
      const d = document.createElement('div')
      d.className = 'pdf-page', d.dataset.page = String(i)
      d.style.cssText = `position:relative;margin:20px auto;width:${vp.width}px;height:${vp.height}px;--scale-factor:${vp.scale};box-shadow:0 2px 8px #0003;user-select:text;-webkit-user-select:text`
      frag.appendChild(d)
    }
    this.container.appendChild(frag)
  }

  // 设置懒加载
  private setupLazyLoad() {
    this.observer = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { const n = +(e.target as HTMLElement).dataset.page!; n && !this.rendered.has(n) && this.queueRender(n) } }), { rootMargin: '300px' })
    this.container.querySelectorAll('.pdf-page').forEach(el => this.observer!.observe(el))
  }

  // 渲染队列
  private queueRender(n: number) { if (!this.renderQueue.includes(n)) this.renderQueue.push(n), this.processQueue() }
  private async processQueue() { if (this.rendering || !this.renderQueue.length) return; this.rendering = true; await this.renderPage(this.renderQueue.shift()!); this.rendering = false; this.processQueue() }
  private emitPageReady(page: number) { this.pageReadyListeners.forEach(listener => listener(page)) }
  onPageReady(listener: (page: number) => void) {
    this.pageReadyListeners.add(listener)
    return () => this.pageReadyListeners.delete(listener)
  }
  getRenderedPages = () => Array.from(this.rendered).sort((a, b) => a - b)
  refreshRenderedPages(pages = this.getRenderedPages()) { pages.forEach(page => this.emitPageReady(page)) }
  private async rerenderLayout(after?: () => Promise<void> | void) {
    const currentPage = this.current
    this.renderVersion++
    this.rendered.clear()
    this.observer?.disconnect()
    this.observer = undefined
    await this.createPlaceholders()
    this.setupLazyLoad()
    await after?.()
    this.goToPage(Math.min(currentPage, this.pdf?.numPages || currentPage))
    this.primeVisiblePages()
  }

  private primeVisiblePages() {
    const pages = [this.current, this.current - 1, this.current + 1, this.current + 2]
      .filter(page => page > 0 && page <= (this.pdf?.numPages || 0))
    pages.forEach(page => this.queueRender(page))
  }

  private setupResizeObserver() {
    if (typeof ResizeObserver === 'undefined') return
    this.resizeObserver = new ResizeObserver(() => {
      if (this.autoScaleMode !== 'fit-width') return
      const width = Math.round(this.container.clientWidth)
      if (!width || Math.abs(width - this.lastResizeWidth) < 4) return
      this.lastResizeWidth = width
      this.resize(180)
    })
    this.resizeObserver.observe(this.container)
  }

  private async handleContainerResize() {
    if (!this.pdf || !this.container.isConnected) return
    if (this.autoScaleMode === 'fit-width') {
      await this.fitWidth()
      return
    }
    this.refreshRenderedPages()
  }

  resize = (delay = 60) => {
    if (!this.container.isConnected) return
    clearTimeout(this.resizeTimer)
    this.resizeTimer = setTimeout(() => { void this.handleContainerResize() }, delay)
  }

  // 渲染页面
  private async renderPage(n: number) {
    const w = this.container.querySelector(`[data-page="${n}"]`) as HTMLElement
    if (!w || this.rendered.has(n)) return
    this.rendered.add(n), w.setAttribute('data-page-number', String(n)), w.classList.add('page')
    const ver = this.renderVersion
    let p = this.pages.get(n)
    if (!p && this.pdf) p = markRaw(await this.pdf.getPage(n)), this.pages.set(n, p)
    if (!p) return
    const pdfjs = await loadPDFJS(), vp = p.getViewport({ scale: this.scale, rotation: this.rotation }), dpr = window.devicePixelRatio || 1
    const { visualSettings: v = {} } = this.themeSettings || {}, bg = this.container.style.getPropertyValue('--page-bg-color') || '#fff'
    const dark = v.invert || isDarkBg(bg)
    const filters = [v.brightness !== 1 && `brightness(${v.brightness})`, v.contrast !== 1 && `contrast(${v.contrast})`, v.sepia > 0 && `sepia(${v.sepia})`, v.saturate !== 1 && `saturate(${v.saturate})`, dark && 'invert(1) hue-rotate(180deg)'].filter(Boolean).join(' ')
    w.style.width = `${vp.width}px`
    w.style.height = `${vp.height}px`
    w.style.setProperty('--scale-factor', String(vp.scale))
    
    try {
      const c = document.createElement('canvas'), ctx = c.getContext('2d', { alpha: false })!
      c.width = Math.floor(vp.width * dpr), c.height = Math.floor(vp.height * dpr)
      await p.render({ canvasContext: ctx, viewport: vp, transform: [dpr, 0, 0, dpr, 0, 0], enableWebGL: true }).promise
      
      if (!dark && bg !== '#fff' && bg !== '#ffffff') {
        const d = ctx.getImageData(0, 0, c.width, c.height).data, [r, g, b] = parseRgb(bg)
        for (let i = 0; i < d.length; i += 4) if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) d[i] = r, d[i + 1] = g, d[i + 2] = b
        ctx.putImageData(new ImageData(d, c.width, c.height), 0, 0)
      }
      
      if (ver !== this.renderVersion) return
      c.style.cssText = `width:${vp.width}px;height:${vp.height}px${filters ? `;filter:${filters}` : ''}`, w.appendChild(c)
    } catch (e: any) { console.error(`[PDF] 渲染失败 ${n}:`, e); w.style.background = '#fee'; w.innerHTML = `<div style="padding:20px;color:#c00">渲染失败</div>`; return }
    
    requestIdle(() => this.renderTextLayer(w, p, vp, pdfjs, ver))
    requestIdle(async () => {
      if (ver !== this.renderVersion || !w.isConnected) return
      const ann = document.createElement('div')
      ann.className = 'pdf-annotation-layer', ann.style.cssText = 'position:absolute;inset:0;pointer-events:none', w.appendChild(ann)
      await this.renderLinks(n, w, p, vp), this.createInkLayer(n, w, vp)
      requestAnimationFrame(() => { if (ver === this.renderVersion && w.isConnected) this.emitPageReady(n) })
    })
  }

  // 渲染文本层
  private async renderTextLayer(w: HTMLElement, p: any, vp: any, pdfjs: any, ver: number) {
    if (ver !== this.renderVersion || !w.isConnected) return
    const d = document.createElement('div')
    d.className = 'textLayer'
    d.style.cssText = 'position:absolute;inset:0;line-height:1;user-select:text;-webkit-user-select:text'
    w.appendChild(d)
    const finish = () => requestAnimationFrame(() => { if (ver === this.renderVersion && d.isConnected) import('./annotation').then(({ initTextLayerOptimization }) => initTextLayerOptimization(d)) })
    try {
      if (!pdfjs.TextLayer) return
      const layer = new pdfjs.TextLayer({
        textContentSource: p.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
        container: d,
        viewport: vp,
      })
      await layer.render()
      if (d.querySelector('span')) finish()
    } catch {}
  }

  // 创建墨迹层
  private createInkLayer(pageNum: number, pageEl: HTMLElement, vp: any) {
    ['pdf-ink-layer', 'pdf-shape-layer'].forEach((cls, i) => {
      const c = document.createElement('canvas')
      c.className = cls, c.dataset.page = String(pageNum), c.width = vp.width, c.height = vp.height
      c.style.cssText = `position:absolute;inset:0;width:${vp.width}px;height:${vp.height}px;z-index:${10 + i};pointer-events:none`
      pageEl.appendChild(c)
    })
  }

  // 渲染链接
  private async renderLinks(_n: number, w: HTMLElement, p: any, vp: any) {
    try {
      const pdfjs = await loadPDFJS()
      const anns = await p.getAnnotations()
      const layer = document.createElement('div')
      layer.className = 'annotationLayer'
      layer.style.cssText = 'position:absolute;inset:0;z-index:10;pointer-events:none'
      for (const a of anns) {
        if (a.subtype !== 'Link') continue
        const link = document.createElement('a')
        const [x1, y1, x2, y2] = pdfjs.Util.normalizeRect(a.rect)
        const [p1, p2] = [vp.convertToViewportPoint(x1, y1), vp.convertToViewportPoint(x2, y2)]
        link.style.cssText = `position:absolute;left:${Math.min(p1[0], p2[0])}px;top:${Math.min(p1[1], p2[1])}px;width:${Math.abs(p2[0] - p1[0])}px;height:${Math.abs(p2[1] - p1[1])}px;cursor:pointer;pointer-events:auto`
        if (a.url) { link.href = a.url; link.target = '_blank' }
        else if (a.dest) {
          link.href = '#'
          link.onclick = async (e) => {
            e.preventDefault()
            const d = typeof a.dest === 'string' ? await this.pdf!.getDestination(a.dest) : a.dest
            if (d?.[0]) { const i = await this.pdf!.getPageIndex(d[0]); this.goToPage(i + 1) }
          }
        }
        layer.appendChild(link)
      }
      w.appendChild(layer)
    } catch {}
  }

  // 滚动监听
  private setupScroll() { 
    let t: any
    this.container.addEventListener('scroll', () => { 
      clearTimeout(t), t = setTimeout(() => { 
        const p = this.getCurrentPage()
        p !== this.current && (this.current = p, this.onChange?.(p), this.cleanupDistantPages())
      }, 100) 
    }) 
  }
  
  // 清理远距离页面
  private cleanupDistantPages() { 
    this.rendered.forEach(n => { 
      if (Math.abs(n - this.current) > 5) { 
        const el = this.container.querySelector(`[data-page="${n}"]`) as HTMLElement
        el && (el.innerHTML = ''), this.rendered.delete(n)
      } 
    }) 
  }

  // 页面导航
  getCurrentPage() { 
    const total = this.pdf?.numPages || 1, fallback = Math.min(Math.max(this.current || 1, 1), total)
    if (!this.container.isConnected || !this.container.clientHeight) return fallback
    const s = this.container.scrollTop + this.container.clientHeight / 2, ps = this.container.querySelectorAll('.pdf-page')
    if (!ps.length) return fallback
    for (let i = 0; i < ps.length; i++) if ((ps[i] as HTMLElement).offsetTop + (ps[i] as HTMLElement).offsetHeight > s) return i + 1
    return total 
  }
  
  getLocation(): PDFLocation { 
    const p = this.getCurrentPage(), t = this.pdf?.numPages || 1
    return { page: p, total: t, fraction: (p - 1) / t, scrollTop: this.container.scrollTop } 
  }
  
  goToPage(p: number) { 
    const el = this.container.querySelector(`[data-page="${p}"]`) as HTMLElement
    if (!el) return
    this.container.scrollTop = el.offsetTop, this.current = p, this.onChange?.(p)
    this.renderQueue = [p, ...Array.from({ length: 3 }, (_, i) => [p - 1 + i, p + 1 + i]).flat().filter(i => i > 0 && i <= this.pdf?.numPages && i !== p && !this.rendered.has(i))], this.processQueue()
  }

  // 缩放和视图
  private async applyScale(scale: number, mode: 'custom' | 'fit-width') {
    this.autoScaleMode = mode
    this.scale = Math.max(.25, scale)
    await this.rerenderLayout()
    this.container.dispatchEvent(new CustomEvent('pdf-scale-change', { detail: { scale: this.scale, mode } }))
  }
  async setScale(s: number) { await this.applyScale(s, 'custom') }
  async fitWidth() { const p = this.pages.get(1); if (p) { this.lastResizeWidth = Math.round(this.container.clientWidth); await this.applyScale((this.container.clientWidth - 40) / p.getViewport({ scale: 1 }).width, 'fit-width') } }
  async setRotation(d: 0 | 90 | 180 | 270) { this.rotation = d; await this.rerenderLayout() }
  private handleWheelZoom = (e: WheelEvent) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    clearTimeout(this.wheelZoomTimer)
    const next = this.scale * (e.deltaY < 0 ? 1.1 : 0.9)
    this.wheelZoomTimer = setTimeout(() => { void this.setScale(next) }, 20)
  }

  // Getters
  getScale = () => this.scale
  getRotation = () => this.rotation
  getPDF = () => this.pdf
  getPages = () => this.pages
  getPageCount = () => this.pdf?.numPages || 0

  // 更新主题
  async updateTheme(settings: any) {
    if (getThemeSignature(settings).signature === this.themeSignature) return
    this.renderVersion++
    this.applyTheme(settings)
    const pages = Array.from(this.rendered)
    this.rendered.clear()
    for (const n of pages) { 
      const w = this.container.querySelector(`[data-page="${n}"]`) as HTMLElement
      if (w) w.innerHTML = ''
      await this.renderPage(n) 
    }
  }

  // 缩略图
  async getThumbnail(n: number, s = .2) { 
    try { 
      let p = this.pages.get(n)
      if (!p && this.pdf) { p = markRaw(await this.pdf.getPage(n)); this.pages.set(n, p) }
      if (!p) return ''
      const vp = p.getViewport({ scale: s }), c = document.createElement('canvas'), ctx = c.getContext('2d')
      if (!ctx) return ''
      c.width = vp.width
      c.height = vp.height
      await p.render({ canvasContext: ctx, viewport: vp, canvas: c }).promise
      return c.toDataURL('image/jpeg', .8) 
    } catch { return '' } 
  }

  // 目录
  async getOutline() { 
    if (!this.pdf) return []
    try { 
      const ol = await this.pdf.getOutline() || []
      const flat = (its: any[], lv = 0): any[] => its.flatMap(it => [{ title: it.title, dest: it.dest, level: lv }, ...(it.items ? flat(it.items, lv + 1) : [])])
      return Promise.all(flat(ol).map(async it => { 
        let pn = 1
        if (it.dest) try { 
          const d = typeof it.dest === 'string' ? await this.pdf!.getDestination(it.dest) : it.dest
          if (d) pn = await this.pdf!.getPageIndex(d[0]) + 1 
        } catch {}
        return { title: it.title, pageNumber: pn, level: it.level } 
      })) 
    } catch { return [] } 
  }
  
  private buildTocTree(flat: any[]) { 
    if (!flat.length) return []
    const root: any[] = [], stack: any[] = []
    for (const item of flat) { 
      const node = { label: item.title, href: `#page-${item.pageNumber}`, pageNumber: item.pageNumber, subitems: [] }
      while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop()
      if (!stack.length) root.push(node)
      else stack[stack.length - 1].node.subitems.push(node)
      stack.push({ level: item.level, node }) 
    }
    const clean = (items: any[]) => items.map(it => ({ ...it, subitems: it.subitems?.length ? clean(it.subitems) : undefined }))
    return clean(root) 
  }
  
  private buildTocWithPath(flat: any[]) {
    return flat.map((item, idx) => {
      const ancestors: string[] = []
      let lv = item.level
      for (let i = idx - 1; i >= 0; i--) {
        if (flat[i].level < lv) {
          ancestors.unshift(flat[i].title)
          lv = flat[i].level
          if (lv === 0) break
        }
      }
      return { ...item, fullPath: [...ancestors, item.title].join(' - ') }
    })
  }

  // 销毁
  destroy() { 
    this.container.removeEventListener('wheel', this.handleWheelZoom)
    this.observer?.disconnect()
    this.themeObserver?.disconnect()
    this.resizeObserver?.disconnect()
    clearTimeout(this.resizeTimer)
    clearTimeout(this.wheelZoomTimer)
    this.pageReadyListeners.clear()
    this.pdf?.destroy()
    this.pages.clear()
    this.rendered.clear()
    this.container.innerHTML = '' 
  }

  // 创建视图
  async createView() {
    const n = this.getPageCount()
    const behavior = this.themeSettings?.pageAnimation === 'none' ? 'auto' : 'smooth'
    const nav = (d: number) => this.container.scrollBy({ top: d * this.container.clientHeight * 0.9, behavior })
    const prev = () => nav(-1), next = () => nav(1)
    const thumbs: string[] = [], outline = await this.getOutline()
    
    return {
      viewer: this, isPdf: true, pageCount: n,
      getThumbnail: async (p: number) => thumbs[p - 1] || (thumbs[p - 1] = await this.getThumbnail(p).catch(() => '')),
      book: { toc: this.buildTocTree(outline), flatToc: this.buildTocWithPath(outline) },
      goTo: (t: any) => this.goToPage(typeof t === 'number' ? t : t?.pageNumber || +(String(t).replace('#page-', ''))),
      lastLocation: { page: 1, total: n },
      nav: { prev, next, goLeft: prev, goRight: next }
    }
  }
}
