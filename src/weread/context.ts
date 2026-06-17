import { callWereadAgentDirect, getWereadChapterReadUrl, getWereadReadUrl, wereadBookIdOf } from './agent'

type CallApi = (apiName: string, params?: Record<string, unknown>, rawKey?: string) => Promise<any>

const infoOf = (book: any) => book?.bookInfo || book?.book || book || {}
const bookIdOf = (book: any) => String(infoOf(book)?.bookId || book?.bookId || book?.privateData?.bookId || book?.identifier || '')
const titleOf = (book: any) => String(infoOf(book)?.title || infoOf(book)?.name || '微信读书')
const authorOf = (book: any) => String(infoOf(book)?.author || infoOf(book)?.authorName || '')
export const getWereadChapterUid = (item: any) => Number(item?.chapterUid || item?.chapterId || item?.uid || 0)
const timestampOf = (value: any) => {
  const time = Number(value || Date.now())
  return time < 10_000_000_000 ? time * 1000 : time
}

export const getWereadMarkColor = (item: any) => {
  const colors = ['yellow', 'blue', 'green', 'red', 'purple', 'orange', 'pink']
  return colors[Number(item?.colorStyle || 0)] || 'yellow'
}
const chapterUrlOf = (bookId: string, uid: number) => getWereadChapterReadUrl(bookId, uid)
export const getWereadChapterTitle = (chapters: any[], uid: number) => chapters.find(item => getWereadChapterUid(item) === Number(uid))?.title || `章节 ${uid || '-'}`

export const toWereadHighlightMark = (item: any, index: number, source: string, bookId: string, chapters: any[]) => {
  const uid = getWereadChapterUid(item)
  return {
    ...item,
    id: `${source}-${String(item?.bookmarkId || item?.reviewId || `${uid}-${item?.range || index}`)}`,
    type: item?.note ? 'note' : 'highlight',
    cfi: `${chapterUrlOf(bookId, uid)}#${encodeURIComponent(String(item?.range || index))}`,
    text: String(item?.markText || item?.abstract || item?.text || ''),
    note: [source, item?.totalCount ? `${item.totalCount} 人划线` : '', item?.note || ''].filter(Boolean).join('\n'),
    color: getWereadMarkColor(item),
    style: 'underline',
    timestamp: timestampOf(item?.createTime || item?.updateTime),
    chapter: getWereadChapterTitle(chapters, uid),
    chapterUid: uid,
    tags: [source],
  }
}

export const toWereadReviewMark = (item: any, index: number, source: string, bookId: string, chapters: any[]) => {
  const review = item?.review?.review || item?.review || item
  const uid = getWereadChapterUid(review)
  return {
    ...review,
    id: `${source}-${String(review?.reviewId || `review-${uid}-${index}`)}`,
    type: 'note',
    cfi: `${chapterUrlOf(bookId, uid)}#review-${index}`,
    text: String(review?.abstract || review?.content || ''),
    note: [source, review?.content || ''].filter(Boolean).join('\n'),
    color: 'blue',
    style: 'outline',
    timestamp: timestampOf(review?.createTime || review?.updateTime),
    chapter: String(review?.chapterName || getWereadChapterTitle(chapters, uid)),
    chapterUid: uid,
    tags: [source],
  }
}

export const toWereadBookmarkMark = (item: any, index: number, bookId: string, chapters: any[]) => {
  const uid = getWereadChapterUid(item)
  const chapter = getWereadChapterTitle(chapters, uid)
  return {
    ...item,
    id: `bookmark-${String(item?.bookmarkId || `${uid}-${item?.range || index}`)}`,
    type: 'bookmark',
    cfi: `${chapterUrlOf(bookId, uid)}#bookmark-${encodeURIComponent(String(item?.range || index))}`,
    title: chapter,
    text: String(item?.markText || ''),
    timestamp: timestampOf(item?.createTime || item?.updateTime),
    chapter,
    chapterUid: uid,
    tags: ['书签'],
  }
}

const toTocTree = (chapters: any[], bookId: string) => {
  const roots: any[] = []
  const stack: Array<{ level: number; item: any }> = []
  chapters.forEach((chapter, index) => {
    const uid = getWereadChapterUid(chapter) || index + 1
    const level = Math.max(1, Number(chapter?.level || 1))
    const item = {
      id: uid,
      label: String(chapter?.title || `章节 ${uid}`),
      href: chapterUrlOf(bookId, uid),
      subitems: [] as any[],
    }
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
    const parent = stack[stack.length - 1]?.item
    ;(parent?.subitems || roots).push(item)
    stack.push({ level, item })
  })
  const clean = (items: any[]): any[] => items.map(item => {
    const next = { ...item }
    if (next.subitems.length) next.subitems = clean(next.subitems)
    else delete next.subitems
    return next
  })
  return clean(roots)
}

export const createWereadReaderContext = (options: { book: any; apiKey: string; callApi?: CallApi }) => {
  const book = { ...infoOf(options.book), bookId: bookIdOf(options.book) }
  const bookId = bookIdOf(book)
  const bookUrl = getWereadReadUrl(bookId)
  const callApi: CallApi = options.callApi || ((apiName, params = {}) => callWereadAgentDirect(options.apiKey, apiName, params))
  let chapters: any[] = []
  let highlights: any[] = []
  let bookmarks: any[] = []
  let bestBookmarks: any[] = []
  let reviews: any[] = []
  let publicReviews: any[] = []
  let currentHref = ''
  let destroyed = false
  let navigate: ((target: { chapterUid: number; title: string; text?: string; url: string }) => Promise<void> | void) | null = null

  const chapterUidFromUrl = (url: string) => chapters.find(item => chapterUrlOf(bookId, getWereadChapterUid(item)) === url.split('#')[0])?.chapterUid || 0
  const notify = () => window.dispatchEvent(new Event('sireader:marks-updated'))
  const events = new EventTarget()
  const flattenToc = (items: any[]): any[] => items.flatMap(item => [item, ...flattenToc(item.subitems || [])])
  const getBookmarkMarks = () => bookmarks.map((item, index) => toWereadBookmarkMark(item, index, bookId, chapters))
  const getAnnotationMarks = () => [
    ...highlights.map((item, index) => toWereadHighlightMark(item, index, '我的划线', bookId, chapters)),
    ...bestBookmarks.map((item, index) => toWereadHighlightMark(item, index, '热门划线', bookId, chapters)),
    ...reviews.map((item, index) => toWereadReviewMark(item, index, '我的想法', bookId, chapters)).filter(item => item.text || item.note),
    ...publicReviews.map((item, index) => toWereadReviewMark(item, index, '公开想法', bookId, chapters)).filter(item => item.text || item.note),
  ]
  const view = {
    book: {
      toc: [] as any[],
      metadata: { title: titleOf(book), author: authorOf(book) },
    },
    settings: (window as any).__sireader_settings,
    isOnlineContext: true,
    disableMarkPreview: true,
    lastLocation: null as any,
    async goTo(href: string) {
      if (destroyed) return
      currentHref = href
      const mark = marks.getAnnotations().find((item: any) => item.cfi === href)
      const chapterUid = Number(mark?.chapterUid || chapterUidFromUrl(href) || 0)
      const url = chapterUrlOf(bookId, chapterUid)
      const tocItem = flattenToc(view.book.toc).find((item: any) => item.href === url)
      view.lastLocation = { cfi: href, href, tocItem }
      view.dispatchEvent(new CustomEvent('relocate', { detail: { tocItem } }))
      await navigate?.({ chapterUid, title: tocItem?.label || getWereadChapterTitle(chapters, chapterUid), text: mark?.text || '', url })
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  } as any

  const marks = {
    getAnnotations: getAnnotationMarks,
    getBookmarks: getBookmarkMarks,
    getInkAnnotations: () => [],
    getShapeAnnotations: () => [],
    getAll: () => [...getBookmarkMarks(), ...getAnnotationMarks()],
    updateMark: async (mark: any, updates: any) => {
      Object.assign(mark, updates)
      notify()
      return true
    },
    deleteMark: async (mark: any) => {
      const id = typeof mark === 'string' ? mark : mark?.id
      highlights = highlights.filter((item, index) => toWereadHighlightMark(item, index, '我的划线', bookId, chapters).id !== id)
      bookmarks = bookmarks.filter((item, index) => toWereadBookmarkMark(item, index, bookId, chapters).id !== id)
      bestBookmarks = bestBookmarks.filter((item, index) => toWereadHighlightMark(item, index, '热门划线', bookId, chapters).id !== id)
      reviews = reviews.filter((item, index) => toWereadReviewMark(item, index, '我的想法', bookId, chapters).id !== id)
      publicReviews = publicReviews.filter((item, index) => toWereadReviewMark(item, index, '公开想法', bookId, chapters).id !== id)
      notify()
      return true
    },
  }

  const load = async () => {
    if (!bookId || destroyed) return
    const [chapterRes, progressRes, markRes, bookmarkRes, bestRes, reviewRes, publicRes] = await Promise.allSettled([
      callApi('/book/chapterinfo', { bookId }, 'chapterInfo'),
      callApi('/book/getprogress', { bookId }, 'progress'),
      callApi('/book/bookmarklist', { bookId }, 'bookmarkList'),
      callApi('/book/bookmarklist', { bookId, type: 0 }, 'bookmarks'),
      callApi('/book/bestbookmarks', { bookId, chapterUid: 0 }, 'bestBookmarks'),
      callApi('/review/list/mine', { bookid: bookId, count: 50 }, 'mineReviews'),
      callApi('/review/list', { bookId, count: 50 }, 'publicReviews'),
    ])
    if (destroyed) return
    chapters = chapterRes.status === 'fulfilled' ? chapterRes.value?.chapters || [] : []
    const progress = progressRes.status === 'fulfilled' ? progressRes.value?.book || progressRes.value : null
    highlights = markRes.status === 'fulfilled' ? markRes.value?.updated || [] : []
    bookmarks = bookmarkRes.status === 'fulfilled' ? bookmarkRes.value?.updated || [] : []
    bestBookmarks = bestRes.status === 'fulfilled' ? bestRes.value?.items || [] : []
    reviews = reviewRes.status === 'fulfilled' ? reviewRes.value?.reviews || [] : []
    publicReviews = publicRes.status === 'fulfilled' ? publicRes.value?.reviews || [] : []
    view.book.toc = toTocTree(chapters, bookId)
    const progressUid = Number(progress?.chapterUid || 0)
    currentHref = (progressUid ? chapterUrlOf(bookId, progressUid) : '') || view.book.toc[0]?.href || ''
    const tocItem = flattenToc(view.book.toc).find((item: any) => item.href === currentHref) || view.book.toc[0]
    view.lastLocation = currentHref ? { cfi: currentHref, href: currentHref, tocItem, progress: Number(progress?.progress || 0), chapterOffset: Number(progress?.chapterOffset || 0) } : null
    notify()
    window.dispatchEvent(new Event('sireader:tab-switched'))
    if (progressUid) await navigate?.({ chapterUid: progressUid, title: tocItem?.label || getWereadChapterTitle(chapters, progressUid), url: currentHref })
  }

  return {
    bookUrl,
    disableMarkPreview: true,
    activeView: view,
    activeReader: { marks, getBook: () => view.book, getView: () => view, getLocation: () => view.lastLocation, goTo: view.goTo },
    init: load,
    setNavigator: (fn: typeof navigate) => { navigate = fn },
    destroy: () => {
      destroyed = true
      navigate = null
      chapters = []
      highlights = []
      bookmarks = []
      bestBookmarks = []
      reviews = []
      publicReviews = []
      view.book.toc = []
      view.lastLocation = null
    },
  }
}

export const createWereadContextFromSource = (book: any, source?: { auth?: { password?: string; cookies?: string } } | null) => {
  const apiKey = source?.auth?.password?.trim() || source?.auth?.cookies?.trim() || ''
  return apiKey ? createWereadReaderContext({ book: { ...book, bookId: wereadBookIdOf(book) }, apiKey }) : undefined
}
