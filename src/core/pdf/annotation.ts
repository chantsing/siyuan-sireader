// 查找包含指定 class 的最近父元素
export const compactNumber = (value: number, digits = 1) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export const compactRect = (rect: [number, number, number, number]) =>
  rect.map(value => compactNumber(value)) as [number, number, number, number]

export const normalizePdfRect = (rect: [number, number, number, number]) => {
  const [x1, y1, x2, y2] = rect
  return compactRect([
    Math.min(x1, x2),
    Math.min(y1, y2),
    Math.max(x1, x2),
    Math.max(y1, y2),
  ])
}

export const getRectBox = (rect: [number, number, number, number]) => {
  const [x1, y1, x2, y2] = rect
  const left = Math.min(x1, x2)
  const top = Math.min(y1, y2)
  const right = Math.max(x1, x2)
  const bottom = Math.max(y1, y2)
  return { x: compactNumber(left), y: compactNumber(top), w: compactNumber(right - left), h: compactNumber(bottom - top) }
}

export const getPdfViewport = (viewer: any, page: number, rotation = viewer?.getRotation?.() ?? 0) =>
  viewer?.getPages?.().get(page)?.getViewport({ scale: viewer.getScale(), rotation }) || null

export const getPdfPageCanvas = (page: number) => {
  const pageEl = document.querySelector(`[data-page="${page}"]`)
  return pageEl && (Array.from(pageEl.querySelectorAll('canvas')).find(canvas => !canvas.className) || pageEl.querySelector('canvas')) as HTMLCanvasElement | null
}

export const getPdfLayerCanvas = (layerClass: string, page: number) =>
  document.querySelector(`.${layerClass}[data-page="${page}"]`) as HTMLCanvasElement | null

export const redrawPdfLayerPage = (
  page: number,
  getCanvas: (page: number) => HTMLCanvasElement | null,
  render: (page: number, canvas: HTMLCanvasElement) => void,
) => {
  const canvas = getCanvas(page)
  if (canvas) render(page, canvas)
  return canvas
}

export const setPdfLayerInteractivity = (layerClass: string, active: boolean) => {
  document.querySelectorAll(`.${layerClass}`).forEach(el => {
    const canvas = el as HTMLCanvasElement
    canvas.style.pointerEvents = active ? 'auto' : 'none'
    canvas.style.cursor = active ? 'crosshair' : 'default'
    canvas.style.touchAction = active ? 'none' : 'auto'
  })
}

export const getCanvasPoint = (e: MouseEvent | TouchEvent, rect: DOMRect) => ({
  x: (e instanceof MouseEvent ? e.clientX : e.touches[0].clientX) - rect.left,
  y: (e instanceof MouseEvent ? e.clientY : e.touches[0].clientY) - rect.top,
})

export const screenPointToPdfPoint = (viewport: any, x: number, y: number) => {
  const [px, py] = viewport.convertToPdfPoint(x, y)
  return { x: compactNumber(px), y: compactNumber(py) }
}

export const pdfPointToScreenPoint = (viewport: any, x: number, y: number) => {
  const [sx, sy] = viewport.convertToViewportPoint(x, y)
  return { x: compactNumber(sx), y: compactNumber(sy) }
}

export const pdfRectToScreenRect = (viewport: any, rect: [number, number, number, number]) => {
  const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(normalizePdfRect(rect))
  return [
    compactNumber(Math.min(x1, x2)),
    compactNumber(Math.min(y1, y2)),
    compactNumber(Math.max(x1, x2)),
    compactNumber(Math.max(y1, y2)),
  ] as [number, number, number, number]
}

export const pdfRectToScreenBox = (viewport: any, rect: [number, number, number, number]) =>
  getRectBox(pdfRectToScreenRect(viewport, rect))

export const screenRectToPdfRect = (viewport: any, rect: [number, number, number, number]) => {
  const p1 = screenPointToPdfPoint(viewport, rect[0], rect[1])
  const p2 = screenPointToPdfPoint(viewport, rect[2], rect[3])
  return normalizePdfRect([p1.x, p1.y, p2.x, p2.y] as [number, number, number, number])
}

export const screenRectToPdfBox = (viewport: any, rect: [number, number, number, number]) => {
  const [x1, y1, x2, y2] = screenRectToPdfRect(viewport, rect)
  return { x: x1, y: y1, w: compactNumber(Math.max(0, x2 - x1)), h: compactNumber(Math.max(0, y2 - y1)) }
}

export const screenDeltaToPdfDelta = (viewport: any, dx: number, dy: number) => {
  const p1 = screenPointToPdfPoint(viewport, 0, 0)
  const p2 = screenPointToPdfPoint(viewport, dx, dy)
  return { dx: compactNumber(p2.x - p1.x), dy: compactNumber(p2.y - p1.y) }
}

const closest = (el: Node | null, cls: string): HTMLElement | null => {
  let cur = el?.nodeType === 1 ? el as HTMLElement : (el as any)?.parentElement
  while (cur?.classList) {
    if (cur.classList.contains(cls)) return cur
    cur = cur.parentElement
  }
  return null
}

// 获取 textLayer 首/尾有内容的文本节点（跨页选择用）
const getTextNode = (el: HTMLElement, first: boolean) => {
  const spans = el.querySelectorAll('span[role="presentation"]')
  let i = first ? 0 : spans.length - 1
  while (spans[i] && !spans[i].textContent) i += first ? 1 : -1
  return spans[i]
}

// 合并同一行矩形（过滤空矩形，合并相邻矩形）
const mergeRects = (range: Range) => {
  const merged: { left: number; top: number; right: number; bottom: number }[] = []
  let lastTop: number | undefined
  Array.from(range.getClientRects()).forEach(r => {
    if (!r.height || !r.width) return
    if (lastTop === undefined || Math.abs(lastTop - r.top) > 4) {
      merged.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
      lastTop = r.top
    } else merged[merged.length - 1].right = r.right
  })
  return merged
}

// TextLayer 选择优化：动态插入 endOfContent 元素作为"墙"限制选择范围，防止空白区域扩选
class TextLayerOptimizer {
  private static layers = new Map<HTMLElement, HTMLElement>()
  private static ctrl: AbortController | null = null
  private static prev: Range | null = null
  private static down = false

  static add(layer: HTMLElement) {
    const end = document.createElement('div')
    end.className = 'endOfContent'
    layer.appendChild(end)
    layer.addEventListener('mousedown', () => layer.classList.add('selecting'))
    this.layers.set(layer, end)
    this.enable()
  }

  static remove(layer: HTMLElement) {
    this.layers.delete(layer)
    if (!this.layers.size) {
      this.ctrl?.abort()
      this.ctrl = null
    }
  }

  private static reset(end: HTMLElement, layer: HTMLElement) {
    layer.appendChild(end)
    end.style.width = end.style.height = ''
    layer.classList.remove('selecting')
  }

  private static enable() {
    if (this.ctrl) return
    this.ctrl = new AbortController()
    const { signal } = this.ctrl
    const resetAll = () => this.layers.forEach((e, l) => this.reset(e, l))

    document.addEventListener('pointerdown', () => this.down = true, { signal })
    document.addEventListener('pointerup', () => { this.down = false; resetAll() }, { signal })
    window.addEventListener('blur', () => { this.down = false; resetAll() }, { signal })
    document.addEventListener('keyup', () => !this.down && resetAll(), { signal })

    document.addEventListener('selectionchange', () => {
      const sel = document.getSelection()
      if (!sel?.rangeCount) return resetAll()

      const active = new Set<HTMLElement>()
      for (let i = 0; i < sel.rangeCount; i++) {
        const r = sel.getRangeAt(i)
        for (const l of this.layers.keys()) {
          if (!active.has(l) && r.intersectsNode(l)) active.add(l)
        }
      }

      for (const [l, e] of this.layers) {
        active.has(l) ? l.classList.add('selecting') : this.reset(e, l)
      }

      if (this.layers.size && getComputedStyle(this.layers.keys().next().value).getPropertyValue('-moz-user-select') === 'none') return

      const range = sel.getRangeAt(0)
      const modStart = this.prev && (
        range.compareBoundaryPoints(Range.END_TO_END, this.prev) === 0 ||
        range.compareBoundaryPoints(Range.START_TO_END, this.prev) === 0
      )

      const insertWall = (layer: HTMLElement, anchor: Node, offset: number, before: boolean) => {
        const end = this.layers.get(layer)
        if (!end) return
        end.style.width = layer.style.width
        end.style.height = layer.style.height
        if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode as Node
        const pos = before ? anchor
          : (offset === 0 && anchor.previousSibling) ? anchor.previousSibling.nextSibling : anchor.nextSibling
        ;(anchor as HTMLElement).parentElement?.insertBefore(end, pos)
      }

      if (active.size === 1) {
        const anchor = modStart ? range.startContainer : range.endContainer
        const offset = modStart ? range.startOffset : range.endOffset
        const layer = ((anchor.nodeType === Node.TEXT_NODE ? anchor.parentNode : anchor) as HTMLElement)?.closest('.textLayer') as HTMLElement
        if (layer) insertWall(layer, anchor, offset, !!modStart)
      } else {
        const getTextLayer = (node: Node) => ((node.nodeType === Node.TEXT_NODE ? node.parentNode : node) as HTMLElement)?.closest('.textLayer') as HTMLElement
        const startTextLayer = getTextLayer(range.startContainer)
        const endTextLayer = getTextLayer(range.endContainer)

        for (const layer of active) {
          const end = this.layers.get(layer)
          if (!end) continue

          if (layer === startTextLayer && modStart) {
            insertWall(layer, range.startContainer, range.startOffset, true)
          } else if (layer === endTextLayer && !modStart) {
            insertWall(layer, range.endContainer, range.endOffset, false)
          } else {
            end.style.width = layer.style.width
            end.style.height = layer.style.height
            const spans = layer.querySelectorAll('span[role="presentation"]')
            if (spans.length) spans[spans.length - 1].parentElement?.insertBefore(end, spans[spans.length - 1].nextSibling)
          }
        }
      }
      this.prev = range.cloneRange()
    }, { signal })
  }
}

const buildPageRange = (source: Range, layer: HTMLElement, pageNum: number, startPageNum: number, endPageNum: number) => {
  const pageRange = source.cloneRange()
  const first = getTextNode(layer, true)
  const last = getTextNode(layer, false)
  if (!first || !last) return null
  if (pageNum !== startPageNum) pageRange.setStartBefore(first)
  if (pageNum !== endPageNum) pageRange.setEndAfter(last)
  return pageRange
}

// 获取 PDF 选择坐标（转换为 PDF 坐标系统）
export const getPdfSelectionRects = (viewer: any): any[] | null => {
  const range = window.getSelection()?.getRangeAt(0)
  if (!range?.toString().trim()) return null

  const startEl = closest(range.startContainer, 'pdf-page')
  const endEl = closest(range.endContainer, 'pdf-page')
  if (!startEl || !endEl) return null

  const startPageNum = parseInt(startEl.getAttribute('data-page') || '1')
  const endPageNum = parseInt(endEl.getAttribute('data-page') || '1')
  const pageFrom = Math.min(startPageNum, endPageNum)
  const pageTo = Math.max(startPageNum, endPageNum)
  const pages = viewer.getPages()
  const coords: any[] = []

  for (let pageNum = pageFrom; pageNum <= pageTo; pageNum++) {
    const pageEl = document.querySelector(`[data-page="${pageNum}"]`) as HTMLElement | null
    const page = pages?.get(pageNum)
    const canvas = getPdfPageCanvas(pageNum)
    const layer = pageEl?.querySelector('.textLayer') as HTMLElement | null
    if (!pageEl || !page || !canvas || !layer) continue

    const pageRange = buildPageRange(range, layer, pageNum, startPageNum, endPageNum)
    if (!pageRange?.toString().trim()) continue

    const canvasRect = canvas.getBoundingClientRect()
    const viewport = getPdfViewport(viewer, pageNum)
    if (!viewport) continue
    mergeRects(pageRange).forEach(r => {
      coords.push({ page: pageNum, ...screenRectToPdfBox(viewport, [r.left - canvasRect.x, r.top - canvasRect.y, r.right - canvasRect.x, r.bottom - canvasRect.y]) })
    })
  }

  return coords.length ? coords : null
}

let isTextDown = false
const PDF_DRAG_KEY = 'pdfDragAnnotation'
type DragState = { type: 'mark' | 'shape' | 'ink'; id: string; item: any; page: number; x: number; y: number; moved: boolean }

// 处理 PDF 文本选择，显示标注菜单
export const handlePdfSelection = (viewer: any, mgr: any, show: (d: any, x: number, y: number) => void) => {
  const sel = window.getSelection()
  if (!sel?.toString().trim()) return

  try {
    const range = sel.getRangeAt(0)
    if (!closest(range.commonAncestorContainer, 'viewer-container') &&
        !closest(range.commonAncestorContainer, 'pdf-page')) return

    const rects = Array.from(range.getClientRects())
    if (!rects.length) return

    const el = closest(range.startContainer, 'pdf-page')
    if (!el) return

    const pg = parseInt(el.getAttribute('data-page') || '1')
    const page = viewer.getPages().get(pg)
    if (!page) return

    let data = mgr?.getPdfSelectionRects()
    if (!data) {
      const pr = el.getBoundingClientRect()
      const vp = getPdfViewport(viewer, pg)
      if (!vp) return
      data = rects.map(r => {
        return { page: pg, ...screenRectToPdfBox(vp, [r.left - pr.left, r.top - pr.top, r.right - pr.left, r.bottom - pr.top]) }
      })
    }

    show(
      { text: sel.toString().trim(), location: { format: 'pdf', page: pg, rects: data } },
      rects[0].left + rects[0].width / 2,
      rects[0].top
    )
  } catch (e) {
    console.error('[PDF] Selection error:', e)
  }
}

// 初始化 PDF 标注事件监听（鼠标按下/抬起）
export const initPdfAnnotationEvents = (
  container: HTMLElement,
  viewer: any,
  mgr: any,
  showMenu: (d: any, x: number, y: number) => void
) => {
  let dragState: DragState | null = null
  let pendingDx = 0
  let pendingDy = 0
  let dragFrame = 0

  const getPageInfo = (e: MouseEvent) => {
    const pageEl = (e.target as HTMLElement)?.closest('[data-page]') as HTMLElement | null
    if (!pageEl) return null
    const page = parseInt(pageEl.dataset.page || '0')
    if (!page) return null
    const canvas = getPdfPageCanvas(page)
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return { page, x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const setDragging = (active: boolean) => active ? (container.dataset[PDF_DRAG_KEY] = 'true') : delete container.dataset[PDF_DRAG_KEY]
  const getEditorPos = (e: MouseEvent) => ({ x: e.clientX, y: e.clientY + 10 })
  const moveDrag = (state: DragState, dx: number, dy: number) => state.type === 'mark'
    ? mgr?.movePdfMarkPreview?.(state.id, state.page, dx, dy)
    : state.type === 'shape'
      ? mgr?.shapeManager?.moveShapePreview?.(state.id, dx, dy)
      : mgr?.inkManager?.moveInkPreview?.(state.id, dx, dy)
  const commitDrag = (state: DragState | null) => state?.moved && (state.type === 'mark'
    ? mgr?.commitPdfMarkMove?.()
    : state.type === 'shape'
      ? mgr?.shapeManager?.commitMove?.()
      : mgr?.inkManager?.commitMove?.())
  const startDrag = (type: DragState['type'], id: string, item: any, page: number, e: MouseEvent) => {
    dragState = { type, id, item, page, x: e.clientX, y: e.clientY, moved: false }
    pendingDx = 0
    pendingDy = 0
    setDragging(true)
    e.preventDefault()
  }
  const flushDrag = () => {
    dragFrame = 0
    if (!dragState) return
    const dx = pendingDx
    const dy = pendingDy
    pendingDx = 0
    pendingDy = 0
    if (!dx && !dy) return
    moveDrag(dragState, dx, dy)
  }
  const queueDrag = (dx: number, dy: number) => {
    pendingDx += dx
    pendingDy += dy
    if (!dragFrame) dragFrame = requestAnimationFrame(flushDrag)
  }
  const findTarget = (pageInfo: ReturnType<typeof getPageInfo>, target?: EventTarget | null) => {
    if (!pageInfo) return null
    const highlight = (target as HTMLElement | null)?.closest?.('.pdf-highlight') as HTMLElement | null
    if (highlight?.dataset.id) return { type: 'mark' as const, id: highlight.dataset.id, item: mgr?.getAll?.().find?.((mark: any) => mark.id === highlight.dataset.id) }
    const shape = mgr?.shapeManager?.findShapeAt?.(pageInfo.page, pageInfo.x, pageInfo.y)
    if (shape?.id) return { type: 'shape' as const, id: shape.id, item: shape }
    const ink = mgr?.inkManager?.findInkAt?.(pageInfo.page, pageInfo.x, pageInfo.y)
    if (ink?.id) return { type: 'ink' as const, id: ink.id, item: ink }
    return null
  }
  const openEditor = (item: any, x: number, y: number) => {
    if (!item) return false
    window.dispatchEvent(new CustomEvent('sireader:edit-mark', { detail: { item, position: { x, y } } }))
    return true
  }
  const tryOpenTargetEditor = (e: MouseEvent) => openEditor(findTarget(getPageInfo(e), e.target)?.item, getEditorPos(e).x, getEditorPos(e).y)
  const handleDragStart = (e: MouseEvent) => {
    if (e.button !== 0) return
    const pageInfo = getPageInfo(e)
    const target = findTarget(pageInfo, e.target)
    if (target) startDrag(target.type, target.id, target.item, pageInfo!.page, e)
  }

  const handleDragMove = (e: MouseEvent) => {
    if (!dragState) return
    const dx = e.clientX - dragState.x
    const dy = e.clientY - dragState.y
    if (!dx && !dy) return
    dragState.moved = dragState.moved || Math.abs(dx) > 1 || Math.abs(dy) > 1
    dragState.x = e.clientX
    dragState.y = e.clientY
    queueDrag(dx, dy)
    e.preventDefault()
  }

  const handleDragEnd = (e: MouseEvent) => {
    if (!dragState) return
    const finalState = dragState
    if (dragFrame) {
      cancelAnimationFrame(dragFrame)
      flushDrag()
    }
    commitDrag(finalState)
    if (finalState.moved) {
      e.preventDefault()
      e.stopPropagation()
    } else openEditor(finalState.item, getEditorPos(e).x, getEditorPos(e).y)
    dragState = null
    pendingDx = 0
    pendingDy = 0
    setDragging(false)
  }

  const handleMouseDown = (e: MouseEvent) => {
    handleDragStart(e)
    if (dragState) return
    const target = document.elementFromPoint(e.clientX, e.clientY)
    isTextDown = !!target?.closest('span[role="presentation"]')
    if (isTextDown) container.classList.add('pdf-selecting')
  }

  const handleMouseUp = (e?: MouseEvent) => {
    if (dragState) {
      handleDragEnd(e as MouseEvent)
      return
    }
    container.classList.remove('pdf-selecting')
    setTimeout(() => {
      const sel = window.getSelection()
      if (sel?.rangeCount && !sel.isCollapsed && !isTextDown) sel.removeAllRanges()
      else if (!(e && tryOpenTargetEditor(e))) handlePdfSelection(viewer, mgr, showMenu)
    }, 100)
  }

  container.addEventListener('mousemove', handleDragMove)
  container.addEventListener('mousedown', handleMouseDown)
  container.addEventListener('mouseup', handleMouseUp)

  return () => {
    container.removeEventListener('mousemove', handleDragMove)
    container.removeEventListener('mousedown', handleMouseDown)
    container.removeEventListener('mouseup', handleMouseUp)
  }
}

// 初始化 PDF 标注渲染（统一管理 layer-ready 事件和页面切换）
export const initPdfAnnotationRender = (
  viewer: any,
  mgr: any,
  inkMgr?: any,
  shapeMgr?: any
) => {
  const renderPage = (page: number) => {
    mgr?.renderPdf(page)
    shapeMgr?.render(page)
    inkMgr?.render(page)
  }
  const stop = viewer?.onPageReady?.(renderPage)
  viewer?.refreshRenderedPages?.()

  return () => {
    stop?.()
  }
}

export const initTextLayerOptimization = (layer: HTMLElement) => TextLayerOptimizer.add(layer)
export const cleanupTextLayerOptimization = (layer: HTMLElement) => TextLayerOptimizer.remove(layer)
