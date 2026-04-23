// ===== 标注复制与同步 =====

const getShelfBook = async (bookUrl: string) => bookUrl ? (await import('@/core/bookshelf')).bookshelfManager.getBook(bookUrl) : null

export const copyMark = async (item: any, ctx: { bookUrl: string; bookInfo?: any; settings?: any; reader?: any; pdfViewer?: any; shapeCache?: Map<string, string>; showMsg: (msg: string, type?: string) => void }) => {
  const { bookUrl, bookInfo, reader, pdfViewer, shapeCache, showMsg } = ctx
  const write = async (text: string, msg = '已复制') => {
    const settings = ctx.settings || (window as any).__sireader_settings
    const book = await getShelfBook(bookUrl)
    const title = bookInfo?.title || bookInfo?.name || reader?.getBook?.()?.metadata?.title || '读书'
    if (settings?.noteInsertTarget && settings.noteInsertTarget !== 'clipboard' && book?.bindDocId) return (await import('@/utils/noteInsert')).insertToDoc(text, book.bindDocId).then(() => showMsg('已插入绑定文档'))
    if (settings?.noteInsertTarget && settings.noteInsertTarget !== 'clipboard') return (await import('@/utils/noteInsert')).insertNote(text, settings, title, bookUrl || title).then(() => showMsg('已插入笔记'))
    return navigator.clipboard.writeText(text).then(() => showMsg(msg))
  }
  if (!bookUrl) return write(item.text || item.note || '', '仅复制文本')
  const isPdf = !!pdfViewer
  const page = item.page || (isPdf ? pdfViewer?.getCurrentPage() : null), cfi = item.cfi || (isPdf && page ? `#page-${page}` : '')
  if (!cfi) return write(item.text || item.note || '', '仅复制文本')
  const { formatBookLink } = await import('@/composables/useSetting')
  const { formatAuthor, getChapterName } = await import('@/core/MarkManager')
  const book = isPdf ? null : reader?.getBook?.(), toc = isPdf ? pdfViewer?.getPDF?.()?.toc : book?.toc
  const chapter = item.chapter || getChapterName({ cfi, page, isPdf, toc, location: reader?.getLocation?.() }) || '📍'
  let img = ''
  if (item.shapeType && isPdf) {
    const hdKey = `${item.id}_${item.shapeType}_hd`
    if (shapeCache?.has(hdKey)) {
      const blob = await fetch(shapeCache.get(hdKey)!).then(r => r.blob()), file = new File([blob], `shape_${item.id}.png`, { type: 'image/png' }), res = await (await import('@/api')).upload('/assets/', [file])
      img = res.succMap?.[file.name] ? `![](${res.succMap[file.name]})` : ''
    } else img = await generateShapeScreenshot(item, page, pdfViewer)
  }
  const settings = ctx.settings || (window as any).__sireader_settings
  await write(formatBookLink(bookUrl, book?.metadata?.title || bookInfo?.title || bookInfo?.name || '', formatAuthor(book?.metadata?.author || bookInfo?.author || ''), chapter, cfi, item.text || '', settings?.linkFormat || '> [!NOTE] 📑 {{title}}\n> [{{chapter}}]({{url}}) {{text}}\n> {{image}}\n> {{note}}', item.note || '', img, item.id || ''))
}

const genMarkdown = async (item: any, ctx: any): Promise<string> => {
  let md = '', orig = navigator.clipboard.writeText
  navigator.clipboard.writeText = async (text: string) => { md = text; return Promise.resolve() }
  await copyMark(item, { ...ctx, settings: { ...(ctx.settings || (window as any).__sireader_settings), noteInsertTarget: 'clipboard' }, showMsg: () => {} })
  navigator.clipboard.writeText = orig
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
    if (item.blockId) try { await updateBlock('markdown', md, item.blockId) } catch {}
    else for (const b of await sql(`SELECT id FROM blocks WHERE root_id='${book.bindDocId}' AND content LIKE '%_${item.id}&%'`)) try { await updateBlock('markdown', md, b.id) } catch {}
  } catch {}
}

export const isMarkImported = async (item: any, docId: string): Promise<boolean> => {
  try { return ((await (await import('@/api')).sql(`SELECT COUNT(*) as count FROM blocks WHERE root_id='${docId}' AND content LIKE '%_${item.id}&%'`))[0]?.count || 0) > 0 } catch { return false }
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
  try { if ((await getShelfBook(ctx.bookUrl))?.bindDocId) await updateMarkInDoc({ ...mark, ...updates }, ctx) } catch {}
}

let _plugin: any, _floatTimer = 0
export const setPlugin = (p: any) => _plugin = p
export const openBlock = (id: string) => { hideFloat(); window.open(`siyuan://blocks/${id}`) }
export const showFloat = (id: string, el: HTMLElement) => { hideFloat(); _floatTimer = window.setTimeout(() => _plugin?.addFloatLayer?.({ refDefs: [{ refID: id }], targetElement: el, isBacklink: false }), 620) }
export const hideFloat = () => { _floatTimer && clearTimeout(_floatTimer); _floatTimer = 0 }

export const generateShapeScreenshot = async (shape: any, page: number, pdfViewer: any): Promise<string> => {
  const pageEl = document.querySelector(`[data-page="${page}"]`), pdfCanvas = pageEl && (Array.from(pageEl.querySelectorAll('canvas')).find(c => !c.className) || pageEl.querySelector('canvas')) as HTMLCanvasElement
  if (!pdfCanvas) return ''
  const vp = pdfViewer.getPages().get(page)?.getViewport({ scale: pdfViewer.getScale(), rotation: pdfViewer.getRotation() })
  if (!vp) return ''
  const [px1, py1, px2, py2] = shape.rect, [vx1, vy1] = vp.convertToViewportRectangle([px1, py1, px1, py1]), [vx2, vy2] = vp.convertToViewportRectangle([px2, py2, px2, py2]), w = Math.abs(vx2 - vx1), h = Math.abs(vy2 - vy1)
  if (w < 10 || h < 10) return ''
  const c = document.createElement('canvas'); c.width = 1200; c.height = h * 1200 / w
  const ctx = c.getContext('2d')!, dpr = pdfCanvas.width / (parseFloat(pdfCanvas.style.width) || pdfCanvas.width)
  ctx.drawImage(pdfCanvas, Math.min(vx1, vx2) * dpr, Math.min(vy1, vy2) * dpr, w * dpr, h * dpr, 0, 0, c.width, c.height); ctx.globalAlpha = shape.opacity || 0.8
  if (shape.filled) {
    ctx.fillStyle = shape.color || '#ff0000'; ctx.beginPath()
    if (shape.shapeType === 'circle') ctx.arc(c.width / 2, c.height / 2, Math.min(c.width, c.height) / 2, 0, Math.PI * 2)
    else if (shape.shapeType === 'triangle') { ctx.moveTo(c.width / 2, 0); ctx.lineTo(c.width, c.height); ctx.lineTo(0, c.height); ctx.closePath() }
    else ctx.rect(0, 0, c.width, c.height)
    ctx.fill()
  } else {
    ctx.strokeStyle = shape.color || '#ff0000'; ctx.lineWidth = 4; ctx.beginPath()
    if (shape.shapeType === 'circle') ctx.arc(c.width / 2, c.height / 2, Math.min(c.width, c.height) / 2, 0, Math.PI * 2)
    else if (shape.shapeType === 'triangle') { ctx.moveTo(c.width / 2, 0); ctx.lineTo(c.width, c.height); ctx.lineTo(0, c.height); ctx.closePath() }
    else ctx.rect(0, 0, c.width, c.height)
    ctx.stroke()
  }
  const blob = await fetch(c.toDataURL('image/png')).then(r => r.blob()), file = new File([blob], `shape_${shape.id}.png`, { type: 'image/png' }), res = await (await import('@/api')).upload('/assets/', [file])
  return res.succMap?.[file.name] ? `![](${res.succMap[file.name]})` : ''
}
