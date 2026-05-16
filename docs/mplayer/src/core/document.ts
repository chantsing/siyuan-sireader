import { showMessage } from 'siyuan'
import * as api from '@/api'

export type MediaItem = Record<string, any>
export type ClipboardPayload = { text: string; image?: Blob }
export const humanizeText = (v = '') => { try { return decodeURIComponent(String(v || '')) } catch { return String(v || '') } }
export const humanizeUrl = (v = '') => { try { const s = String(v || '').trim(), u = new URL(s, location.origin), r = `${humanizeText(u.pathname)}${u.search}${u.hash}`; return /^\/(?:assets|public|data|plugins|stage)(?:\/|$)/i.test(u.pathname) ? r : /^[a-z]+:\/\//i.test(s) ? `${u.origin}${r}` : r } catch { const s = String(v || '').trim(), i = s.search(/[?#]/); return `${humanizeText(i < 0 ? s : s.slice(0, i))}${i < 0 ? '' : s.slice(i)}` } }
const imageToAsset = async (image: string | Blob, prefix = 'image') => (await import('@/core/player')).imageToAsset(image, prefix)

type Block = { id?: string; root_id?: string }
type InsertMode = 'insertBlock' | 'prependBlock' | 'appendBlock' | 'updateBlock' | 'prependDoc' | 'appendDoc' | 'clipboard'
type ProtyleLike = {
  element?: HTMLElement
  lute?: { Md2BlockDOM: (markdown: string) => string }
  toolbar?: { range?: Range | null }
  getInstance?: () => { insert?: (html: string, isBlock?: boolean, useProtyleRange?: boolean) => void }
}

const notify = (text: string, type: 'info' | 'error' = 'info') => showMessage(text, type === 'error' ? 3000 : 2000, type)
const isWindowPlayer = () => /\/window\.html$/i.test(location.pathname)
const pickId = (value: any) => typeof value === 'string' ? value : value?.id || ''
const pickNotebookId = (settings: Record<string, any>, fallback?: any) => pickId(fallback) || pickId(settings.notebook) || pickId(settings.targetNotebook)
const sanitizeTitle = (title: string, fallback: string) => ((title || fallback).replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || fallback)
const createDocName = (title: string) => `${sanitizeTitle(title, '媒体')}的媒体笔记`
const escapeSql = (value = '') => String(value).replace(/'/g, "''")
const getSelectionRange = () => window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null
const getBroadcastUrl = (channel: string) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/broadcast?channel=${encodeURIComponent(channel)}`

const createBroadcast = (channel: string) => {
  let socket: WebSocket | null = null
  const listeners = new Set<(payload: Record<string, any>) => void>()
  const connect = () => {
    if (socket && socket.readyState < WebSocket.CLOSING) return
    socket = new WebSocket(getBroadcastUrl(channel))
    socket.onmessage = (event) => {
      try { listeners.forEach(listener => listener(JSON.parse(String(event.data || '{}')))) } catch {}
    }
    socket.onclose = () => { socket = null }
  }
  return {
    post: (payload: Record<string, any>) => api.request('/api/broadcast/postMessage', { channel, message: JSON.stringify(payload) }),
    on: (callback: (payload: Record<string, any>) => void) => {
      listeners.add(callback)
      connect()
      return () => {
        listeners.delete(callback)
        if (!listeners.size && socket) socket.close(), socket = null
      }
    },
  }
}

const documentBroadcast = createBroadcast('siyuan-media-player-document')
const shouldBridgeCurrentInsert = (mode: string, settings: Record<string, any>) => mode === 'current' && (settings?.insertMode || 'clipboard') !== 'clipboard' && isWindowPlayer()

const requestDocumentInsert = (text: string, settings: Record<string, any>) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('未找到当前编辑器')) }, 1200)
    const off = documentBroadcast.on((payload) => {
      if (payload.type !== 'document-insert-ack' || payload.requestId !== requestId) return
      clearTimeout(timer)
      off()
      payload.ok ? resolve() : reject(new Error(payload.message || '插入失败'))
    })
    void documentBroadcast.post({ type: 'document-insert', requestId, text, settings })
  })
}

const toClipboardImage = async (image?: Blob) => {
  if (!image) return null
  if (image.type === 'image/png') return image
  try {
    const bitmap = await createImageBitmap(image)
    const canvas = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height })
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    bitmap.close?.()
    return await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  } catch {
    return null
  }
}

export const copyToClipboard = async (payload: ClipboardPayload | string) => {
  const data = typeof payload === 'string' ? { text: payload } : payload
  const writeText = () => navigator.clipboard.writeText(data.text).then(() => notify('已复制到剪贴板'))
  if (!data.image) return writeText()
  const image = await toClipboardImage(data.image)
  if (!image) return writeText()
  await navigator.clipboard.write([new ClipboardItem({
    'image/png': image,
    'text/plain': new Blob([data.text], { type: 'text/plain' }),
  })])
  notify('已复制到剪贴板')
}

const getNodeId = (node?: Node | null) => {
  let element = (node instanceof HTMLElement ? node : node?.parentElement) as HTMLElement | null
  while (element && !element.dataset?.nodeId) element = element.parentElement
  return element?.dataset?.nodeId || ''
}

const findProtyle = (range = getSelectionRange()): ProtyleLike | null => {
  const editor = (range?.startContainer instanceof Element ? range.startContainer : range?.startContainer?.parentElement)?.closest('.protyle') as HTMLElement | null
  if (!editor) return null
  const seen = new Set<any>()
  const visit = (value: any): ProtyleLike | null => {
    if (!value) return null
    if (Array.isArray(value)) {
      for (const item of value) {
        const hit = visit(item)
        if (hit) return hit
      }
      return null
    }
    if (seen.has(value)) return null
    seen.add(value)
    if (value?.protyle?.element === editor) return value.protyle
    return visit([
      value?.model?.editor,
      value?.model?.editors?.edit,
      value?.model?.editors?.unRefEdit,
      ...(Array.isArray(value?.model?.editors) ? value.model.editors : []),
      ...(Array.isArray(value?.children) ? value.children : []),
      ...(Array.isArray(value?.editors) ? value.editors : []),
      ...Object.values(value?.editors || {}),
    ])
  }
  const siyuan = (window as any).siyuan
  return visit([siyuan?.layout?.layout, siyuan?.dialogs, siyuan?.blockPanels])
}

const insertAtCursor = (content: string) => {
  const protyle = findProtyle()
  const instance = protyle?.getInstance?.()
  if (typeof instance?.insert !== 'function' || !protyle?.lute) return false
  instance.insert(protyle.lute.Md2BlockDOM(content), false, true)
  return true
}

const findActiveDocId = () => {
  for (const selector of [
    '.layout__wnd--active .protyle-background',
    '.layout__wnd--active .protyle-title',
    '.layout__wnd--active [data-node-id]',
    '.protyle.fn__flex-1:not(.fn__none) .protyle-background',
    '.protyle.fn__flex-1:not(.fn__none) .protyle-title',
  ]) {
    const id = (document.querySelector(selector) as HTMLElement | null)?.dataset?.nodeId || ''
    if (id) return id
  }
  return String((window as any).__activeDocumentId || '')
}

const getCurrentBlockId = (range = getSelectionRange()) =>
  getNodeId(range?.startContainer || null)
  || getNodeId(findProtyle(range)?.toolbar?.range?.startContainer || null)
  || getNodeId(document.activeElement)
  || ''

const getCurrentDocId = async (blockId = '') => {
  if (!blockId) return findActiveDocId()
  const block = await api.getBlockByID(blockId) as Block
  return block?.root_id || block?.id?.split('/')[0] || findActiveDocId()
}

const writeBlock = (mode: InsertMode, content: string, blockId: string, docId: string) => ({
  updateBlock: () => api.updateBlock('markdown', content, blockId),
  prependBlock: () => api.insertBlock('markdown', content, blockId),
  appendBlock: () => api.insertBlock('markdown', content, undefined, blockId),
  prependDoc: () => api.prependBlock('markdown', content, docId),
  appendDoc: () => api.appendBlock('markdown', content, docId),
  insertBlock: () => api.insertBlock('markdown', content, undefined, blockId),
}[mode] || (() => api.insertBlock('markdown', content, undefined, blockId)))()

export const insertByMode = async (content: ClipboardPayload | string, settings: Record<string, any>) => {
  const mode = (settings?.insertMode || 'clipboard') as InsertMode
  if (mode === 'clipboard') return copyToClipboard(content)
  const text = typeof content === 'string' ? content : content.image && !content.text ? `![截图](${await imageToAsset(content.image, 'screenshot')})` : content.text || ''
  if (mode === 'insertBlock' && insertAtCursor(text)) return
  const blockId = getCurrentBlockId()
  const docId = await getCurrentDocId(blockId)
  if (!docId) throw new Error('未找到当前文档')
  if (!blockId) return mode === 'prependBlock' ? api.prependBlock('markdown', text, docId) : api.appendBlock('markdown', text, docId)
  await writeBlock(mode, text, blockId, docId)
}

export const getMediaNoteKey = (item?: MediaItem) => {
  const source = item?.source || 'media'
  const url = String(item?.originalUrl || item?.url || '').replace(/[?#].*$/, '')
  return item?.bvid
    ? `bili:${item.bvid}:${item?.cid || ''}`
    : item?.epid || item?.seasonId
      ? `pgc:${item?.epid || item?.seasonId}`
      : [source, item?.id, item?.sourcePath, item?.localPath, item?.cloudPath, item?.path, url, item?.title || item?.name || 'media'].filter(Boolean).join('|')
}

export const getDocIdByAttr = async (name: string, value: string) => !name || !value ? '' : (await api.sql(`
  SELECT b.id
  FROM blocks b
  JOIN attributes a ON a.block_id = b.id
  WHERE b.type = 'd' AND a.name = '${escapeSql(name)}' AND a.value = '${escapeSql(value)}'
  LIMIT 1
`).catch(() => []))?.[0]?.id || ''

const getTargetNotebookId = (settings: Record<string, any>) => {
  const id = pickNotebookId(settings, settings.parentDoc?.notebook)
  if (!id) throw new Error('未设置目标笔记本')
  return id
}

const openCreatedDoc = (id?: string, settings?: Record<string, any>) => id && settings?.openAfterInsert !== false && setTimeout(() => (window as any).siyuanMediaPlayer?.openDocumentTab?.(id), 600)
const getParentHPath = async (settings: Record<string, any>, parentID?: string) =>
  !parentID ? '' : await api.getHPathByPath(getTargetNotebookId(settings), (await api.getPathByID(parentID).catch(() => null))?.path || '').catch(() => '')

export const appendToNoteDoc = async (
  title: string,
  settings: Record<string, any>,
  text: string,
  key: string,
  parentID?: string,
  attr = 'custom-media-note-key',
  docName = createDocName(title),
  extraAttrs: Record<string, string> = {},
  appendOnReuse = true,
) => {
  const id = await getDocIdByAttr(attr, key)
  if (id) {
    if (appendOnReuse) await api.appendBlock('markdown', text, id)
    return { id, reused: true }
  }
  const path = `${(await getParentHPath(settings, parentID)) || ''}/${docName}`.replace(/\/+/g, '/')
  const created = String(await api.createDocWithMd(getTargetNotebookId(settings), path, text, parentID) || '')
  if (!created) return { id: '', reused: false }
  await api.setBlockAttrs(created, { [attr]: key, ...extraAttrs })
  notify(attr === 'custom-ai-summary-key' ? '已创建 AI 总结文档' : '已创建媒体笔记')
  openCreatedDoc(created, settings)
  return { id: created, reused: false }
}

export const createAiSummaryDoc = async (
  text: string,
  settings: Record<string, any>,
  options: { title?: string; summaryKey?: string; sourcePath?: string } = {},
) => {
  const title = humanizeText(String(options.title || 'AI总结'))
  const summaryKey = String(options.summaryKey || '').trim() || title
  const extraAttrs = options.sourcePath ? { 'custom-media-source-path': String(options.sourcePath || '') } : {}
  const docName = `${sanitizeTitle(title, 'AI总结')}的AI总结`
  const mode = settings?.aiSummaryInsertMode === 'document' || settings?.aiSummaryInsertMode === 'dailynote'
    ? String(settings.aiSummaryInsertMode)
    : 'notebook'
  if (mode === 'dailynote') {
    const daily = await api.createDailyNote(getTargetNotebookId(settings))
    await api.appendBlock('markdown', text, daily.id)
    await api.setBlockAttrs(daily.id, { 'custom-ai-summary-key': summaryKey, ...extraAttrs })
    notify('已创建 AI 总结文档')
    openCreatedDoc(daily.id, settings)
    return { id: String(daily?.id || ''), reused: false }
  }
  return appendToNoteDoc(title, settings, text, summaryKey, mode === 'document' ? getParentDocId(settings) : undefined, 'custom-ai-summary-key', docName, extraAttrs)
}

export const getParentDocId = (settings: Record<string, any>) => {
  const id = pickId(settings.parentDoc)
  if (!id) throw new Error('未设置目标文档')
  return id
}

export const insertByTarget = async (content: ClipboardPayload | string, settings: Record<string, any>, title = '媒体', key = title) => {
  const mode = settings.mediaNotesMode || 'current'
  const text = typeof content === 'string' ? content : content.image && !content.text ? `![截图](${await imageToAsset(content.image, 'screenshot')})` : content.text || ''
  if (shouldBridgeCurrentInsert(mode, settings)) return requestDocumentInsert(text, settings)
  return (
    {
      current: () => insertByMode(content, settings),
      dailynote: async () => {
        const daily = await api.createDailyNote(getTargetNotebookId(settings))
        await api.appendBlock('markdown', text, daily.id)
        openCreatedDoc(daily.id, settings)
      },
      document: () => appendToNoteDoc(title, settings, text, key, getParentDocId(settings)),
      notebook: () => appendToNoteDoc(title, settings, text, key),
    }[mode] || (() => copyToClipboard(content))
  )()
}

export const createMediaNote = async (item: MediaItem, settings: Record<string, any>, payload: ClipboardPayload) =>
  insertByTarget(payload, settings, humanizeText(String(item?.title || item?.name || '媒体')), getMediaNoteKey(item))

export const notebook = {
  getList: async () => ((await api.lsNotebooks())?.notebooks || []).filter((item: any) => !item.closed),
  selectNotebook: (state: Record<string, any>, id: string, items: any[] = []) => state.notebook = ((current: any) => current ? { id: current.id, name: current.name } : { id, name: '' })(items.find((item: any) => item.id === id)),
  selectDocument: (state: Record<string, any>, value: string, items: any[] = []) => {
    const current = items.find((item: any) => item.value === value)
    if (!current) return
    state.parentDoc = { id: String(current.path || current.value).split('/').pop() || '', name: current.label, path: current.path || current.value, notebook: current.notebook }
    state.targetDocumentSearch = current.label
  },
  searchAndUpdate: async (keyword: string, state?: Record<string, any>) => {
    if (!keyword.trim()) return { success: false, docs: [] }
    const docs = (await api.searchDocs(keyword.trim()).catch(() => [])).map((doc: any) => ({
      label: doc.hPath || '无标题',
      value: (doc.path || '').replace(/^\/+|\.sy$/g, ''),
      path: (doc.path || '').replace(/^\/+|\.sy$/g, ''),
      notebook: doc.box,
    })).filter((doc: any) => doc.value)
    if (state && docs[0]) notebook.selectDocument(Object.assign(state, { notebook: { id: docs[0].notebook, name: '' } }), docs[0].value, docs)
    return { success: !!docs.length, docs }
  },
}

documentBroadcast.on(async (payload) => {
  if (isWindowPlayer() || payload.type !== 'document-insert' || !payload.requestId) return
  try { await insertByMode(payload.text || '', payload.settings || {}) } catch (error: any) {
    return void await documentBroadcast.post({ type: 'document-insert-ack', requestId: payload.requestId, ok: false, message: error?.message || '插入失败' })
  }
  await documentBroadcast.post({ type: 'document-insert-ack', requestId: payload.requestId, ok: true })
})
