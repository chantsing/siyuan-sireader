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
}

export const createKeyboardHandler = (handlers: KeyboardHandlers, isPdfMode: () => boolean) => {
  return (e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
    
    const k = e.key, c = e.ctrlKey || e.metaKey
    
    // 通用快捷键
    if (c && k === 'z') return handlers.handleUndo?.(), e.preventDefault()
    
    // 通用导航
    if (['ArrowLeft', 'ArrowUp'].includes(k) || k === ' ' && e.shiftKey) return handlers.handlePrev(), e.preventDefault()
    if (['ArrowRight', 'ArrowDown', ' '].includes(k)) return handlers.handleNext(), e.preventDefault()
    
    // PDF 专用快捷键
    if (!isPdfMode()) return
    
    const pdfKeys = {
      'Home': handlers.handlePdfFirstPage,
      'End': handlers.handlePdfLastPage,
      'PageUp': handlers.handlePdfPageUp,
      'PageDown': handlers.handlePdfPageDown,
      'r': handlers.handlePdfRotate,
      'R': handlers.handlePdfRotate
    }
    
    if (pdfKeys[k]) return pdfKeys[k]?.(), e.preventDefault()
    
    if (c) {
      if (k === '+' || k === '=') handlers.handlePdfZoomIn?.(), e.preventDefault()
      else if (k === '-') handlers.handlePdfZoomOut?.(), e.preventDefault()
      else if (k === '0') handlers.handlePdfZoomReset?.(), e.preventDefault()
      else if (k === 'f') handlers.handlePdfSearch?.(), e.preventDefault()
      else if (k === 'p') handlers.handlePrint?.(), e.preventDefault()
    }
  }
}

// EPUB 键盘监听初始化
export const setupEpubKeyboard = (reader: any, handler: (e: KeyboardEvent) => void, onMouseup?: (doc: Document, e: MouseEvent) => void) => {
  const setup = (doc: Document) => {
    if (!doc) return
    onMouseup && doc.addEventListener('mouseup', (e: MouseEvent) => onMouseup(doc, e))
    doc.addEventListener('keydown', handler)
    // 注意：不需要设置 tabindex，keydown 事件在 document 级别触发
  }
  
  reader.on('load', ({doc}: any) => setup(doc))
  setTimeout(() => reader.getView().renderer?.getContents?.()?.forEach(({doc}: any) => setup(doc)), 500)
}
