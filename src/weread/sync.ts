import * as api from '@/api'
import { DEFAULT_WEREAD_EXPORT_TEMPLATE, type ReaderSettings } from '@/composables/useSetting'
import { ensureNoteDocument } from '@/utils/noteInsert'
import { imageSrcToMarkdown } from '@/utils/copy'
import { callWereadAgentDirect, getWereadChapterReadUrl, getWereadReadUrl, wereadBookIdOf } from './agent'

const BLOCK_ATTR = 'custom-sireader-weread-sync'
const coverCache = new Map<string, Promise<string>>()
const text = (value: unknown) => String(value ?? '').replace(/\r?\n/g, ' ').trim()
const escapeMarkdown = (value: unknown) => text(value).replace(/[\\`*_{}[\]()#+.!|>~-]/g, '\\$&')
const reviewOf = (item: any) => item?.review?.review || item?.review || item
const itemId = (item: any) => { const value = reviewOf(item); return text(item?.bookmarkId || item?.reviewId || item?.id || value?.reviewId || item?.range || `${value?.chapterUid || value?.chapterId || ''}:${value?.markText || value?.text || value?.content || ''}`) || JSON.stringify(item) }
const unique = <T>(items: T[], key: (item: T) => string) => [...new Map(items.map(item => [key(item), item])).values()]
const arrayOf = (value: any, ...keys: string[]) => {
  if (Array.isArray(value)) return value
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key]
  return []
}
const chapterTitle = (chapters: any[], uid: unknown) => text(chapters.find(item => String(item?.chapterUid || item?.chapterId || item?.uid) === String(uid))?.title) || `章节 ${uid || ''}`
const resultIds = (result: any) => (Array.isArray(result) ? result : [result]).flatMap(item => item?.doOperations || item || []).map((item: any) => item?.id).filter(Boolean)
const coverMarkdown = (url: string, bookId: string) => {
  if (!url) return Promise.resolve('')
  const cacheKey = `${bookId}:${url}`
  const cached = coverCache.get(cacheKey)
  if (cached) return cached
  const task = imageSrcToMarkdown(url, `weread-${bookId}`).catch(() => '')
  coverCache.set(cacheKey, task)
  return task
}

const load = async (apiKey: string, bookId: string) => {
  const requests: Array<[string, Promise<any>]> = [
    ['info', callWereadAgentDirect(apiKey, '/book/info', { bookId })],
    ['chapters', callWereadAgentDirect(apiKey, '/book/chapterinfo', { bookId })],
    ['highlights', callWereadAgentDirect(apiKey, '/book/bookmarklist', { bookId })],
    ['bookmarks', callWereadAgentDirect(apiKey, '/book/bookmarklist', { bookId, type: 0 })],
    ['mineReviews', callWereadAgentDirect(apiKey, '/review/list/mine', { bookid: bookId, count: 100 })],
    ['publicReviews', callWereadAgentDirect(apiKey, '/review/list', { bookId, count: 100 })],
  ]
  const responses = await Promise.allSettled(requests.map(([, request]) => request))
  const data = Object.fromEntries(requests.map(([key], index) => [key, responses[index].status === 'fulfilled' ? responses[index].value : {}]))
  return {
    info: data.info?.bookInfo || data.info?.book || data.info || {},
    chapters: arrayOf(data.chapters, 'chapters'),
    highlights: unique(arrayOf(data.highlights, 'updated', 'items'), itemId),
    bookmarks: unique(arrayOf(data.bookmarks, 'updated', 'items'), itemId),
    reviews: unique([...arrayOf(data.mineReviews, 'reviews', 'items'), ...arrayOf(data.publicReviews, 'reviews', 'items')], itemId),
  }
}

const render = async (book: any, data: Awaited<ReturnType<typeof load>>, template = DEFAULT_WEREAD_EXPORT_TEMPLATE) => {
  const bookId = wereadBookIdOf(book) || text(data.info.bookId)
  const title = text(data.info.title || book?.title || book?.name) || '微信读书'
  const coverUrl = text(data.info.cover || data.info.coverUrl || book?.coverUrl || book?.cover)
  const cover = await coverMarkdown(coverUrl, bookId)
  const chapterMarkdown = data.chapters.map((item: any) => {
    const chapterId = item.chapterUid || item.chapterId || item.uid
    const chapter = escapeMarkdown(item.title || '未命名章节')
    return `- [${chapter}](${getWereadChapterReadUrl(bookId, chapterId)})`
  }).join('\n') || '暂无内容'
  const markLink = (item: any, value: string) => {
    const chapterId = item.chapterUid || item.chapterId || item.uid
    const link = chapterId ? getWereadChapterReadUrl(bookId, chapterId) : getWereadReadUrl(bookId)
    return `- [${value}](${link})`
  }
  const reviewLine = (item: any, indent = '  - ') => {
    const review = reviewOf(item)
    const content = escapeMarkdown(review.abstract || review.content || review.text || review.review?.content)
    const stats = [[review.likesCount ?? review.likeCount, '赞'], [review.commentsCount ?? review.commentCount, '评']].filter(([value]) => value != null && value !== '').map(([value, label]) => `${value}${label}`).join(' · ')
    return `${indent}想法：${content}${stats ? `（${stats}）` : ''}`
  }
  const reviewMatches = (review: any, highlight: any) => {
    const item = reviewOf(review)
    return !!item.range && !!highlight.range && String(item.range) === String(highlight.range)
  }
  const highlightWithReviews = data.highlights.map(item => [
    markLink(item, escapeMarkdown(item.markText || item.text || item.content)),
    ...data.reviews.filter(review => reviewMatches(review, item)).map(review => reviewLine(review)),
  ].join('\n')).join('\n') || '暂无内容'
  const looseReviews = data.reviews.filter(review => !data.highlights.some(item => reviewMatches(review, item)))
  const sections = {
    目录: chapterMarkdown,
    划线: highlightWithReviews,
    划线与想法: highlightWithReviews,
    书签: data.bookmarks.map(item => markLink(item, escapeMarkdown(item.title || item.chapterTitle || chapterTitle(data.chapters, item.chapterUid)))).join('\n') || '暂无内容',
    想法: looseReviews.map(item => reviewLine(item, '- ')).join('\n') || '暂无内容',
  }
  const values: Record<string, string> = {
    书名: escapeMarkdown(title), 封面: cover, 作者: escapeMarkdown(data.info.author || data.info.authorName || '未知作者'),
    链接: `[打开微信读书](${getWereadReadUrl(bookId)})`, 详情链接: `[打开书籍详情](https://weread.qq.com/web/bookDetail/${encodeURIComponent(bookId)})`,
    bookId: escapeMarkdown(bookId), ISBN: escapeMarkdown(data.info.isbn || data.info.ISBN),
    出版社: escapeMarkdown(data.info.publisher), 分类: escapeMarkdown(data.info.category),
    出版时间: escapeMarkdown(data.info.publishTime || data.info.publishDate), 字数: escapeMarkdown(data.info.totalWords),
    阅读人数: escapeMarkdown(data.info.readingCount), 评分: escapeMarkdown(data.info.newRating || data.info.rating),
    简介: escapeMarkdown(data.info.intro || data.info.description) || '暂无简介', ...sections,
  }
  return String(template || DEFAULT_WEREAD_EXPORT_TEMPLATE).replace(/{{\s*([^}]+?)\s*}}/g, (_, key) => values[key] ?? '')
}

export const syncWereadBook = async (book: any, apiKey: string, settings: ReaderSettings, parentID?: string) => {
  const bookId = wereadBookIdOf(book)
  if (!bookId) throw new Error('缺少微信读书 bookId')
  const data = await load(apiKey, bookId)
  const title = text(data.info.title || book?.title || book?.name) || '微信读书'
  const docId = await ensureNoteDocument(title, settings, `weread:book:${bookId}`, parentID || settings.parentDoc?.id)
  const children = await api.getChildBlocks(docId).catch(() => [])
  const existing = await Promise.all(children.map(async child => [child.id, await api.getBlockAttrs(child.id).catch(() => ({}))] as const))
  const blockId = existing.find(([, attrs]) => attrs[BLOCK_ATTR] === bookId)?.[0]
  const content = await render(book, data, settings.wereadExportTemplate)
  if (blockId) await api.updateBlock('markdown', content, blockId)
  else {
    const ids = resultIds(await api.appendBlock('markdown', content, docId))
    if (ids[0]) await api.setBlockAttrs(ids[0], { [BLOCK_ATTR]: bookId })
  }
  return { bookId, docId, title, counts: { chapters: data.chapters.length, highlights: data.highlights.length, bookmarks: data.bookmarks.length, reviews: data.reviews.length } }
}

export const syncWereadBooks = async (books: any[], apiKey: string, settings: ReaderSettings, parentID?: string) => {
  const results: any[] = []
  for (const book of books) {
    try { results.push({ ok: true, ...(await syncWereadBook(book, apiKey, settings, parentID)) }) }
    catch (error) { results.push({ ok: false, bookId: wereadBookIdOf(book), error: error instanceof Error ? error.message : String(error) }) }
  }
  return results
}
