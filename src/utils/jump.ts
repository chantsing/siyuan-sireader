const flashElement = (el: HTMLElement, className: string, duration = 1200) => {
  el.classList.add(className)
  setTimeout(() => el.classList.remove(className), duration)
}

const flashSVG = (el: SVGElement) => {
  const orig = el.style.opacity || '1'
  el.style.opacity = '1'
  setTimeout(() => {
    el.style.opacity = '0.3'
    setTimeout(() => (el.style.opacity = orig), 300)
  }, 300)
}

const ensureStyle = (doc: Document, id: string, css: string) => {
  if (doc.querySelector(`#${id}`)) return
  const s = doc.createElement('style')
  s.id = id
  s.textContent = css
  doc.head.appendChild(s)
}

export const pdfPageFromCfi = (cfi?: string) => Number(String(cfi || '').match(/^(?:#page-)?(\d+)$/)?.[1] || 0)

export const gotoEPUB = (cfi: string, id: string | undefined, reader: any, markManager: any) => {
  reader?.goTo(cfi)
  const tryFlash = () => {
    let targetCfi = cfi
    if (id) targetCfi = markManager?.getAll?.().find((m: any) => m.id === id)?.cfi || targetCfi
    reader?.getView()?.renderer?.getContents?.()?.forEach(({ doc, overlayer }: any) => {
      if (!overlayer) return
      const iframe = doc.defaultView?.frameElement as HTMLIFrameElement
      const svg = iframe?.parentElement?.querySelector('svg')
      if (!svg) return
      const groups = Array.from(svg.querySelectorAll('g[fill]:not([fill="none"])')) as SVGGElement[]
      let target: SVGGElement | undefined
      try {
        const resolved = targetCfi && reader.getView().resolveCFI(targetCfi)
        const range = resolved?.anchor?.(doc)
        const rect = range?.getClientRects?.()[0]
        const ir = iframe.getBoundingClientRect()
        if (rect) target = groups.find(g => {
          const r = g.getBoundingClientRect()
          return Math.abs(r.left - (rect.left + ir.left)) < 20 && Math.abs(r.top - (rect.top + ir.top)) < 20
        })
      } catch {}
      ;(target ? [target] : groups).forEach(flashSVG)
      const marker = doc.querySelectorAll('[data-note-marker]')[0] as HTMLElement
      if (marker) {
        ensureStyle(doc, 'epub-flash-style', '@keyframes epub-flash{0%,100%{opacity:1}50%{opacity:.3}}.epub-flash{animation:epub-flash 1.2s ease-in-out 1!important}')
        flashElement(marker, 'epub-flash')
      }
    })
  }
  setTimeout(tryFlash, 300)
  setTimeout(tryFlash, 800)
}

export const jump = (item: any, activeView: any, activeReader: any, marks: any) => {
  if (activeView?.isOnlineContext && item.cfi) activeView.goTo(item.cfi)
  else if (activeView?.isPdf && item.page) activeView.goTo?.(item.page)
  else if (item.cfi) gotoEPUB(item.cfi, item.id, activeReader, marks)
}

export const restorePosition = async (bookUrl: string, reader: any, getMobilePosition: any) => {
  if (!bookUrl) return
  const pos = await getMobilePosition(bookUrl)
  if (pos?.cfi && reader) reader.goTo(pos.cfi)
}

export const initJump = (cfi: string, bookUrl?: string) => {
  if (cfi) setTimeout(() => window.dispatchEvent(new CustomEvent('sireader:goto', { detail: { cfi, bookUrl } })), 500)
}
