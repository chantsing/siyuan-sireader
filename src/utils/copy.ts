// ===== 标注复制与同步 =====

import { getPdfPageCanvas, getPdfViewport, pdfRectToScreenRect } from '@/core/pdf/annotation'

type ExportCtx = { bookUrl: string; bookInfo?: any; settings?: any; reader?: any; showMsg: (msg: string, type?: string) => void }
type ExportItem = { chapter: string; cfi: string; text?: string; note?: string; image?: string; id?: string }

const getShapeText = (shape: any) => shape.text?.trim() || 'text'
const getTextboxFontSize = (shape: any) => Math.max(14, Math.min(48, Math.round((shape.width || 2) * 4 + 8)))
const getTextboxMetrics = (ctx: CanvasRenderingContext2D, shape: any) => {
  const size = getTextboxFontSize(shape)
  const lineHeight = Math.round(size * 1.45)
  const lines = getShapeText(shape).split(/\n/).map((line: string) => line || ' ')
  ctx.save()
  ctx.font = `${size}px sans-serif`
  const width = Math.max(...lines.map((line: string) => ctx.measureText(line).width), size)
  ctx.restore()
  return { size, lineHeight, lines, width: Math.ceil(width), height: lineHeight * lines.length }
}
const drawTextboxLabel = (ctx: CanvasRenderingContext2D, shape: any, x: number, y: number) => {
  const { size, lineHeight, lines } = getTextboxMetrics(ctx, shape)
  ctx.save()
  ctx.font = `${size}px sans-serif`
  ctx.fillStyle = shape.color || '#ff0000'
  ctx.textBaseline = 'top'
  lines.forEach((line: string, i: number) => ctx.fillText(line, x, y + i * lineHeight))
  ctx.restore()
}

const DEFAULT_LINK_FORMAT = '> [!NOTE] 📑 {{title}}\n> [{{chapter}}]({{url}}) {{text}}\n> {{image}}\n> {{note}}'
const getShelfBook = async (bookUrl: string) => bookUrl ? (await import('@/core/bookshelf')).bookshelfManager.getBook(bookUrl) : null
const getExportMeta = async (ctx: ExportCtx) => {
  const settings = ctx.settings || (window as any).__sireader_settings
  const book = await getShelfBook(ctx.bookUrl)
  const title = ctx.reader?.getBook?.()?.metadata?.title || ctx.bookInfo?.title || ctx.bookInfo?.name || '读书'
  return { settings, book, title }
}
const writeClipboard = async (text: string, showMsg: ExportCtx['showMsg'], message = '已复制') => {
  await navigator.clipboard.writeText(text)
  showMsg(message)
}
const writeExport = async (text: string, ctx: ExportCtx, title: string, message = '已复制') => {
  const { settings, book } = await getExportMeta(ctx)
  if (settings?.noteInsertTarget && settings.noteInsertTarget !== 'clipboard') {
    if (book?.bindDocId) {
      await (await import('@/utils/noteInsert')).insertToDoc(text, book.bindDocId)
      return ctx.showMsg('已插入绑定文档')
    }
    await (await import('@/utils/noteInsert')).insertNote(text, settings, title, ctx.bookUrl || title)
    return ctx.showMsg('已插入笔记')
  }
  await writeClipboard(text, ctx.showMsg, message)
}

export const exportBookLink = async (item: ExportItem, ctx: ExportCtx) => {
  const fallback = item.text || item.chapter || ''
  if (!ctx.bookUrl) return writeExport(fallback, ctx, item.chapter || '读书', '仅复制文本')
  const { settings, title } = await getExportMeta(ctx)
  const { formatBookLink } = await import('@/composables/useSetting')
  const { formatAuthor } = await import('@/core/MarkManager')
  const author = formatAuthor(ctx.reader?.getBook?.()?.metadata?.author || ctx.bookInfo?.author || '')
  await writeExport(
    formatBookLink(ctx.bookUrl, title, author, item.chapter || '', item.cfi, item.text || '', settings?.linkFormat || DEFAULT_LINK_FORMAT, item.note || '', item.image || '', item.id || ''),
    ctx,
    title
  )
}

export const copyMark = async (item: any, ctx: { bookUrl: string; bookInfo?: any; settings?: any; reader?: any; pdfViewer?: any; shapeCache?: Map<string, string>; showMsg: (msg: string, type?: string) => void }) => {
  const { bookUrl, reader, pdfViewer, shapeCache } = ctx
  const fallback = item.text || item.note || ''
  if (!bookUrl) return writeExport(fallback, ctx, fallback || '读书', '仅复制文本')
  const isPdf = !!pdfViewer
  const page = item.page || (isPdf ? pdfViewer?.getCurrentPage() : null)
  const cfi = item.cfi || (isPdf && page ? `#page-${page}` : '')
  if (!cfi) return writeExport(fallback, ctx, fallback || '读书', '仅复制文本')
  const { getChapterName } = await import('@/core/MarkManager')
  const book = isPdf ? null : reader?.getBook?.()
  const toc = isPdf ? pdfViewer?.getPDF?.()?.toc : book?.toc
  const chapter = item.chapter || getChapterName({ cfi, page, isPdf, toc, location: reader?.getLocation?.() }) || '📍'
  let img = ''
  if (item.shapeType && isPdf) {
    const hdKey = `${item.id}_${item.shapeType}_hd`
    if (shapeCache?.has(hdKey)) {
      const blob = await fetch(shapeCache.get(hdKey)!).then(r => r.blob())
      const file = new File([blob], `shape_${item.id}.png`, { type: 'image/png' })
      const res = await (await import('@/api')).upload('/assets/', [file])
      img = res.succMap?.[file.name] ? `![](${res.succMap[file.name]})` : ''
    } else {
      img = await generateShapeScreenshot(item, page, pdfViewer)
    }
  }
  await exportBookLink({ chapter, cfi, text: item.text || '', note: item.note || '', image: img, id: item.id || '' }, ctx)
}

const genMarkdown = async (item: any, ctx: any): Promise<string> => {
  let md = ''
  const orig = navigator.clipboard.writeText
  navigator.clipboard.writeText = async (text: string) => (md = text, Promise.resolve())
  try {
    await copyMark(item, { ...ctx, settings: { ...(ctx.settings || (window as any).__sireader_settings), noteInsertTarget: 'clipboard' }, showMsg: () => {} })
  } finally {
    navigator.clipboard.writeText = orig
  }
  return md
}

const updateMarkBlockId = async (item: any, blockId: string, ctx: any) => {
  if (item.type === 'shape' && ctx.shapeManager) await ctx.shapeManager.updateShape(item.id, { blockId })
  else if (ctx.marks) await ctx.marks.updateMark(item, { blockId })
}

const importToDoc = async (item: any, docId: string, ctx: any) => {
  if (!docId) return ctx.showMsg?.(ctx.i18n?.noBindDoc || '未绑定文档', 'error')
  try {
    const md = await genMarkdown(item, ctx)
    if (!md) return ctx.showMsg?.('生成失败', 'error')
    const blockId = (await (await import('@/api')).appendBlock('markdown', md, docId))?.[0]?.doOperations?.[0]?.id
    if (blockId) await updateMarkBlockId(item, blockId, ctx)
    ctx.showMsg?.(blockId ? ctx.i18n?.imported || '已导入' : '导入失败', blockId ? 'info' : 'error')
  } catch (e) {
    console.error('[ImportToDoc]', e)
    ctx.showMsg?.(ctx.i18n?.importFailed || '导入失败', 'error')
  }
}

export const importMark = async (item: any, ctx: any) => {
  const book = await getShelfBook(ctx.bookUrl)
  await importToDoc(item, book?.bindDocId, ctx)
}

export const sendMarkToDoc = async (item: any, docId: string, ctx: any) => importToDoc(item, docId, ctx)

export const updateMarkInDoc = async (item: any, ctx: any) => {
  try {
    const book = await getShelfBook(ctx.bookUrl)
    if (!book?.bindDocId) return
    const md = await genMarkdown(item, ctx)
    if (!md) return
    const { updateBlock, sql } = await import('@/api')
    if (item.blockId) {
      try { await updateBlock('markdown', md, item.blockId) } catch {}
    } else {
      for (const b of await sql(`SELECT id FROM blocks WHERE root_id='${book.bindDocId}' AND content LIKE '%_${item.id}&%'`)) {
        try { await updateBlock('markdown', md, b.id) } catch {}
      }
    }
  } catch {}
}

export const isMarkImported = async (item: any, docId: string): Promise<boolean> => {
  try {
    return ((await (await import('@/api')).sql(`SELECT COUNT(*) as count FROM blocks WHERE root_id='${docId}' AND content LIKE '%_${item.id}&%'`))[0]?.count || 0) > 0
  } catch {
    return false
  }
}

export const autoSyncMark = async (item: any, ctx: any) => {
  try {
    const book = await getShelfBook(ctx.bookUrl)
    if (book?.bindDocId && book?.autoSync && !await isMarkImported(item, book.bindDocId)) await importMark(item, { ...ctx, showMsg: () => {} })
  } catch {}
}

export const saveMarkEdit = async (mark: any, updates: any, ctx: any) => {
  if (!ctx.marks) throw new Error('标记系统未初始化')
  if (mark.type === 'shape-group' || mark.type === 'ink-group') throw new Error('请编辑具体的标注项')
  await ctx.marks.updateMark(mark, updates)
  try {
    if ((await getShelfBook(ctx.bookUrl))?.bindDocId) await updateMarkInDoc({ ...mark, ...updates }, ctx)
  } catch {}
}

let _plugin: any, _floatTimer = 0
export const setPlugin = (p: any) => _plugin = p
export const openBlock = (id: string) => { hideFloat(); window.open(`siyuan://blocks/${id}`) }
export const showFloat = (id: string, el: HTMLElement) => { hideFloat(); _floatTimer = window.setTimeout(() => _plugin?.addFloatLayer?.({ refDefs: [{ refID: id }], targetElement: el, isBacklink: false }), 620) }
export const hideFloat = () => { _floatTimer && clearTimeout(_floatTimer); _floatTimer = 0 }

export const generateShapeScreenshot = async (shape: any, page: number, pdfViewer: any): Promise<string> => {
  const pdfCanvas = getPdfPageCanvas(page)
  if (!pdfCanvas) return ''
  const vp = getPdfViewport(pdfViewer, page)
  if (!vp) return ''

  const [vx1, vy1, vx2, vy2] = pdfRectToScreenRect(vp, shape.rect)
  const dpr = pdfCanvas.width / (parseFloat(pdfCanvas.style.width) || pdfCanvas.width)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!

  if (shape.shapeType === 'textbox') {
    const anchorX = Math.min(vx1, vx2)
    const anchorY = Math.min(vy1, vy2)
    const metrics = getTextboxMetrics(ctx, shape)
    const pad = 8
    const cropX = Math.max(0, anchorX - pad)
    const cropY = Math.max(0, anchorY - pad)
    const cropW = Math.max(24, metrics.width + pad * 2)
    const cropH = Math.max(24, metrics.height + pad * 2)
    canvas.width = 1200
    canvas.height = Math.max(24, Math.round(cropH * 1200 / cropW))
    ctx.drawImage(pdfCanvas, cropX * dpr, cropY * dpr, cropW * dpr, cropH * dpr, 0, 0, canvas.width, canvas.height)
    ctx.globalAlpha = shape.opacity || 0.8
    const scale = canvas.width / cropW
    drawTextboxLabel(ctx, shape, (anchorX - cropX) * scale, (anchorY - cropY) * scale)
  } else {
    const w = Math.abs(vx2 - vx1)
    const h = Math.abs(vy2 - vy1)
    if (w < 10 || h < 10) return ''
    canvas.width = 1200
    canvas.height = h * 1200 / w
    ctx.drawImage(pdfCanvas, Math.min(vx1, vx2) * dpr, Math.min(vy1, vy2) * dpr, w * dpr, h * dpr, 0, 0, canvas.width, canvas.height)
    ctx.globalAlpha = shape.opacity || 0.8
    if (shape.filled) {
      ctx.fillStyle = shape.color || '#ff0000'
      ctx.beginPath()
      if (shape.shapeType === 'circle') ctx.arc(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) / 2, 0, Math.PI * 2)
      else if (shape.shapeType === 'triangle') {
        ctx.moveTo(canvas.width / 2, 0)
        ctx.lineTo(canvas.width, canvas.height)
        ctx.lineTo(0, canvas.height)
        ctx.closePath()
      } else ctx.rect(0, 0, canvas.width, canvas.height)
      ctx.fill()
    } else {
      ctx.strokeStyle = shape.color || '#ff0000'
      ctx.lineWidth = 4
      ctx.beginPath()
      if (shape.shapeType === 'circle') ctx.arc(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) / 2, 0, Math.PI * 2)
      else if (shape.shapeType === 'triangle') {
        ctx.moveTo(canvas.width / 2, 0)
        ctx.lineTo(canvas.width, canvas.height)
        ctx.lineTo(0, canvas.height)
        ctx.closePath()
      } else ctx.rect(0, 0, canvas.width, canvas.height)
      ctx.stroke()
    }
  }

  const blob = await fetch(canvas.toDataURL('image/png')).then(r => r.blob())
  const file = new File([blob], `shape_${shape.id}.png`, { type: 'image/png' })
  const res = await (await import('@/api')).upload('/assets/', [file])
  return res.succMap?.[file.name] ? `![](${res.succMap[file.name]})` : ''
}
