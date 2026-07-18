// ===== 标注复制与同步 =====

type ExportCtx = {
  bookUrl: string
  bookInfo?: any
  settings?: any
  reader?: any
  showMsg: (msg: string, type?: string) => void
}

type ExportItem = {
  chapter: string
  cfi: string
  text?: string
  note?: string
  image?: string
  id?: string
}

const DEFAULT_LINK_FORMAT = '> [!NOTE] 📑 {{title}}\n> [{{chapter}}]({{url}}) {{text}}\n> {{image}}\n> {{note}}'
export const inlineLinkText = (text = '') => text.replace(/\s+/g, ' ').replace(/([\p{Script=Han}\u3000-\u303f\uff00-\uffef]) ([\p{Script=Han}\u3000-\u303f\uff00-\uffef])/gu, '$1$2').trim()

const getShelfBook = async (bookUrl: string) => bookUrl ? (await import('@/core/bookshelf')).bookshelfManager.getBook(bookUrl) : null
const getGlobalSettings = async () => (window as any).__sireader_settings || await (await import('@/composables/useSetting')).settingsManager.get().catch(() => null)
const shouldSyncOnAdd = async () => !!(await getGlobalSettings())?.annotationSyncOnAdd
const shouldSyncOnDelete = async () => !!(await getGlobalSettings())?.annotationSyncOnDelete
const getBoundDocId = async (bookUrl: string) => (await getShelfBook(bookUrl))?.bindDocId || ''
const getInsertedBlockId = (result: any) => result?.[0]?.doOperations?.[0]?.id || result?.[0]?.id || result?.doOperations?.[0]?.id || ''
const imageSrcToMarkdown = async (src: string | Blob, name = 'mark') => {
  if (!src) return ''
  try {
    const blob = typeof src === 'string' ? await fetch(src).then(r => r.blob()) : src
    const file = new File([blob], `${name}.${blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'}`, { type: blob.type || 'image/png' })
    const res = await (await import('@/api')).upload('/assets/', [file])
    return res.succMap?.[file.name] ? `![](${res.succMap[file.name]})` : (typeof src === 'string' ? `![](${src})` : '')
  } catch { return typeof src === 'string' ? `![](${src})` : '' }
}

const resolveExportMeta = async (ctx: ExportCtx | any) => {
  const shelfBook = await getShelfBook(ctx.bookUrl)
  const book = shelfBook || ctx.bookInfo
  const readerBook = ctx.reader?.getBook?.()
  return {
    settings: ctx.settings || (window as any).__sireader_settings,
    book,
    title: shelfBook?.title || ctx.bookInfo?.title || ctx.bookInfo?.name || readerBook?.metadata?.title || '读书',
    author: shelfBook?.author || ctx.bookInfo?.author || readerBook?.metadata?.author || '',
  }
}

const writeClipboard = async (text: string, showMsg: ExportCtx['showMsg'], message = '已复制') => {
  await navigator.clipboard.writeText(text)
  showMsg(message)
}

const writeExport = async (text: string, ctx: ExportCtx, meta: Awaited<ReturnType<typeof resolveExportMeta>>, message = '已复制') => {
  const { settings, book, title } = meta
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
  const chapter = item.chapter || item.text || '璇讳功'
  const fallback = item.text || item.chapter || ''
  if (!ctx.bookUrl) return writeExport(fallback, ctx, await resolveExportMeta(ctx), '仅复制文本')
  const meta = await resolveExportMeta(ctx)
  const { formatBookLink } = await import('@/composables/useSetting')
  const { formatAuthor } = await import('@/core/MarkManager')
  const author = formatAuthor(meta.author)
  await writeExport(
    formatBookLink(ctx.bookUrl, meta.title, author, chapter, item.cfi, inlineLinkText(item.text || ''), meta.settings?.linkFormat || DEFAULT_LINK_FORMAT, item.note || '', item.image || '', item.id || ''),
    ctx,
    meta
  )
}

export const copyMark = async (item: any, ctx: { bookUrl: string; bookInfo?: any; settings?: any; reader?: any; isPdf?: boolean; showMsg: (msg: string, type?: string) => void }) => {
  const { bookUrl, reader } = ctx
  const fallback = item.text || item.note || ''
  if (!bookUrl) return writeExport(fallback, ctx, await resolveExportMeta(ctx), '仅复制文本')
  const isPdf = !!ctx.isPdf || item.format === 'pdf' || !!item.page
  const page = item.page || null
  const cfi = item.cfi || (isPdf && page ? `#page-${page}` : '')
  if (!cfi) return writeExport(fallback, ctx, await resolveExportMeta(ctx), '仅复制文本')
  const { getChapterName } = await import('@/core/MarkManager')
  const book = isPdf ? null : reader?.getBook?.()
  const toc = isPdf ? null : book?.toc
  const chapter = item.chapter || getChapterName({ cfi, page, isPdf, toc, location: reader?.getLocation?.() }) || '📍'
  let img = ''
  if (item.image || item.src) {
    img = await imageSrcToMarkdown(item.image || item.src || '', 'mark')
  }
  await exportBookLink({ chapter, cfi, text: item.text || '', note: item.note || '', image: img, id: item.id || '' }, ctx)
}

const genMarkdown = async (item: any, ctx: any): Promise<string> => {
  let md = ''
  const originalWriteText = navigator.clipboard.writeText
  navigator.clipboard.writeText = async (text: string) => (md = text, Promise.resolve())
  try {
    await copyMark(item, { ...ctx, settings: { ...(ctx.settings || (window as any).__sireader_settings), noteInsertTarget: 'clipboard' }, showMsg: () => {} })
  } finally {
    navigator.clipboard.writeText = originalWriteText
  }
  return md
}

const updateMarkBlockId = async (item: any, blockId: string, ctx: any) => {
  if (ctx.marks) await ctx.marks.updateMark(item, { blockId })
}

const appendMarkToDoc = async (item: any, docId: string, ctx: any, markdown?: string) => {
  if (!docId) return ctx.showMsg?.(ctx.i18n?.noBindDoc || '未绑定文档', 'error')
  try {
    const content = markdown || await genMarkdown(item, ctx)
    if (!content) return ctx.showMsg?.('生成失败', 'error')
    const blockId = getInsertedBlockId(await (await import('@/api')).appendBlock('markdown', content, docId))
    if (blockId) await updateMarkBlockId(item, blockId, ctx)
    ctx.showMsg?.(blockId ? ctx.i18n?.imported || '已导入' : ctx.i18n?.importFailed || '导入失败', blockId ? 'info' : 'error')
    return blockId
  } catch (error) {
    console.error('[AppendMarkToDoc]', error)
    ctx.showMsg?.(ctx.i18n?.importFailed || '导入失败', 'error')
    return ''
  }
}

export const importMark = async (item: any, ctx: any) => {
  const settings = ctx.settings || await getGlobalSettings()
  const meta = await resolveExportMeta({ ...ctx, settings })
  const docId = meta.book?.bindDocId || ''
  const md = await genMarkdown(item, { ...ctx, settings, showMsg: () => {} })
  if (!md) return ctx.showMsg?.('生成失败', 'error')
  if (docId) return await appendMarkToDoc(item, docId, ctx, md)
  if (!settings?.noteInsertTarget || settings.noteInsertTarget === 'clipboard') return ctx.showMsg?.(ctx.i18n?.noBindDoc || '未绑定文档', 'error')
  const blockId = getInsertedBlockId(await (await import('@/utils/noteInsert')).insertNote(md, settings, meta.title, ctx.bookUrl || meta.title))
  if (!blockId) return ctx.showMsg?.(ctx.i18n?.importFailed || '导入失败', 'error')
  await updateMarkBlockId(item, blockId, ctx)
  ctx.showMsg?.(ctx.i18n?.imported || '已导入')
  return blockId
}

export const sendMarkToDoc = async (item: any, docId: string, ctx: any) => appendMarkToDoc(item, docId, ctx)

export const updateMarkInDoc = async (item: any, ctx: any) => {
  try {
    if (!item.blockId || !await getBoundDocId(ctx.bookUrl)) return
    const md = await genMarkdown(item, ctx)
    if (!md) return
    const { updateBlock } = await import('@/api')
    try { await updateBlock('markdown', md, item.blockId) } catch {}
  } catch {}
}

export const syncMarkOnCreate = async (item: any, ctx: any) => {
  try {
    if (item?.blockId || !await shouldSyncOnAdd()) return
    const settings = await getGlobalSettings()
    const meta = await resolveExportMeta({ ...ctx, settings })
    const docId = await getBoundDocId(ctx.bookUrl)
    const md = await genMarkdown(item, { ...ctx, settings, showMsg: () => {} })
    if (!md) return
    if (docId) {
      await appendMarkToDoc(item, docId, { ...ctx, showMsg: () => {} }, md)
      return
    }
    if (!settings?.noteInsertTarget || settings.noteInsertTarget === 'clipboard') return
    const blockId = getInsertedBlockId(await (await import('@/utils/noteInsert')).insertNote(md, settings, meta.title, ctx.bookUrl || meta.title))
    if (blockId) await updateMarkBlockId(item, blockId, ctx)
  } catch {}
}

export const syncMarkOnDelete = async (item: any) => {
  const blockId = typeof item === 'string' ? item : item?.blockId
  if (!blockId || !await shouldSyncOnDelete()) return false
  await (await import('@/api')).deleteBlock(blockId)
  return true
}

export const saveMarkEdit = async (mark: any, updates: any, ctx: any) => {
  if (!ctx.marks) throw new Error('标注系统未初始化')
  await ctx.marks.updateMark(mark, updates)
  updates.tags?.length && await (await import('@/composables/useSetting')).collectAnnotationTagPresets(updates.tags).catch(() => {})
  try {
    if (await getBoundDocId(ctx.bookUrl)) await updateMarkInDoc({ ...mark, ...updates }, ctx)
  } catch {}
}

let _plugin: any
let _floatTimer = 0

export const setPlugin = (p: any) => _plugin = p
export const openBlock = (id: string) => { hideFloat(); window.open(`siyuan://blocks/${id}`) }
export const showFloat = (id: string, el: HTMLElement) => { hideFloat(); _floatTimer = window.setTimeout(() => _plugin?.addFloatLayer?.({ refDefs: [{ refID: id }], targetElement: el, isBacklink: false }), 620) }
export const hideFloat = () => { if (_floatTimer) clearTimeout(_floatTimer); _floatTimer = 0 }

export const openNoteTargetFloat = async (bookUrl: string, settings: any, el: HTMLElement) => {
  const book = await getShelfBook(bookUrl)
  const boundId = book?.bindDocId || ''
  const target = settings?.noteInsertTarget || 'clipboard'
  const docId = boundId
    || (target === 'document' ? settings?.parentDoc?.id || '' : '')
    || (target === 'current' ? await (await import('@/utils/noteInsert')).getCurrentDocId() : '')
  if (!docId) throw new Error(target === 'clipboard' ? '请先绑定文档或将插入位置设为文档/打开文档' : '未找到目标文档')
  hideFloat()
  _plugin?.addFloatLayer?.({ refDefs: [{ refID: docId }], targetElement: el, isBacklink: false })
}
