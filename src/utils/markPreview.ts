import { createTooltip, hideTooltip, showTooltip } from '@/core/MarkManager'

type PreviewContext = {
  isPdf?: boolean
  reader?: any
  view?: any
  pdfViewer?: any
  bookUrl?: string
  book?: any
}

const CONTEXT_SIZE = 520
const HOVER_DELAY = 180
const PDF_RUNTIME_PATH = '/stage/protyle/js/pdf/pdf.min.mjs'
const PDF_WORKER_PATH = '/stage/protyle/js/pdf/pdf.worker.min.mjs'
const textCache = new Map<string, Promise<string>>()
const pdfTextCache = new WeakMap<object, Map<number, Promise<string>>>()
const bookSourceCache = new Map<string, Promise<File>>()
const offlinePdfCache = new Map<string, Promise<any>>()
const offlineViewCache = new Map<string, Promise<any>>()
let pdfjsLib: any = null

let tooltip: HTMLElement | null = null
let showTimer: number | undefined
let hideTimer: number | undefined
let activeKey = ''

const esc = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const normalize = (value = '') => value.replace(/\s+/g, ' ').trim()
const compact = (value = '') => normalize(value).slice(0, 12000)
const sourcePathOf = (book: any, bookUrl = '') => book?.url?.startsWith?.('asset://')
  ? book.url.replace('asset://', '')
  : book?.path || bookUrl.replace(/^asset:\/\//, '') || book?.url || ''
const keyOf = (mark: any, ctx: PreviewContext) => [
  ctx.bookUrl || mark?.book || '',
  ctx.isPdf ? 'pdf' : 'epub',
  ctx.reader || ctx.view || ctx.pdfViewer ? 'live' : 'stored',
  mark?.id || mark?.cfi || mark?.page || mark?.timestamp || '',
].join(':')

const loadPDFJS = async () => {
  if (pdfjsLib) return pdfjsLib
  pdfjsLib = await import(PDF_RUNTIME_PATH)
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_PATH
  return pdfjsLib
}

const getBookSource = async (ctx: PreviewContext) => {
  const bookUrl = ctx.bookUrl || ctx.book?.url || ''
  if (!bookUrl) throw new Error('Missing book url')
  if (!bookSourceCache.has(bookUrl)) {
    bookSourceCache.set(bookUrl, (async () => {
      const { bookshelfManager } = await import('@/core/bookshelf')
      const book = ctx.book || await bookshelfManager.getBook(bookUrl)
      return bookshelfManager.loadFile(sourcePathOf(book, bookUrl))
    })())
  }
  return bookSourceCache.get(bookUrl)!
}

const getOfflinePdf = async (ctx: PreviewContext) => {
  const bookUrl = ctx.bookUrl || ctx.book?.url || ''
  if (!bookUrl) return null
  if (!offlinePdfCache.has(bookUrl)) {
    offlinePdfCache.set(bookUrl, (async () => {
      const [pdfjs, file] = await Promise.all([loadPDFJS(), getBookSource(ctx)])
      return pdfjs.getDocument({
        data: new Uint8Array(await file.arrayBuffer()),
        cMapUrl: '/stage/protyle/js/pdf/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/stage/protyle/js/pdf/standard_fonts/',
      }).promise
    })())
  }
  return offlinePdfCache.get(bookUrl)!
}

const getOfflineView = async (ctx: PreviewContext) => {
  const bookUrl = ctx.bookUrl || ctx.book?.url || ''
  if (!bookUrl) return null
  if (!offlineViewCache.has(bookUrl)) {
    offlineViewCache.set(bookUrl, (async () => {
      await import('foliate-js/view.js')
      const [file, { createTxtBook }] = await Promise.all([getBookSource(ctx), import('@/core/txt/book')])
      const host = document.createElement('div')
      host.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;visibility:hidden;pointer-events:none'
      const view = document.createElement('foliate-view') as any
      host.appendChild(view)
      document.body.appendChild(host)
      await view.open((ctx.book?.format || '').toLowerCase() === 'txt' ? await createTxtBook(file) : file)
      return view
    })())
  }
  return offlineViewCache.get(bookUrl)!
}

const getTooltip = () => {
  if (tooltip?.isConnected) return tooltip
  tooltip = document.createElement('div')
  tooltip.setAttribute('data-mark-preview', 'true')
  tooltip.style.cssText = [
    'position:fixed',
    'display:none',
    'width:min(420px,calc(100vw - 20px))',
    'background:var(--b3-theme-surface)',
    'border:1px solid var(--b3-border-color)',
    'border-radius:10px',
    'box-shadow:0 10px 28px rgba(0,0,0,.14),0 3px 10px rgba(0,0,0,.08)',
    'z-index:99999',
    'pointer-events:auto',
    'overflow:hidden',
    'transition:transform .16s ease,opacity .16s ease',
  ].join(';')
  tooltip.onmouseenter = () => clearTimeout(hideTimer)
  tooltip.onmouseleave = () => scheduleHide()
  document.body.appendChild(tooltip)
  return tooltip
}

const prevStop = (text: string, from: number) => {
  const cn = text.lastIndexOf('。', from)
  const en = text.lastIndexOf('.', from)
  return Math.max(cn, en)
}

const firstAfter = (text: string, from: number) => {
  const cn = text.indexOf('。', from)
  const en = text.indexOf('.', from)
  return cn < 0 ? en : en < 0 ? cn : Math.min(cn, en)
}

const getAround = (text: string, needle = '') => {
  const source = compact(text)
  const target = normalize(needle)
  if (!source) return { before: '', hit: target, after: '' }
  if (!target) return { before: source.slice(0, CONTEXT_SIZE), hit: '', after: source.slice(CONTEXT_SIZE, CONTEXT_SIZE * 2) }

  const lowerSource = source.toLowerCase()
  const lowerTarget = target.toLowerCase()
  const short = lowerTarget.slice(0, Math.min(32, lowerTarget.length))
  const index = lowerSource.indexOf(lowerTarget)
  const start = index >= 0 ? index : short ? lowerSource.indexOf(short) : -1
  if (start < 0) return { before: source.slice(0, CONTEXT_SIZE), hit: target, after: source.slice(CONTEXT_SIZE, CONTEXT_SIZE * 2) }

  const end = start + target.length
  const last = prevStop(source, start - 1)
  const left = last < 0 ? -1 : prevStop(source, last - 1)
  const right = firstAfter(source, end)
  const from = Math.max(0, left + 1, start - CONTEXT_SIZE)
  const to = Math.min(source.length, right < 0 ? source.length : right + 1, end + CONTEXT_SIZE)
  return {
    before: source.slice(from, start).trim(),
    hit: source.slice(start, end) || target,
    after: source.slice(end, to).trim(),
  }
}
const renderContext = (mark: any, text: string, title: string) => {
  const { before, hit, after } = getAround(text, mark?.text || mark?.title || '')
  const note = mark?.note ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--b3-border-color);color:var(--b3-theme-on-surface);line-height:1.6">${esc(mark.note)}</div>` : ''
  const meta = [mark?.bookTitle, mark?.chapter, mark?.page ? `Page ${mark.page}` : ''].filter(Boolean).join(' - ')
  const body = `
    <div class="protyle-wysiwyg" style="padding:12px 14px;max-height:320px;overflow:auto;font-size:13px;line-height:1.75;color:var(--b3-theme-on-surface);user-select:text;word-break:break-word">
      ${meta ? `<div style="margin-bottom:6px;color:var(--b3-theme-on-surface-variant);font-size:12px">${esc(meta)}</div>` : ''}
      <div>
        <span style="color:var(--b3-theme-on-surface-variant)">${esc(before)}${before ? ' ' : ''}</span>
        ${hit ? `<mark style="padding:1px 3px;border-radius:3px;background:${esc(mark?.color || '') === 'yellow' ? '#ffeb3b66' : 'var(--b3-theme-primary-lightest)'};color:var(--b3-theme-on-surface)">${esc(hit)}</mark>` : ''}
        <span style="color:var(--b3-theme-on-surface-variant)">${after ? ' ' : ''}${esc(after)}</span>
      </div>
      ${note}
    </div>`
  return createTooltip({ icon: '#iconMark', iconColor: 'var(--b3-theme-primary)', title, content: body })
}

const getPdfPageText = async (pdf: any, pageNum: number) => {
  if (!pdf || !pageNum) return ''
  let cache = pdfTextCache.get(pdf)
  if (!cache) {
    cache = new Map()
    pdfTextCache.set(pdf, cache)
  }
  if (!cache.has(pageNum)) {
    cache.set(pageNum, (async () => {
      const page = await pdf.getPage(pageNum)
      const textContent = await page.getTextContent()
      return normalize(textContent.items.map((item: any) => item.str || '').join(' '))
    })())
  }
  return cache.get(pageNum)!
}

const getPdfContext = async (mark: any, ctx: PreviewContext) => {
  const page = mark?.page || mark?.rects?.find?.((rect: any) => rect?.page)?.page
  const pdf = ctx.pdfViewer?.getPDF?.() || await getOfflinePdf(ctx)
  const pageText = await getPdfPageText(pdf, page)
  return renderContext({ ...mark, page }, pageText || mark?.text || mark?.note || '', 'Mark Context')
}

const textFromRange = (range: Range) => {
  const clone = range.cloneContents()
  clone.querySelectorAll?.('script,style,svg,nav,link,meta').forEach(el => el.remove())
  clone.querySelectorAll?.('br').forEach(el => el.replaceWith('\n'))
  clone.querySelectorAll?.('p,div,section,article,header,footer,h1,h2,h3,h4,h5,h6,li,blockquote,tr').forEach(el => el.append('\n'))
  return compact(clone.textContent || '')
}

const getEpubContext = async (mark: any, ctx: PreviewContext) => {
  const view = ctx.reader?.getView?.() || ctx.view || await getOfflineView(ctx)
  const book = ctx.reader?.getBook?.() || view?.book
  if (!book || !mark?.cfi) return renderContext(mark, mark?.text || mark?.note || '', 'Mark Context')
  const resolved = view?.resolveCFI?.(mark.cfi)
  const index = Number(resolved?.index)
  const section = Number.isInteger(index) ? book.sections?.[index] : null
  if (!section) return renderContext(mark, mark?.text || mark?.note || '', 'Mark Context')
  const doc = await section.createDocument?.()
  if (!doc) return renderContext(mark, mark?.text || mark?.note || '', 'Mark Context')
  const anchor = resolved.anchor?.(doc)
  const body = doc.body || doc.documentElement
  const range = doc.createRange()
  if (anchor instanceof Range) {
    range.setStart(body, 0)
    range.setEndAfter(body.lastChild || body)
  } else if (anchor instanceof Element) {
    range.setStartBefore(body.firstChild || body)
    range.setEndAfter(body.lastChild || body)
  } else {
    return renderContext(mark, compact(body.textContent || ''), 'Mark Context')
  }
  return renderContext(mark, textFromRange(range), 'Mark Context')
}

const buildPreview = (mark: any, ctx: PreviewContext) => {
  const key = keyOf(mark, ctx)
  if (!textCache.has(key)) {
    textCache.set(key, ctx.isPdf ? getPdfContext(mark, ctx) : getEpubContext(mark, ctx))
  }
  return textCache.get(key)!
}

const getActiveContext = (bookUrl: string): PreviewContext => {
  const view = (window as any).__sireader_active_view
  const reader = (window as any).__sireader_active_reader
  const currentBook = (window as any).__currentBookUrl
  if (!view || currentBook !== bookUrl) return { bookUrl }
  return { bookUrl, isPdf: !!view?.isPdf, reader, view, pdfViewer: view?.viewer }
}

const fromAnnotation = (annotation: any, book?: any) => {
  const data = annotation?.data || {}
  return {
    id: annotation.id,
    book: annotation.book,
    bookTitle: book?.title || '',
    type: annotation.type,
    format: data.format || book?.format || annotation.format,
    cfi: data.cfi || annotation.loc,
    section: data.section,
    page: data.page,
    rects: data.rects,
    text: annotation.text,
    color: annotation.color,
    style: data.style,
    note: annotation.note,
    tags: annotation.tags || [],
    timestamp: annotation.created,
    blockId: annotation.block,
    chapter: annotation.chapter,
    title: data.title,
    image: data.image,
    progress: data.progress,
    textOffset: data.textOffset,
    shapeType: data.shapeType,
    paths: data.paths,
  }
}

const findLiveMark = (parsed: { bookUrl: string; cfi: string; id?: string }) => {
  const ctx = getActiveContext(parsed.bookUrl)
  const marks = ctx.view?.marks || ctx.reader?.marks
  if (!marks) return { mark: null, ctx }
  const items = [
    ...(marks.getAll?.() || []),
    ...(marks.getInkAnnotations?.() || []),
    ...(marks.getShapeAnnotations?.() || []),
  ]
  const mark = items.find((item: any) => parsed.id ? item.id === parsed.id : item.cfi === parsed.cfi || item.page === Number(String(parsed.cfi).replace('#page-', '')))
  return { mark, ctx }
}

export const showLinkedMarkPreview = (parsed: { bookUrl: string; cfi: string; id?: string }, anchor: HTMLElement) => {
  const live = findLiveMark(parsed)
  if (live.mark) return showMarkPreview(live.mark, anchor, live.ctx)
  clearTimeout(showTimer)
  clearTimeout(hideTimer)
  activeKey = `link:${parsed.bookUrl}:${parsed.id || parsed.cfi}`
  showTimer = window.setTimeout(async () => {
    const tip = getTooltip()
    const rect = anchor.getBoundingClientRect()
    tip.innerHTML = createTooltip({
      icon: '#iconMark',
      iconColor: 'var(--b3-theme-primary)',
      title: 'Mark Context',
      content: '<div style="padding:14px;color:var(--b3-theme-on-surface-variant);font-size:13px">Loading...</div>',
    })
    showTooltip(tip, rect.right + 8, rect.top)
    try {
      const { getDatabase } = await import('@/core/database')
      const { bookshelfManager } = await import('@/core/bookshelf')
      const [db, book] = await Promise.all([getDatabase(), bookshelfManager.getBook(parsed.bookUrl).catch(() => null)])
      const annotations = await db.getAnnotations(parsed.bookUrl)
      const annotation = annotations.find((item: any) => parsed.id ? item.id === parsed.id : item.loc === parsed.cfi || item.data?.cfi === parsed.cfi)
      if (!annotation || activeKey !== `link:${parsed.bookUrl}:${parsed.id || parsed.cfi}`) return scheduleHide()
      const mark = fromAnnotation(annotation, book)
      const ctx = { bookUrl: parsed.bookUrl, book, isPdf: mark.format === 'pdf' || !!mark.page }
      tip.innerHTML = await buildPreview(mark, ctx)
      showTooltip(tip, rect.right + 8, rect.top)
    } catch {
      if (activeKey.startsWith('link:')) tip.innerHTML = createTooltip({
        icon: '#iconMark',
        iconColor: 'var(--b3-theme-primary)',
        title: 'Mark Context',
        content: '<div style="padding:14px;color:var(--b3-theme-on-surface-variant);font-size:13px">No preview available.</div>',
      })
    }
  }, HOVER_DELAY)
}

export const showMarkPreview = (mark: any, anchor: HTMLElement, ctx: PreviewContext) => {
  clearTimeout(showTimer)
  clearTimeout(hideTimer)
  const key = keyOf(mark, ctx)
  activeKey = key
  showTimer = window.setTimeout(async () => {
    const tip = getTooltip()
    tip.innerHTML = createTooltip({
      icon: '#iconMark',
      iconColor: 'var(--b3-theme-primary)',
      title: 'Mark Context',
      content: '<div style="padding:14px;color:var(--b3-theme-on-surface-variant);font-size:13px">Loading...</div>',
    })
    const rect = anchor.getBoundingClientRect()
    showTooltip(tip, rect.right + 8, rect.top)
    try {
      const html = await buildPreview(mark, ctx)
      if (activeKey !== key || !tip.isConnected) return
      tip.innerHTML = html
      showTooltip(tip, rect.right + 8, rect.top)
    } catch {
      if (activeKey === key) tip.innerHTML = createTooltip({
        icon: '#iconMark',
        iconColor: 'var(--b3-theme-primary)',
        title: 'Mark Context',
        content: '<div style="padding:14px;color:var(--b3-theme-on-surface-variant);font-size:13px">No preview available.</div>',
      })
    }
  }, HOVER_DELAY)
}

export const scheduleHide = () => {
  clearTimeout(showTimer)
  hideTimer = window.setTimeout(() => tooltip && hideTooltip(tooltip, 120), 120)
}

export const hideMarkPreview = () => {
  activeKey = ''
  scheduleHide()
}

