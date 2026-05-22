/**
 * PDF shape annotations.
 */
import type { Annotation } from '../database'
import { listAnnotations, removeAnnotation, replaceAnnotationsByType } from '../MarkManager'
import { compactNumber, compactRect, getCanvasPoint, getPdfLayerCanvas, getPdfPageCanvas, getPdfViewport, getRectBox, pdfRectToScreenRect, redrawPdfLayerPage, screenDeltaToPdfDelta, screenRectToPdfRect, setPdfLayerInteractivity } from './annotation'

export type ShapeType = 'rect' | 'circle' | 'triangle' | 'textbox'

export interface ShapeAnnotation {
  id: string
  type: 'shape'
  shapeType: ShapeType
  page: number
  rect: [number, number, number, number]
  color: string
  width: number
  opacity: number
  filled?: boolean
  text?: string
  note?: string
  timestamp: number
  chapter?: string
  blockId?: string
  customOrder?: number
}

export interface ShapeConfig {
  shapeType: ShapeType
  color: string
  width: number
  opacity: number
  filled: boolean
}

export const PDF_SHAPE_OPTIONS = [
  { type: 'rect', label: '矩形', icon: '#iconSquareDashed' },
  { type: 'circle', label: '圆形', icon: '#iconCircleDashed' },
  { type: 'triangle', label: '三角形', icon: '#iconTriangleDashed' },
  { type: 'textbox', label: '文本框', icon: '#lucide-file-text' }
] as const satisfies ReadonlyArray<{ type: ShapeType; label: string; icon: string }>
export const PDF_SHAPE_COLORS = ['#ff0000', '#00aa00', '#0066ff', '#ffb000', '#ff00ff', '#00bcd4', '#000000'] as const

const TEXTBOX_PLACEHOLDER = '文本框'
const getTextboxText = (shape: ShapeAnnotation) => shape.text?.trim() || TEXTBOX_PLACEHOLDER
const getTextboxFontSize = (shape: ShapeAnnotation) => Math.max(14, Math.min(48, Math.round((shape.width || 2) * 4 + 8)))
const getTextboxLines = (shape: ShapeAnnotation) => getTextboxText(shape).split(/\n/).map(line => line || ' ')

const getTextboxMetrics = (ctx: CanvasRenderingContext2D, shape: ShapeAnnotation) => {
  const fontSize = getTextboxFontSize(shape)
  const lineHeight = Math.round(fontSize * 1.45)
  const lines = getTextboxLines(shape)
  ctx.save()
  ctx.font = `${fontSize}px sans-serif`
  const width = Math.max(...lines.map(line => ctx.measureText(line).width), fontSize)
  ctx.restore()
  return { fontSize, lineHeight, lines, width: Math.ceil(width), height: lineHeight * lines.length }
}

const getTextboxBounds = (ctx: CanvasRenderingContext2D, shape: ShapeAnnotation, x: number, y: number) => {
  const pad = 6
  const metrics = getTextboxMetrics(ctx, shape)
  return { x: x - pad, y: y - pad, w: metrics.width + pad * 2, h: metrics.height + pad * 2 }
}

const drawTextbox = (ctx: CanvasRenderingContext2D, shape: ShapeAnnotation, x: number, y: number) => {
  const { fontSize, lineHeight, lines } = getTextboxMetrics(ctx, shape)
  ctx.save()
  ctx.font = `${fontSize}px sans-serif`
  ctx.fillStyle = shape.color || '#ff0000'
  ctx.textBaseline = 'top'
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight))
  ctx.restore()
}

export const drawShape = (
  canvas: HTMLCanvasElement,
  shape: ShapeAnnotation,
  activeView: any,
  shapeCache: Map<string, string>,
  preloadPage: (page: number) => void,
  retry = 0,
  highRes = false
) => {
  if (!shape) return
  const ctx = canvas.getContext('2d')!
  const key = `${shape.id}_${shape.shapeType}${highRes ? '_hd' : ''}`
  if (shapeCache.has(key)) {
    const img = new Image()
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    img.src = shapeCache.get(key)!
    return
  }

  const pdfCanvas = getPdfPageCanvas(shape.page)
  if (!pdfCanvas) {
    if (retry < 3) {
      preloadPage(shape.page)
      setTimeout(() => drawShape(canvas, shape, activeView, shapeCache, preloadPage, retry + 1, highRes), 200)
    }
    return
  }

  const viewer = activeView?.viewer
  const viewport = getPdfViewport(viewer, shape.page)
  if (!viewport) return

  const [vx1, vy1, vx2, vy2] = pdfRectToScreenRect(viewport, shape.rect)
  const dpr = pdfCanvas.width / (parseFloat(pdfCanvas.style.width) || pdfCanvas.width)
  const maxWidth = highRes ? 1200 : 240

  if (shape.shapeType === 'textbox') {
    const temp = document.createElement('canvas').getContext('2d')!
    const anchorX = Math.min(vx1, vx2)
    const anchorY = Math.min(vy1, vy2)
    const bounds = getTextboxBounds(temp, shape, anchorX, anchorY)
    const cropX = Math.max(0, bounds.x)
    const cropY = Math.max(0, bounds.y)
    const cropW = Math.max(24, bounds.w)
    const cropH = Math.max(24, bounds.h)
    canvas.width = maxWidth
    canvas.height = Math.max(24, Math.round(cropH * maxWidth / cropW))
    ctx.drawImage(pdfCanvas, cropX * dpr, cropY * dpr, cropW * dpr, cropH * dpr, 0, 0, canvas.width, canvas.height)
    ctx.globalAlpha = shape.opacity || 0.8
    const scale = canvas.width / cropW
    drawTextbox(ctx, shape, (anchorX - cropX) * scale, (anchorY - cropY) * scale)
    shapeCache.set(key, canvas.toDataURL('image/png'))
    return
  }

  const w = Math.abs(vx2 - vx1)
  const h = Math.abs(vy2 - vy1)
  if (w < 10 || h < 10) return
  canvas.width = maxWidth
  canvas.height = h * maxWidth / w
  ctx.drawImage(pdfCanvas, Math.min(vx1, vx2) * dpr, Math.min(vy1, vy2) * dpr, w * dpr, h * dpr, 0, 0, canvas.width, canvas.height)
  ctx.globalAlpha = shape.opacity || 0.8
  ctx.beginPath()
  if (shape.shapeType === 'circle') ctx.arc(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) / 2, 0, Math.PI * 2)
  else if (shape.shapeType === 'triangle') {
    ctx.moveTo(canvas.width / 2, 0)
    ctx.lineTo(canvas.width, canvas.height)
    ctx.lineTo(0, canvas.height)
    ctx.closePath()
  } else ctx.rect(0, 0, canvas.width, canvas.height)

  if (shape.filled) {
    ctx.fillStyle = shape.color || '#ff0000'
    ctx.fill()
  } else {
    ctx.strokeStyle = shape.color || '#ff0000'
    ctx.lineWidth = Math.max(highRes ? 4 : 2, shape.width || 2)
    ctx.stroke()
  }
  shapeCache.set(key, canvas.toDataURL('image/png'))
}

export const renderShapeCanvas = (
  list: any[],
  activeView: any,
  shapeCache: Map<string, string>,
  preloadPage: (page: number) => void
) => {
  document.querySelectorAll('[data-shape-id]').forEach(el => {
    const canvas = el as HTMLCanvasElement
    const id = canvas.dataset.shapeId
    const group = list.find((item: any) => item.type === 'shape-group' && item.shapes?.some((shape: any) => shape.id === id))
    const shape = group?.shapes?.find((item: any) => item.id === id)
    if (shape) drawShape(canvas, shape, activeView, shapeCache, preloadPage)
  })
}

export class ShapeDrawer {
  private ctx: CanvasRenderingContext2D
  private config: ShapeConfig
  public canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement, config: ShapeConfig) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.config = config
  }

  setConfig(config: Partial<ShapeConfig>) { this.config = { ...this.config, ...config } }

  drawShape(shape: ShapeAnnotation, preview = false) {
    const [x1, y1, x2, y2] = shape.rect
    const w = x2 - x1
    const h = y2 - y1
    this.ctx.globalAlpha = shape.opacity
    this.ctx.setLineDash(preview ? [5, 5] : [])

    if (shape.shapeType === 'textbox') {
      drawTextbox(this.ctx, shape, Math.min(x1, x2), Math.min(y1, y2))
      this.ctx.setLineDash([])
      return
    }

    this.ctx.beginPath()
    switch (shape.shapeType) {
      case 'rect':
        this.ctx.rect(x1, y1, w, h)
        break
      case 'circle': {
        const cx = x1 + w / 2
        const cy = y1 + h / 2
        const r = Math.min(Math.abs(w), Math.abs(h)) / 2
        this.ctx.arc(cx, cy, r, 0, Math.PI * 2)
        break
      }
      case 'triangle':
        this.ctx.moveTo(x1 + w / 2, y1)
        this.ctx.lineTo(x2, y2)
        this.ctx.lineTo(x1, y2)
        this.ctx.closePath()
        break
    }

    if (shape.filled) {
      this.ctx.fillStyle = shape.color
      this.ctx.fill()
    } else {
      this.ctx.strokeStyle = shape.color
      this.ctx.lineWidth = shape.width
      this.ctx.stroke()
    }
    this.ctx.setLineDash([])

    if (!preview && !shape.filled) {
      this.ctx.fillStyle = 'rgba(0,0,0,0.01)'
      this.ctx.fill()
    }
  }

  clear() { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height) }
}

export class ShapeManager {
  private shapes = new Map<string, ShapeAnnotation>()
  private history: string[] = []

  constructor(private page: number) {}

  add(shape: ShapeAnnotation) { this.shapes.set(shape.id, shape); this.history.push(shape.id) }
  set(shape: ShapeAnnotation) { this.shapes.set(shape.id, shape) }
  get(id: string) { return this.shapes.get(id) }
  delete(id: string) { return this.shapes.delete(id) }
  undo() { const id = this.history.pop(); if (id) { this.shapes.delete(id); return true } return false }
  getAll(): ShapeAnnotation[] { return Array.from(this.shapes.values()) }
  clear() { this.shapes.clear(); this.history = [] }
  toJSON(): ShapeAnnotation[] { return this.getAll() }
  fromJSON(data: ShapeAnnotation[]) { data.forEach(shape => { if (shape.page === this.page) this.shapes.set(shape.id, shape) }) }
}

export class ShapeController {
  private managers = new Map<number, ShapeManager>()
  private drawers = new Map<number, ShapeDrawer>()
  private config: ShapeConfig = { shapeType: 'rect', color: '#ff0000', width: 2, opacity: 0.8, filled: false }
  private startPos: { x: number; y: number } | null = null
  private currentPage = 0
  private previewShape: ShapeAnnotation | null = null
  private pdfViewer: any = null
  private listeners: Array<{ el: HTMLElement; type: string; handler: any }> = []
  private containerClickHandler: ((e: MouseEvent) => void) | null = null

  constructor(private onSave: () => Promise<void>, private onShapeClick?: (shape: ShapeAnnotation) => void) {}

  setPdfViewer(viewer: any) { this.pdfViewer = viewer }
  setConfig(config: Partial<ShapeConfig>) { this.config = { ...this.config, ...config }; this.drawers.forEach(drawer => drawer.setConfig(this.config)) }
  private getLayerCanvas(page: number) {
    return getPdfLayerCanvas('pdf-shape-layer', page)
  }
  private resetDrawing() {
    this.startPos = null
    this.previewShape = null
    this.currentPage = 0
  }
  private getScreenShape(page: number, shape: ShapeAnnotation, pdfViewer = this.pdfViewer) {
    const viewport = getPdfViewport(pdfViewer, page)
    return { ...shape, rect: viewport ? pdfRectToScreenRect(viewport, shape.rect) : shape.rect }
  }
  private redrawPage(page: number, pdfViewer = this.pdfViewer) {
    return redrawPdfLayerPage(page, this.getLayerCanvas.bind(this), (targetPage, canvas) => this.render(targetPage, canvas, pdfViewer))
  }
  private getCurrentViewport(pdfViewer = this.pdfViewer) {
    return this.currentPage ? getPdfViewport(pdfViewer, this.currentPage) : null
  }
  private bindPointerEvents(container: HTMLElement, start: any, move: any, end: any) {
    ;[
      ['mousedown', start], ['mousemove', move], ['mouseup', end],
      ['touchstart', start], ['touchmove', move], ['touchend', end],
    ].forEach(([type, handler]) => container.addEventListener(type as string, handler as EventListener, { passive: type.toString().startsWith('touch') }))
    this.listeners = [
      { el: container, type: 'mousedown', handler: start },
      { el: container, type: 'mousemove', handler: move },
      { el: container, type: 'mouseup', handler: end },
      { el: container, type: 'touchstart', handler: start },
      { el: container, type: 'touchmove', handler: move },
      { el: container, type: 'touchend', handler: end },
    ]
  }

  private getDrawer(page: number, canvas: HTMLCanvasElement) {
    let drawer = this.drawers.get(page)
    if (!drawer || drawer.canvas !== canvas) {
      drawer = new ShapeDrawer(canvas, this.config)
      this.drawers.set(page, drawer)
    }
    return drawer
  }

  private getActiveDrawer(page: number) {
    const canvas = this.getLayerCanvas(page)
    if (!canvas) return null
    return { canvas, drawer: this.getDrawer(page, canvas) }
  }

  getManager(page: number) {
    let manager = this.managers.get(page)
    if (!manager) {
      manager = new ShapeManager(page)
      this.managers.set(page, manager)
    }
    return manager
  }

  startDrawing(e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement, page: number) {
    this.currentPage = page
    const { x, y } = getCanvasPoint(e, canvas.getBoundingClientRect())
    this.startPos = { x, y }
    this.previewShape = this.config.shapeType === 'textbox'
      ? { id: 'preview', type: 'shape', shapeType: 'textbox', page, rect: [x, y, x + 1, y + 1], color: this.config.color, width: this.config.width, opacity: this.config.opacity, text: TEXTBOX_PLACEHOLDER, timestamp: Date.now() }
      : null
  }

  draw(e: MouseEvent | TouchEvent) {
    if (!this.currentPage || !this.startPos) return
    const active = this.getActiveDrawer(this.currentPage)
    if (!active) return
    const { canvas, drawer } = active
    const { x, y } = getCanvasPoint(e, canvas.getBoundingClientRect())
    drawer.clear()
    this.getManager(this.currentPage).getAll().forEach(shape => drawer.drawShape(this.getScreenShape(this.currentPage, shape)))

    if (this.config.shapeType === 'textbox') {
      if (this.previewShape) drawer.drawShape(this.previewShape, true)
      return
    }

    this.previewShape = { id: 'preview', type: 'shape', shapeType: this.config.shapeType, page: this.currentPage, rect: [this.startPos.x, this.startPos.y, x, y], color: this.config.color, width: this.config.width, opacity: this.config.opacity, timestamp: Date.now() }
    drawer.drawShape(this.previewShape, true)
  }

  async endDrawing(pdfViewer?: any) {
    if (!this.currentPage || !this.startPos) return
    if (this.config.shapeType !== 'textbox' && !this.previewShape) return
    const previewShape = this.previewShape!
    const page = this.currentPage
    const [x1, y1, x2, y2] = previewShape.rect
    if (this.config.shapeType !== 'textbox' && (Math.abs(x2 - x1) < 10 || Math.abs(y2 - y1) < 10)) {
      this.resetDrawing()
      return
    }

    let rect: [number, number, number, number] = [x1, y1, x2, y2]
    const viewport = this.getCurrentViewport(pdfViewer)
    if (viewport) rect = compactRect(screenRectToPdfRect(viewport, [x1, y1, x2, y2]))

    const { getChapterName } = await import('@/core/MarkManager')
    const view = pdfViewer?.getPDF?.()
    const chapter = getChapterName({ page: this.currentPage, isPdf: true, toc: view?.flatToc || view?.toc }) || `第${this.currentPage}页`

    const shape: ShapeAnnotation = {
      ...previewShape,
      id: `shape_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      rect,
      filled: this.config.shapeType === 'textbox' ? false : this.config.filled,
      chapter,
      text: this.config.shapeType === 'textbox' ? (previewShape.text || TEXTBOX_PLACEHOLDER) : previewShape.text,
    }
    this.getManager(page).add(shape)
    await this.onSave()

    const canvas = this.redrawPage(page, pdfViewer)

    if (this.onShapeClick && canvas) {
      const rectBox = canvas.getBoundingClientRect()
      const popupX = this.config.shapeType === 'textbox' ? x1 : (x1 + x2) / 2
      const popupY = this.config.shapeType === 'textbox' ? y1 : Math.max(y1, y2) + 10
      setTimeout(() => window.dispatchEvent(new CustomEvent('shape-created', { detail: { shape, x: rectBox.left + popupX, y: rectBox.top + popupY + 10, edit: true } })), 50)
    }

    this.resetDrawing()
  }

  render(page: number, canvas: HTMLCanvasElement, pdfViewer?: any) {
    const drawer = this.getDrawer(page, canvas)
    drawer.clear()
    canvas.parentElement?.querySelectorAll('[data-shape-note-marker],[data-shape-note-tooltip]').forEach(el => el.remove())
    const shapes = this.managers.get(page)?.getAll()
    if (!shapes?.length) return
    shapes.forEach(shape => {
      const screenShape = this.getScreenShape(page, shape, pdfViewer)
      drawer.drawShape(screenShape)
      if (screenShape.note) this.renderNoteMarker(screenShape, canvas)
    })
  }

  handleClick(e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement, page: number, pdfViewer?: any) {
    const { x, y } = getCanvasPoint(e, canvas.getBoundingClientRect())
    const shape = this.findShapeAt(page, x, y, pdfViewer)
    if (shape) {
      this.onShapeClick?.(shape)
      return true
    }
    return false
  }

  findShapeAt(page: number, x: number, y: number, pdfViewer?: any) {
    const shapes = this.getManager(page).getAll()
    for (let i = shapes.length - 1; i >= 0; i--) {
      const screenShape = this.getScreenShape(page, shapes[i], pdfViewer)
      if (this.isPointInShape(x, y, screenShape)) return shapes[i]
    }
    return null
  }

  private renderNoteMarker(shape: ShapeAnnotation, canvas: HTMLCanvasElement) {
    const [x1, y1, x2, y2] = shape.rect
    const icon = '📝'
    const marker = document.createElement('span')
    marker.setAttribute('data-shape-note-marker', 'true')
    marker.textContent = icon
    const left = Math.max(x1, x2) + 5
    const top = Math.min(y1, y2) - 5
    marker.style.cssText = `position:absolute;left:${left}px;top:${top}px;font-size:14px;cursor:pointer;user-select:none;opacity:0.85;transition:opacity .2s;pointer-events:auto;z-index:12`

    const tooltip = document.createElement('div')
    tooltip.setAttribute('data-shape-note-tooltip', 'true')
    const cleanNote = (shape.note || '').split('\n').map(line => line.trim()).filter(Boolean).join('\n')
    tooltip.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid rgba(0,0,0,.1)"><span style="font-size:18px">${icon}</span><span style="font-size:12px;font-weight:600;color:#ff9800;text-transform:uppercase;letter-spacing:.5px">形状笔记</span></div><div style="font-size:14px;line-height:1.8;color:#333;white-space:pre-wrap;max-height:300px;overflow-y:auto">${cleanNote}</div>`
    tooltip.style.cssText = 'position:fixed;display:none;min-width:280px;max-width:420px;padding:16px;background:#fff;border:1px solid rgba(0,0,0,.1);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.12);z-index:99999;pointer-events:none;word-wrap:break-word'
    document.body.appendChild(tooltip)

    marker.onmouseenter = () => {
      marker.style.opacity = '1'
      const rect = marker.getBoundingClientRect()
      tooltip.style.display = 'block'
      tooltip.style.left = rect.left + 'px'
      tooltip.style.top = rect.bottom + 5 + 'px'
      requestAnimationFrame(() => {
        const tipRect = tooltip.getBoundingClientRect()
        if (tipRect.right > window.innerWidth) tooltip.style.left = window.innerWidth - tipRect.width - 10 + 'px'
        if (tipRect.bottom > window.innerHeight) tooltip.style.top = rect.top - tipRect.height - 5 + 'px'
      })
    }
    marker.onmouseleave = () => { marker.style.opacity = '0.85'; tooltip.style.display = 'none' }
    marker.onclick = event => { event.stopPropagation(); this.onShapeClick?.(shape) }

    canvas.parentElement?.appendChild(marker)
  }

  undo(page: number) {
    const manager = this.managers.get(page)
    if (!manager || !manager.undo()) return false
    this.redrawPage(page)
    return true
  }

  clear(page: number) { this.managers.get(page)?.clear(); this.drawers.get(page)?.clear() }

  async toggle(active: boolean, container: HTMLElement) {
    container.style.userSelect = active ? 'none' : 'text'
    container.style.cursor = active ? 'crosshair' : 'default'
    setPdfLayerInteractivity('pdf-shape-layer', active)
    if (active) {
      this.bindEvents(container)
      this.unbindContainerClick()
    } else {
      this.unbindEvents()
      this.bindContainerClick(container)
    }
  }

  private bindEvents(container: HTMLElement) {
    const start = (e: MouseEvent | TouchEvent) => {
      if (container.dataset.pdfDragAnnotation === 'true') return
      const target = e.target as HTMLElement
      if (!target.classList.contains('pdf-shape-layer')) return
      const canvas = target as HTMLCanvasElement
      const page = +(canvas.dataset.page || 0)
      if (!page) return
      this.startDrawing(e, canvas, page)
      if (e instanceof MouseEvent) e.preventDefault()
    }
    const move = (e: MouseEvent | TouchEvent) => {
      if (container.dataset.pdfDragAnnotation === 'true') return
      this.draw(e)
      if (e instanceof MouseEvent) e.preventDefault()
    }
    const end = async () => {
      if (container.dataset.pdfDragAnnotation === 'true') return
      await this.endDrawing(this.pdfViewer)
    }

    this.bindPointerEvents(container, start, move, end)
  }

  private isPointInShape(x: number, y: number, shape: ShapeAnnotation) {
    if (shape.shapeType === 'textbox') {
      const canvas = this.drawers.get(shape.page)?.canvas || this.getLayerCanvas(shape.page)
      const ctx = canvas?.getContext('2d')
      if (!ctx) return false
      const box = getRectBox(shape.rect)
      const bounds = getTextboxBounds(ctx, shape, box.x, box.y)
      return x >= bounds.x && x <= bounds.x + bounds.w && y >= bounds.y && y <= bounds.y + bounds.h
    }

    const [x1, y1, x2, y2] = shape.rect
    const minX = Math.min(x1, x2)
    const maxX = Math.max(x1, x2)
    const minY = Math.min(y1, y2)
    const maxY = Math.max(y1, y2)
    if (x < minX || x > maxX || y < minY || y > maxY) return false

    switch (shape.shapeType) {
      case 'rect':
        return true
      case 'circle': {
        const cx = (x1 + x2) / 2
        const cy = (y1 + y2) / 2
        const r = Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1)) / 2
        return Math.hypot(x - cx, y - cy) <= r
      }
      case 'triangle': {
        const sign = (p1x: number, p1y: number, p2x: number, p2y: number, p3x: number, p3y: number) => (p1x - p3x) * (p2y - p3y) - (p2x - p3x) * (p1y - p3y)
        const d1 = sign(x, y, x1 + (x2 - x1) / 2, y1, x2, y2)
        const d2 = sign(x, y, x2, y2, x1, y2)
        const d3 = sign(x, y, x1, y2, x1 + (x2 - x1) / 2, y1)
        return !(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0)))
      }
      default:
        return false
    }
  }

  private unbindEvents() {
    this.listeners.forEach(({ el, type, handler }) => el.removeEventListener(type, handler))
    this.listeners = []
  }

  private bindContainerClick(container: HTMLElement) {
    this.unbindContainerClick()
    this.containerClickHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('[data-shape-note-marker]')) return
      const pageEl = target.closest('[data-page]') as HTMLElement | null
      if (!pageEl) return
      const page = +(pageEl.dataset.page || 0)
      if (!page) return
      const canvas = pageEl.querySelector('.pdf-shape-layer') as HTMLCanvasElement | null
      if (!canvas) return
      if (this.handleClick(e, canvas, page, this.pdfViewer)) {
        e.stopPropagation()
        e.preventDefault()
      }
    }
    container.addEventListener('click', this.containerClickHandler)
    document.querySelectorAll('.pdf-shape-layer').forEach(el => ((el as HTMLCanvasElement).style.pointerEvents = 'none'))
  }

  private unbindContainerClick() {
    if (this.containerClickHandler) {
      document.querySelectorAll('.viewer-container').forEach(el => el.removeEventListener('click', this.containerClickHandler!))
      this.containerClickHandler = null
    }
  }

  ensureClickEvents(container: HTMLElement) { this.bindContainerClick(container) }
  toJSON() { const all: ShapeAnnotation[] = []; this.managers.forEach(manager => all.push(...manager.toJSON())); return all }
  fromJSON(data: ShapeAnnotation[]) { data.forEach(shape => this.getManager(shape.page).fromJSON([shape])) }
  destroy() { this.unbindEvents(); this.unbindContainerClick(); this.managers.clear(); this.drawers.clear() }
}

export class ShapeToolManager {
  private controller?: ShapeController
  private bookUrl: string
  private initialized = false
  private pdfViewer: any

  constructor(private container: HTMLElement, _plugin: any, bookUrl: string, _bookName: string, private onShapeClick?: (shape: ShapeAnnotation) => void, pdfViewer?: any) {
    this.bookUrl = bookUrl
    this.pdfViewer = pdfViewer
  }

  private get controllerData() { return this.controller?.toJSON() || [] }
  private getLocalShape(id: string) { return this.controllerData.find(shape => shape.id === id) }
  private getPageCanvas(page: number) { return getPdfLayerCanvas('pdf-shape-layer', page) }
  private renderPage(page: number) {
    const canvas = this.getPageCanvas(page)
    if (canvas && this.controller) this.controller.render(page, canvas, this.pdfViewer)
  }
  private async getController() { return await this.init() }
  private async persistController() { if (this.controller) await this.saveData(this.controllerData) }
  private async updateShapeState(shape: ShapeAnnotation, mutate: () => void | Promise<void>) {
    await mutate()
    if (shape.shapeType === 'textbox') shape.filled = false
    this.renderPage(shape.page)
    await this.persistController()
    return true
  }
  private removeShape(id: string, page: number) {
    this.controller?.getManager(page).delete(id)
    this.renderPage(page)
  }

  setPdfViewer(viewer: any) {
    this.pdfViewer = viewer
    if (this.controller) this.controller.setPdfViewer(viewer)
  }

  private async loadData() {
    const annotations = await listAnnotations(this.bookUrl, 'shape')
    return annotations.map((a): ShapeAnnotation => ({
      id: a.id,
      type: 'shape',
      page: a.data?.page || 0,
      shapeType: a.data?.shapeType || 'rect',
      rect: a.data?.rect || [0, 0, 0, 0],
      color: a.color,
      width: a.data?.width || 2,
      opacity: a.data?.opacity || 0.8,
      filled: a.data?.filled || false,
      text: a.text,
      note: a.note,
      timestamp: a.created,
      chapter: a.chapter,
      blockId: a.block,
      customOrder: a.data?.customOrder,
    }))
  }

  private async saveData(shapeAnnotations: any[]) {
    if (!this.initialized) return
    await replaceAnnotationsByType(this.bookUrl, 'shape', shapeAnnotations.map((shape: any) => {
      const data:any={ format: 'pdf', page: shape.page, shapeType: shape.shapeType, rect: compactRect(shape.rect) }
      const width=compactNumber(shape.width || 2)
      const opacity=compactNumber(shape.opacity || 0.8)
      if(width!==2)data.width=width
      if(opacity!==0.8)data.opacity=opacity
      if(shape.filled)data.filled=true
      if(shape.customOrder!==undefined)data.customOrder=shape.customOrder
      return {
      id: shape.id,
      book: this.bookUrl,
      type: 'shape',
      loc: `page-${shape.page}`,
      text: shape.text || '',
      note: shape.note || '',
      color: shape.color || '',
      data,
      created: shape.timestamp || Date.now(),
      updated: Date.now(),
      chapter: shape.chapter || '',
      block: shape.blockId || '',
      } as Annotation
    }))
  }

  async init() {
    if (this.controller) return this.controller
    this.controller = new ShapeController(async () => {
      const shapes = this.controllerData
      await this.saveData(shapes)
      if (shapes.length) {
        try {
          const { syncMarkOnCreate } = await import('@/utils/copy')
          await syncMarkOnCreate(shapes[shapes.length - 1], { bookUrl: this.bookUrl, isPdf: true, pdfViewer: this.pdfViewer, shapeManager: this })
        } catch {}
      }
    }, this.onShapeClick)
    if (this.pdfViewer) this.controller.setPdfViewer(this.pdfViewer)
    const data = await this.loadData()
    if (data.length) this.controller.fromJSON(data)
    this.controller.ensureClickEvents(this.container)
    this.initialized = true
    return this.controller
  }

  async updateShape(id: string, updates: any) {
    const shape = this.getLocalShape(id)
    if (!shape) return false
    return this.updateShapeState(shape, () => Object.assign(shape, updates))
  }

  findShapeAt(page: number, x: number, y: number) {
    return this.controller?.findShapeAt(page, x, y, this.pdfViewer) || null
  }

  moveShapePreview(id: string, dx: number, dy: number) {
    const shape = this.getLocalShape(id)
    if (!shape || !this.pdfViewer) return false
    const viewport = getPdfViewport(this.pdfViewer, shape.page)
    if (!viewport) return false
    const { dx: deltaX, dy: deltaY } = screenDeltaToPdfDelta(viewport, dx, dy)
    const [x1, y1, x2, y2] = shape.rect
    shape.rect = compactRect([x1 + deltaX, y1 + deltaY, x2 + deltaX, y2 + deltaY])
    this.renderPage(shape.page)
    return true
  }

  async commitMove() {
    await this.persistController()
  }

  async moveShape(id: string, dx: number, dy: number) {
    if (!this.moveShapePreview(id, dx, dy)) return false
    await this.commitMove()
    return true
  }

  async deleteShape(id: string) {
    if (!this.controller) return false
    const shape = this.getLocalShape(id)
    if (!shape) return false
    try { await (await import('@/utils/copy')).syncMarkOnDelete(shape) } catch (e) { console.error('[DeleteShapeBlock]', e) }
    await removeAnnotation(id)
    this.removeShape(id, shape.page)
    return true
  }

  render(page: number) {
    this.renderPage(page)
  }

  async toggle(active: boolean) { await (await this.getController()).toggle(active, this.container) }
  async setConfig(config: any) { (await this.getController()).setConfig(config) }
  async save() { await this.persistController() }
  toJSON() { return this.controllerData }
  async undo(page: number) { if (!this.controller) return false; const success = this.controller.undo(page); if (success) await this.save(); return success }
  async clear(page: number) { if (!this.controller) return; this.controller.clear(page); await this.save() }
  destroy() { this.controller?.destroy() }
}

export const createShapeToolManager = (container: HTMLElement, plugin: any, bookUrl: string, bookName: string, onShapeClick?: (shape: ShapeAnnotation) => void, pdfViewer?: any): ShapeToolManager => new ShapeToolManager(container, plugin, bookUrl, bookName, onShapeClick, pdfViewer)
