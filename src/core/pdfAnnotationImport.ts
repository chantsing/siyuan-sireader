import { migratePdfRecord, normalizeEmbedPdfAnnotations } from './dataMigration'
import type { BookRecord } from './bookStore'

const color = (value: any, fallback = '#FFCD45') => String(value || fallback)
const text = (value: any) => String(value || '').trim()
const arr = (value: any) => Array.isArray(value) ? value : value == null ? [] : [value]
const pageIndex = (item: any, pos: any = {}) => Math.max(0, Number(item.pageIndex ?? pos.pageIndex ?? item.page ?? item.pageNo ?? item.pageNumber ?? item.annotationPageLabel ?? 1) - (item.pageIndex != null || pos.pageIndex != null ? 0 : 1) || 0)
const rect = (value: any = {}) => Array.isArray(value)
  ? { origin: { x: Number(value[0] || 0), y: Number(value[1] || 0) }, size: { width: Math.max(1, Math.abs(Number(value[2] ?? value[0] ?? 0) - Number(value[0] || 0))), height: Math.max(1, Math.abs(Number(value[3] ?? value[1] ?? 0) - Number(value[1] || 0))) } }
  : { origin: { x: Number(value.x ?? value.left ?? value.origin?.x ?? 0), y: Number(value.y ?? value.top ?? value.origin?.y ?? 0) }, size: { width: Math.max(1, Number(value.w ?? value.width ?? value.size?.width ?? 1)), height: Math.max(1, Number(value.h ?? value.height ?? value.size?.height ?? 1)) } }
const bounds = (rects: any[]) => {
  const xs = rects.flatMap(r => [r.origin.x, r.origin.x + r.size.width]), ys = rects.flatMap(r => [r.origin.y, r.origin.y + r.size.height])
  return rects.length ? { origin: { x: Math.min(...xs), y: Math.min(...ys) }, size: { width: Math.max(...xs) - Math.min(...xs) || 1, height: Math.max(...ys) - Math.min(...ys) || 1 } } : rect()
}
const id = (prefix: string, index: number) => `${prefix}-${Date.now()}-${index}`
const tryJson = (value: any) => { try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null } }
const flatItems = (value: any): any[] => {
  if (Array.isArray(value)) return value.flatMap(flatItems)
  if (!value || typeof value !== 'object') return []
  if (value.annotation || value.annotationType || value.type || value.text || value.note) return [value]
  return ['annotations', 'items', 'highlights', 'notes', 'data', 'annotation', 'children', 'documents', 'pages'].flatMap(key => flatItems(value[key]))
}
const isEmbed = (item: any) => typeof (item?.annotation || item)?.type === 'number'
const typeOf = (value: any) => String(value.type || value.annotationType || value.kind || value.subtype || value.markupType || '').toLowerCase()

const fromGeneric = (item: any, index: number) => {
  const a = item.annotation || item
  if (isEmbed(item)) return item.annotation ? item : { annotation: a }
  const pos = tryJson(a.annotationPosition || a.position || a.pos) || {}
  const type = typeOf(a)
  const rects = arr(a.segmentRects || a.rects || pos.rects || pos.rect || a.areas || a.quads || a.quadPoints || a.coords).map(rect)
  const box = rects.length ? bounds(rects) : rect(a.rect || pos.rect)
  const note = text(a.note || a.annotationComment || a.comment || a.memo)
  const quote = text(a.text || a.annotationText || a.quote || a.highlight || a.markedText)
  const common = { id: text(a.id || a.key) || id('import', index), pageIndex: pageIndex(a, pos), created: a.created || a.dateAdded || a.createdAt || new Date().toISOString(), modified: a.modified || a.dateModified || a.updatedAt || new Date().toISOString(), contents: note, custom: { text: quote, note } }
  if (type.includes('ink')) return { annotation: { ...common, type: 15, rect: box, inkList: arr(a.inkList || a.paths).map((p: any) => ({ points: arr(p.points) })), strokeColor: color(a.color || a.annotationColor, '#E44234'), color: color(a.color || a.annotationColor, '#E44234'), opacity: 1, strokeWidth: Number(a.strokeWidth || 2) } }
  if ((type.includes('text') || type.includes('free')) && !quote) return { annotation: { ...common, type: 3, rect: box, unrotatedRect: box, fontSize: 14, fontColor: '#000000', fontFamily: 4, color: 'transparent', backgroundColor: 'transparent', opacity: 1 } }
  if (type.includes('note') && !rects.length) return { annotation: { ...common, type: 2, rect: box, strokeColor: color(a.color || a.annotationColor), opacity: 1 } }
  if (type.includes('circle')) return { annotation: { ...common, type: 6, rect: box, color: 'transparent', strokeColor: color(a.color || a.annotationColor, '#E44234'), strokeWidth: Number(a.strokeWidth || 2), opacity: 1 } }
  if (type.includes('square') || type.includes('rect')) return { annotation: { ...common, type: 5, rect: box, color: 'transparent', strokeColor: color(a.color || a.annotationColor, '#E44234'), strokeWidth: Number(a.strokeWidth || 2), opacity: 1 } }
  if (type.includes('underline')) return { annotation: { ...common, type: 10, rect: box, segmentRects: rects.length ? rects : [box], strokeColor: color(a.color || a.annotationColor), color: color(a.color || a.annotationColor), opacity: 1 } }
  if (type.includes('strike')) return { annotation: { ...common, type: 11, rect: box, segmentRects: rects.length ? rects : [box], strokeColor: color(a.color || a.annotationColor), color: color(a.color || a.annotationColor), opacity: 1 } }
  return { annotation: { ...common, type: 9, rect: box, segmentRects: rects.length ? rects : [box], strokeColor: color(a.color || a.annotationColor), color: color(a.color || a.annotationColor), opacity: 1 } }
}

const parseJson = async (raw: any) => {
  const items = flatItems(raw)
  if (!items.length) return []
  const embed = items.some(isEmbed) ? normalizeEmbedPdfAnnotations(items) : []
  if (embed.length) return embed
  const migrated = await migratePdfRecord({ version: 1, book: {}, annotations: items, updatedAt: Date.now() } as BookRecord)
  const fromMigration = normalizeEmbedPdfAnnotations(migrated.record.annotations)
  return fromMigration.length ? fromMigration : normalizeEmbedPdfAnnotations(items.map(fromGeneric))
}

const parseXfdf = (source: string) => {
  const items: any[] = []
  const unescape = (s = '') => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  const tagRe = /<(highlight|underline|strikeout|squiggly|text|ink|square|circle)\b([^>]*)>([\s\S]*?)<\/\1>|<(highlight|underline|strikeout|squiggly|text|ink|square|circle)\b([^/>]*)\/>/gi
  const attr = (s: string, name: string) => s.match(new RegExp(`${name}="([^"]*)"`, 'i'))?.[1] || ''
  for (const m of source.matchAll(tagRe)) {
    const kind = (m[1] || m[4]).toLowerCase(), attrs = m[2] || m[5] || '', body = m[3] || ''
    const nums = (attr(attrs, 'coords') || attr(attrs, 'quadPoints') || attr(attrs, 'rect')).split(/[,\s]+/).map(Number).filter(Number.isFinite)
    const rects = Array.from({ length: Math.floor(nums.length / 4) }, (_, i) => rect(nums.slice(i * 4, i * 4 + 4)))
    items.push(fromGeneric({ type: kind, pageIndex: Number(attr(attrs, 'page') || 0), rects, color: attr(attrs, 'color'), note: unescape(body.replace(/<[^>]+>/g, '').trim()) }, items.length))
  }
  return normalizeEmbedPdfAnnotations(items)
}

const parseText = (source: string) => {
  const blocks = source.split(/\n{2,}/).map(s => s.trim()).filter(Boolean)
  return normalizeEmbedPdfAnnotations(blocks.map((block, i) => {
    const page = Number(block.match(/(?:page|p\.?|页码|第)\s*[:：#]?\s*(\d+)/i)?.[1] || 1)
    const quote = block.match(/(?:^>\s*|原文[:：]|highlight[:：])(.+)/im)?.[1]?.trim() || ''
    const note = block.replace(/(?:^>\s*.*$|.*(?:原文|highlight)[:：].*$|.*(?:page|p\.?|页码|第)\s*[:：#]?\s*\d+.*$)/gim, '').replace(/^(?:笔记|批注|note)[:：]/im, '').trim()
    return fromGeneric({ type: 'highlight', page, text: quote, note }, i)
  }))
}

export const parsePdfAnnotationImport = async (source: string, name = '') => {
  const raw = tryJson(source)
  const annotations = raw ? await parseJson(raw) : /\.xfdf$/i.test(name) || /<xfdf|<annots/i.test(source) ? parseXfdf(source) : parseText(source)
  return normalizeEmbedPdfAnnotations(annotations)
}

const pickAnnotationFiles = () => new Promise<File[]>((resolve) => {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,.xfdf,.md,.markdown,.txt', multiple: true }) as HTMLInputElement
  input.onchange = () => resolve([...input.files || []])
  input.click()
})

export const importPdfAnnotationsForBook = async (url: string) => {
  const files = await pickAnnotationFiles()
  if (!files.length) return { canceled: true, imported: 0, skipped: 0, total: 0 }
  const { readEmbedPdfAnnotations, writeEmbedPdfAnnotations } = await import('./bookStore')
  const incoming = (await Promise.all(files.map(async file => parsePdfAnnotationImport(await file.text(), file.name)))).flat()
  const current = await readEmbedPdfAnnotations(url) || []
  const seen = new Set(current.map(item => item?.annotation?.id).filter(Boolean))
  const added = incoming.filter(item => {
    const key = item?.annotation?.id
    return !key || !seen.has(key) && seen.add(key)
  })
  if (added.length) await writeEmbedPdfAnnotations(url, [...current, ...added])
  return { canceled: false, imported: added.length, skipped: incoming.length - added.length, total: incoming.length }
}
