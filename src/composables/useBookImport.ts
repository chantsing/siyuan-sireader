import { computed, ref } from 'vue'
import { bookshelfManager } from '@/core/bookshelf'

export interface BookImportItem {
  id: string
  mode: 'url' | 'file'
  source: string | File
  linkSource: string
  label: string
  selected: boolean
  loading: boolean
  error: string
  preview: any | null
}

type ImportMode = 'file' | 'link'

const nextId = () => `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const asLines = (input: string) => input.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
const req = (id: string) => { try { return (window as any).require?.(id) } catch { return null } }
const getElectron = () => req('electron')?.remote || req('@electron/remote')
const getFs = () => req('fs')
const getPath = () => req('path')
const pickByInput = () => new Promise<File[]>((resolve) => {
  const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: '.epub,.pdf,.mobi,.azw3,.azw,.fb2,.cbz,.txt' }) as HTMLInputElement
  input.onchange = () => resolve(Array.from(input.files || []))
  input.click()
})
const normalizeNativePath = (value = '') => {
  if (!value) return ''
  const path = getPath()
  const raw = decodeURI(`${value}`).replace(/^file:\/+/, path?.sep === '\\' ? '' : '/')
  return path ? path.normalize(raw) : raw
}
const toLocalFile = (path: string, size: number, lastModified: number) => ((path = normalizeNativePath(path)), { name: path.split(/[\\/]/).pop() || 'file', size, type: '', lastModified, path } as File)
const materializeFile = (file: File): File => {
  const path = normalizeNativePath((file as any)?.path || (file as any)?._path || '')
  if (!path) return file
  const cached = (file as any)._realFile
  if (cached) return cached
  const fs = getFs()
  if (!fs) return file
  const realFile = new File([fs.readFileSync(path)], file.name || path.split(/[\\/]/).pop() || 'file', { type: file.type || '', lastModified: file.lastModified || Date.now() }) as File & { path?: string }
  Object.defineProperty(realFile, 'path', { value: path })
  ;(file as any)._realFile = realFile
  return realFile
}
const toFileUrl = (file: File) => {
  const path = normalizeNativePath((file as any)?.path || (file as any)?._path || '')
  if (!path) return ''
  return path.startsWith('/') ? `file://${encodeURI(path)}` : `file:///${path.replace(/\\/g, '/').replace(/^\/+/, '')}`
}
const chunked = async <T>(items: T[], limit: number, task: (item: T, index: number) => Promise<void>) => {
  for (let i = 0; i < items.length; i += limit) await Promise.all(items.slice(i, i + limit).map(task))
}
const revokeCover = (item: BookImportItem) => item.preview?.cover?.startsWith?.('blob:') && URL.revokeObjectURL(item.preview.cover)
const getImportFile = (item: BookImportItem) => materializeFile(item.source as File)
const createItem = (mode: BookImportItem['mode'], source: string | File, label: string, linkSource: string): BookImportItem => ({ id: nextId(), mode, source, linkSource, label, selected: true, loading: true, error: '', preview: null })

export const useBookImport = () => {
  const items = ref<BookImportItem[]>([])
  const draft = ref('')
  const parsing = ref(false)
  const importing = ref(false)
  const progress = ref(0)

  const reset = () => {
    items.value.forEach(revokeCover)
    items.value = []
    draft.value = ''
    parsing.value = false
    importing.value = false
    progress.value = 0
  }

  const parseItems = async (next: BookImportItem[], worker: (item: BookImportItem) => Promise<any>, concurrency = 3) => {
    parsing.value = true
    progress.value = 0
    items.value.forEach(revokeCover)
    items.value = next
    let done = 0
    await chunked(next, concurrency, async item => {
      try {
        item.preview = await worker(item)
        item.error = ''
      } catch (error) {
        item.preview = null
        item.error = error instanceof Error ? error.message : '解析失败'
        item.selected = false
      } finally {
        item.loading = false
        progress.value = Math.round((++done / next.length) * 100)
      }
    })
    parsing.value = false
  }

  const parseUrls = async (input = draft.value) => {
    const urls = asLines(input)
    if (!urls.length) return
    draft.value = input
    await parseItems(
      urls.map(url => createItem('url', url, url, url)),
      item => bookshelfManager.previewUrlBook(item.source as string),
      3,
    )
  }

  const parseFiles = async (files: File[]) => {
    if (!files.length) return
    await parseItems(
      files.map(file => createItem('file', file, file.name, toFileUrl(file))),
      item => bookshelfManager.previewLocalBook(getImportFile(item)),
      files.length > 8 ? 4 : 2,
    )
  }

  const selectFiles = async () => {
    const electron = getElectron()
    if (!electron) return await pickByInput()
    const fs = getFs()
    if (!fs) return await pickByInput()
    const result = await electron.dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'Books', extensions: ['epub', 'pdf', 'mobi', 'azw3', 'azw', 'fb2', 'cbz', 'txt'] }] })
    if (result.canceled || !result.filePaths.length) return []
    return result.filePaths.map((path: string) => {
      const stats = fs.statSync(path)
      return toLocalFile(path, stats.size, stats.mtimeMs)
    })
  }

  const importSelected = async (mode: ImportMode = 'file') => {
    const selected = items.value.filter(item => item.selected && !item.loading && !item.error)
    if (!selected.length) return { success: 0, failed: 0 }
    importing.value = true
    let success = 0
    let failed = 0
    const concurrency = mode === 'file' ? (selected.length > 8 ? 3 : 2) : 4
    const importFile = {
      file: (item: BookImportItem) => bookshelfManager.addLocalBook(getImportFile(item), item.preview),
      link: (item: BookImportItem) => bookshelfManager.addLocalLinkBook(getImportFile(item), item.preview),
    } satisfies Record<ImportMode, (item: BookImportItem) => Promise<void>>
    await chunked(selected, concurrency, async item => {
      try {
        if (item.mode === 'url') await bookshelfManager.addUrlBook(item.linkSource, undefined, undefined, item.preview)
        else if (mode === 'file' || item.linkSource) await importFile[mode](item)
        else throw new Error('当前环境不支持以链接方式导入本地文件')
        success++
      } catch {
        failed++
      }
    })
    importing.value = false
    return { success, failed }
  }

  const selectedCount = computed(() => items.value.filter(item => item.selected && !item.error).length)
  const linkSelectedCount = computed(() => items.value.filter(item => item.selected && !item.error && item.linkSource).length)
  const hasItems = computed(() => !!items.value.length)
  const allSelected = computed({
    get: () => !!items.value.length && items.value.every(item => item.error || item.selected),
    set: (value: boolean) => { items.value.forEach(item => { if (!item.error) item.selected = value }) }
  })

  return { items, draft, parsing, importing, progress, hasItems, selectedCount, linkSelectedCount, allSelected, reset, parseUrls, parseFiles, selectFiles, importSelected }
}
