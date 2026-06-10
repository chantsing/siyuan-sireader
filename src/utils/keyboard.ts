// 阅读器快捷键处理
export interface KeyboardHandlers {
  handlePrev: () => void
  handleNext: () => void
  handleUndo?: () => void
  handlePdfFirstPage?: () => void
  handlePdfLastPage?: () => void
  handlePdfPageUp?: () => void
  handlePdfPageDown?: () => void
  handlePdfRotate?: () => void
  handlePdfZoomIn?: () => void
  handlePdfZoomOut?: () => void
  handlePdfZoomReset?: () => void
  handlePdfSearch?: () => void
  handlePrint?: () => void
  handlePdfTextTool?: () => void
  handlePdfHandTool?: () => void
  handlePdfInkTool?: () => void
  handlePdfShapeTool?: () => void
}

export const createKeyboardHandler = (handlers: KeyboardHandlers, isPdfMode: () => boolean) => {
  return (e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return

    const consume = () => {
      e.preventDefault()
      e.stopPropagation()
    }

    const k = e.key
    const key = k.length === 1 ? k.toLowerCase() : k
    const c = e.ctrlKey || e.metaKey

    // 通用快捷键
    if (c && k === 'z') return handlers.handleUndo?.(), consume()

    // 通用导航
    if (['ArrowLeft', 'ArrowUp'].includes(k) || (k === ' ' && e.shiftKey)) return handlers.handlePrev(), consume()
    if (['ArrowRight', 'ArrowDown', ' '].includes(k)) return handlers.handleNext(), consume()

    // PDF 专用快捷键
    if (!isPdfMode()) return

    const pdfKeys: Record<string, (() => void) | undefined> = {
      Home: handlers.handlePdfFirstPage,
      End: handlers.handlePdfLastPage,
      PageUp: handlers.handlePdfPageUp,
      PageDown: handlers.handlePdfPageDown,
      r: handlers.handlePdfRotate,
      t: handlers.handlePdfTextTool,
      h: handlers.handlePdfHandTool,
      i: handlers.handlePdfInkTool,
      s: handlers.handlePdfShapeTool,
    }

    if (pdfKeys[key]) {
      if (e.repeat && ['t', 'h', 'i', 's'].includes(key)) return consume()
      return pdfKeys[key]?.(), consume()
    }

    if (c) {
      if (k === '+' || k === '=') handlers.handlePdfZoomIn?.(), consume()
      else if (k === '-') handlers.handlePdfZoomOut?.(), consume()
      else if (k === '0') handlers.handlePdfZoomReset?.(), consume()
      else if (k === 'f') handlers.handlePdfSearch?.(), consume()
      else if (k === 'p') handlers.handlePrint?.(), consume()
    }
  }
}

// EPUB 键盘与选区监听初始化
export const setupEpubKeyboard = (
  reader: any,
  handler: (e: KeyboardEvent) => void,
  onSelectionChange?: (doc: Document, e?: Event) => void,
  onTapZone?: (x: number, doc: Document, target: EventTarget | null) => void,
  prev?: () => void,
  next?: () => void
) => {
  const setup = (doc: Document) => {
    if (!doc || (doc as any).__sireaderKeyboardSetup) return
    ;(doc as any).__sireaderKeyboardSetup = true
    let selectionTimer: any
    const triggerSelection = (e?: Event) => {
      if (!onSelectionChange) return
      clearTimeout(selectionTimer)
      selectionTimer = setTimeout(() => onSelectionChange(doc, e), 120)
    }
    const isInteractive = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      !!target.closest('input,textarea,button,select,a,[contenteditable="true"],.mark-menu,.sr-popup-panel,.reader-toolbar-group,.reader-toc-popup,[data-footnote-tooltip]')
    const turn = (dir: 'prev' | 'next', e: Event) => {
      if (isInteractive(e.target) || !prev || !next || reader?.getView?.()?.renderer?.getAttribute?.('flow') === 'scrolled') return false
      e.preventDefault()
      e.stopPropagation()
      dir === 'prev' ? prev() : next()
      return true
    }
    onSelectionChange && doc.addEventListener('selectionchange', triggerSelection)
    onSelectionChange && doc.addEventListener('mouseup', triggerSelection)
    onSelectionChange && doc.addEventListener('touchend', triggerSelection)
    onSelectionChange && doc.addEventListener('contextmenu', e => e.preventDefault())
    onTapZone && doc.addEventListener('tap', e => {
      const detail = (e as CustomEvent).detail || {}
      if (isInteractive(detail.target)) return
      if (!doc.getSelection()?.isCollapsed) return
      onTapZone(detail.x, doc, detail.target ?? null)
    })
    doc.addEventListener('wheel', e => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (Math.abs(delta) < 12) return
      turn(delta > 0 ? 'next' : 'prev', e)
    }, { passive: false })
    doc.addEventListener('mouseup', e => {
      if (e.button === 3) turn('next', e)
      else if (e.button === 4) turn('prev', e)
    })
    doc.addEventListener('keydown', e => {
      if (e.ctrlKey || e.altKey || e.metaKey) return handler(e)
      if (['ArrowLeft', 'ArrowUp'].includes(e.key) || (e.key === ' ' && e.shiftKey)) return turn('prev', e) || handler(e)
      if (['ArrowRight', 'ArrowDown', ' '].includes(e.key)) return turn('next', e) || handler(e)
      return handler(e)
    })
  }

  reader.on('load', ({ doc }: any) => setup(doc))
  setTimeout(() => reader.getView().renderer?.getContents?.()?.forEach(({ doc }: any) => setup(doc)), 500)
}
