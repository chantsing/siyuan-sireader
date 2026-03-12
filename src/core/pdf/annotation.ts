// 查找包含指定class的最近父元素
const closest = (el: Node | null, cls: string): HTMLElement | null => {
  let cur = el?.nodeType === 1 ? el as HTMLElement : (el as any)?.parentElement
  while (cur?.classList) {
    if (cur.classList.contains(cls)) return cur
    cur = cur.parentElement
  }
  return null
}

// 获取textLayer首/尾有内容的文本节点（跨页选择用）
const getTextNode = (el: HTMLElement, first: boolean) => {
  const spans = el.querySelectorAll('span[role="presentation"]')
  let i = first ? 0 : spans.length - 1
  while (spans[i] && !spans[i].textContent) i += first ? 1 : -1
  return spans[i]
}

// 合并同行矩形（过滤空矩形，合并相邻矩形）
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

// TextLayer选择优化器：动态插入endOfContent元素作为"墙"限制选择范围，防止空白区域扩选
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

      // 收集活动的textLayer
      const active = new Set<HTMLElement>()
      for (let i = 0; i < sel.rangeCount; i++) {
        const r = sel.getRangeAt(i)
        for (const l of this.layers.keys()) {
          if (!active.has(l) && r.intersectsNode(l)) active.add(l)
        }
      }

      // 更新textLayer状态
      for (const [l, e] of this.layers) {
        active.has(l) ? l.classList.add('selecting') : this.reset(e, l)
      }

      // Firefox不需要此优化
      if (this.layers.size && getComputedStyle(this.layers.keys().next().value).getPropertyValue('-moz-user-select') === 'none') return

      const range = sel.getRangeAt(0)
      // 判断选择方向：END_TO_END或START_TO_END相等→向上选择，否则→向下选择
      const modStart = this.prev && (
        range.compareBoundaryPoints(Range.END_TO_END, this.prev) === 0 ||
        range.compareBoundaryPoints(Range.START_TO_END, this.prev) === 0
      )

      // 提取公共逻辑：插入墙的位置计算
      const insertWall = (layer: HTMLElement, anchor: Node, offset: number, before: boolean) => {
        const end = this.layers.get(layer)
        if (!end) return
        end.style.width = layer.style.width
        end.style.height = layer.style.height
        if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode as Node
        const pos = before ? anchor : 
          (offset === 0 && anchor.previousSibling) ? anchor.previousSibling.nextSibling : anchor.nextSibling
        ;(anchor as HTMLElement).parentElement?.insertBefore(end, pos)
      }

      if (active.size === 1) {
        // 单页选择
        const anchor = modStart ? range.startContainer : range.endContainer
        const offset = modStart ? range.startOffset : range.endOffset
        const layer = ((anchor.nodeType === Node.TEXT_NODE ? anchor.parentNode : anchor) as HTMLElement)?.closest('.textLayer') as HTMLElement
        if (layer) insertWall(layer, anchor, offset, !!modStart)
      } else {
        // 跨页选择
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
            // 中间页：墙插到页面末尾
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

// 获取PDF选择坐标（转换为PDF坐标系统）
export const getPdfSelectionRects = (viewer: any): any[] | null => {
  const range = window.getSelection()?.getRangeAt(0)
  if (!range?.toString().trim()) return null
  
  const startEl = closest(range.startContainer, 'pdf-page')
  const endEl = closest(range.endContainer, 'pdf-page')
  if (!startEl || !endEl) return null
  
  const startIdx = parseInt(startEl.getAttribute('data-page') || '1') - 1
  const endIdx = parseInt(endEl.getAttribute('data-page') || '1') - 1
  const pages = viewer.getPages()
  const startPage = pages?.get(startIdx + 1)
  if (!startPage) return null
  
  const startCanvas = startEl.querySelector('canvas')
  if (!startCanvas) return null
  const startRect = startCanvas.getBoundingClientRect()
  const startVp = startPage.getViewport({ scale: viewer.getScale(), rotation: viewer.getRotation() })
  const clone = range.cloneRange()
  
  // 跨页选择：调整起始页range到最后一个文本节点
  if (startIdx !== endIdx) {
    const layer = startEl.querySelector('.textLayer') as HTMLElement
    const last = layer && getTextNode(layer, false)
    if (last) range.setEndAfter(last)
  }

  // 收集起始页坐标
  const coords: number[][] = []
  mergeRects(range).forEach(r => coords.push(
    startVp.convertToPdfPoint(r.left - startRect.x, r.top - startRect.y)
      .concat(startVp.convertToPdfPoint(r.right - startRect.x, r.bottom - startRect.y))
  ))

  // 跨页选择：收集结束页坐标
  if (startIdx !== endIdx) {
    const endPage = pages?.get(endIdx + 1)
    const endCanvas = endPage && endEl.querySelector('canvas')
    if (endCanvas) {
      const endRect = endCanvas.getBoundingClientRect()
      const endVp = endPage.getViewport({ scale: viewer.getScale(), rotation: viewer.getRotation() })
      const layer = endEl.querySelector('.textLayer') as HTMLElement
      const first = layer && getTextNode(layer, true)
      if (first) clone.setStart(first, 0)
      mergeRects(clone).forEach(r => coords.push(
        endVp.convertToPdfPoint(r.left - endRect.x, r.top - endRect.y)
          .concat(endVp.convertToPdfPoint(r.right - endRect.x, r.bottom - endRect.y))
      ))
    }
  }

  return coords.length ? coords.map(c => ({ x: c[0], y: c[1], w: c[2] - c[0], h: c[3] - c[1] })) : null
}

let isTextDown = false

// 处理PDF文本选择，显示标注菜单
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
    
    // 优先使用markManager的坐标计算（更准确）
    let data = mgr?.getPdfSelectionRects()
    if (!data) {
      const pr = el.getBoundingClientRect()
      const vp = page.getViewport({ scale: viewer.getScale(), rotation: viewer.getRotation() })
      data = rects.map(r => {
        const [x1, y1] = vp.convertToPdfPoint(r.left - pr.left, r.top - pr.top)
        const [x2, y2] = vp.convertToPdfPoint(r.right - pr.left, r.bottom - pr.top)
        return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
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

// 初始化PDF标注事件监听（鼠标按下/抬起）
export const initPdfAnnotationEvents = (
  container: HTMLElement,
  viewer: any,
  mgr: any,
  showMenu: (d: any, x: number, y: number) => void
) => {
  const handleMouseDown = (e: MouseEvent) => {
    const target = document.elementFromPoint(e.clientX, e.clientY)
    isTextDown = !!target?.closest('span[role="presentation"]')
    if (isTextDown) container.classList.add('pdf-selecting')
  }
  
  const handleMouseUp = () => {
    container.classList.remove('pdf-selecting')
    setTimeout(() => {
      const sel = window.getSelection()
      if (sel?.rangeCount && !sel.isCollapsed && !isTextDown) sel.removeAllRanges()
      else handlePdfSelection(viewer, mgr, showMenu)
    }, 100)
  }
  
  container.addEventListener('mousedown', handleMouseDown)
  container.addEventListener('mouseup', handleMouseUp)
  
  return () => {
    container.removeEventListener('mousedown', handleMouseDown)
    container.removeEventListener('mouseup', handleMouseUp)
  }
}

// 初始化PDF标注渲染（统一管理layer-ready事件和页面切换）
export const initPdfAnnotationRender = (
  viewer: any,
  mgr: any,
  inkMgr?: any,
  shapeMgr?: any
) => {
  const handleLayerReady = (e: CustomEvent) => {
    const page = e.detail.page
    mgr?.renderPdf(page)
    shapeMgr?.render(page)
    inkMgr?.render(page)
  }
  
  window.addEventListener('pdf:layer-ready', handleLayerReady as any)
  
  // 监听页面切换，延迟渲染确保DOM准备好
  const origOnChange = viewer.onChange
  viewer.onChange = (page: number) => {
    origOnChange?.(page)
    setTimeout(() => handleLayerReady({ detail: { page } } as any), 50)
  }
  
  return () => {
    window.removeEventListener('pdf:layer-ready', handleLayerReady as any)
    viewer.onChange = origOnChange
  }
}

// 导出接口
export const initTextLayerOptimization = (layer: HTMLElement) => TextLayerOptimizer.add(layer)
export const cleanupTextLayerOptimization = (layer: HTMLElement) => TextLayerOptimizer.remove(layer)