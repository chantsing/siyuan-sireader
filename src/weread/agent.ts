import type { HttpBook, HttpSourceConfig, HttpSourceExtension, HttpSourceHelpers, HttpSourceManager } from '@/utils/HttpSources'
import type { OnlineBookImportInfo } from '@/composables/useBookImport'

const GATEWAY_URL = 'https://i.weread.qq.com/api/agent/gateway'
const SKILL_VERSION = '1.0.3'

type WereadAgentResponse = Record<string, any>

const SOURCE: HttpSourceConfig = {
  id: 'weread-agent',
  name: '微信读书 Agent API',
  type: 'weread-agent',
  enabled: false,
  requiresAuth: true,
  url: 'https://weread.qq.com',
  filters: { extensions: [] },
}

const readUrlOf = (bookId: string) => bookId ? `https://weread.qq.com/web/reader/${encodeURIComponent(bookId)}` : ''
const detailUrlOf = (bookId: string) => bookId ? `https://weread.qq.com/web/bookDetail/${encodeURIComponent(bookId)}` : ''
const apiKeyOf = (source: HttpSourceConfig) =>
  source.auth?.password?.trim() || source.auth?.cookies?.trim() || ''

const md5 = (value: string) => {
  try {
    const crypto = (window as any).require?.('crypto')
    if (crypto?.createHash) return crypto.createHash('md5').update(value).digest('hex')
  } catch {}
  return ''
}

const getFa = (bookId: string): [string, string[]] => {
  const id = String(bookId || '')
  if (/^\d*$/.test(id)) {
    const parts: string[] = []
    for (let index = 0; index < id.length; index += 9) {
      const part = id.slice(index, Math.min(index + 9, id.length))
      parts.push(parseInt(part, 10).toString(16))
    }
    return ['3', parts]
  }
  let encoded = ''
  for (let index = 0; index < id.length; index += 1) encoded += id.charCodeAt(index).toString(16)
  return ['4', [encoded]]
}

const pcHashOf = (bookId: string) => {
  const id = String(bookId || '')
  const digest = md5(id)
  if (!id || !digest) return ''
  const fa = getFa(id)
  let value = `${digest.slice(0, 3)}${fa[0]}2${digest.slice(-2)}`
  fa[1].forEach((part, index) => {
    const length = part.length.toString(16)
    value += `${length.length === 1 ? `0${length}` : length}${part}${index < fa[1].length - 1 ? 'g' : ''}`
  })
  if (value.length < 20) value += digest.slice(0, 20 - value.length)
  value += md5(value).slice(0, 3)
  return value
}
const pcReadUrlOf = (bookId: string) => {
  const hash = pcHashOf(bookId)
  return hash ? `https://weread.qq.com/web/reader/${hash}` : readUrlOf(bookId)
}
const pcChapterReadUrlOf = (bookId: string, chapterUid: string | number) => {
  const bookHash = pcHashOf(bookId)
  const chapterHash = pcHashOf(String(chapterUid || ''))
  return bookHash && chapterHash ? `https://weread.qq.com/web/reader/${bookHash}k${chapterHash}` : pcReadUrlOf(bookId)
}

const nodePostJson = (url: string, headers: Record<string, string>, body: Record<string, unknown>, redirects = 0): Promise<string> => {
  const req = (window as any).require
  if (!req || redirects > 5) return Promise.reject(new Error('Node request unavailable'))
  const target = new URL(url)
  const client = req(target.protocol === 'http:' ? 'http' : 'https')
  const payload = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const request = client.request(url, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': new TextEncoder().encode(payload).byteLength,
      },
    }, (response: any) => {
      const status = Number(response.statusCode || 0)
      const location = response.headers?.location
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        response.resume()
        nodePostJson(new URL(location, url).toString(), headers, body, redirects + 1).then(resolve, reject)
        return
      }
      const chunks: Uint8Array[] = []
      response.on('data', (chunk: Uint8Array) => chunks.push(chunk))
      response.on('end', () => {
        const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
        const buffer = new Uint8Array(size)
        let offset = 0
        chunks.forEach(chunk => {
          buffer.set(chunk, offset)
          offset += chunk.byteLength
        })
        resolve(new TextDecoder().decode(buffer))
      })
    })
    request.on('error', reject)
    request.setTimeout(15000, () => request.destroy(new Error('微信读书 API 请求超时')))
    request.write(payload)
    request.end()
  })
}

export const callWereadAgent = async (
  apiKey: string,
  apiName: string,
  params: Record<string, unknown> = {},
  helpers: Pick<HttpSourceHelpers, 'forwardProxy'>,
) => {
  if (!apiKey) throw new Error('请在来源管理里把微信读书 API Key 填到密码/API Key 输入框')
  const res = await helpers.forwardProxy(
    GATEWAY_URL,
    'POST',
    15000,
    [
      { name: 'Authorization', value: `Bearer ${apiKey}` },
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Accept', value: 'application/json' },
    ],
    JSON.stringify({ api_name: apiName, skill_version: SKILL_VERSION, ...params }),
    'application/json',
  )
  if (!res?.body) throw new Error('微信读书 Agent API 无响应')
  const data = JSON.parse(res.body) as WereadAgentResponse
  if (data.errcode && data.errcode !== 0) throw new Error(data.errmsg || `微信读书 Agent API 错误：${data.errcode}`)
  return data
}

export const callWereadAgentDirect = async (
  apiKey: string,
  apiName: string,
  params: Record<string, unknown> = {},
) => {
  if (!apiKey) throw new Error('请先填写微信读书 API Key')
  const requestBody = { api_name: apiName, skill_version: SKILL_VERSION, ...params }
  const requestHeaders = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  try {
    const directBody = await nodePostJson(GATEWAY_URL, requestHeaders, requestBody)
    const directData = JSON.parse(directBody) as WereadAgentResponse
    if (directData.errcode && directData.errcode !== 0) {
      const error = new Error(directData.errmsg || `微信读书 Agent API 错误：${directData.errcode}`) as Error & { errcode?: number; errlog?: string }
      error.errcode = Number(directData.errcode)
      error.errlog = String(directData.errlog || '')
      throw error
    }
    return directData
  } catch (error: any) {
    if (error?.errcode) throw error
  }
  const response = await fetch('/api/network/forwardProxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: GATEWAY_URL,
      method: 'POST',
      contentType: 'application/json',
      timeout: 15000,
      headers: [
        { Authorization: requestHeaders.Authorization },
        { 'Content-Type': requestHeaders['Content-Type'] },
        { Accept: requestHeaders.Accept },
      ],
      payload: JSON.stringify(requestBody),
    }),
  }).catch(() => null)
  const res = response?.ok ? await response.json().catch(() => null) : null
  const responseBody = res?.code === 0 ? res.data?.body : ''
  if (!responseBody) throw new Error(`微信读书 Agent API 无响应${res?.data?.status ? `：HTTP ${res.data.status}` : ''}`)
  const data = JSON.parse(responseBody) as WereadAgentResponse
  if (data.errcode && data.errcode !== 0) {
    const error = new Error(data.errmsg || `微信读书 Agent API 错误：${data.errcode}`) as Error & { status?: number; errcode?: number; errlog?: string }
    error.status = Number(res?.data?.status || 0)
    error.errcode = Number(data.errcode)
    error.errlog = String(data.errlog || '')
    throw error
  }
  return data
}

export const testWereadAgentKey = async (apiKey: string) => {
  const data = await callWereadAgentDirect(apiKey, '/store/search', { keyword: '三体', scope: 10, count: 1 })
  const book = Array.isArray(data.results) ? data.results.flatMap((group: any) => group.books || [])[0] : data.books?.[0]
  return {
    ok: true,
    title: compact(book?.bookInfo?.title || book?.title || ''),
    bookId: compact(book?.bookInfo?.bookId || book?.bookId || ''),
  }
}

export const createWereadOnlineBookInfo = (book: any): OnlineBookImportInfo => {
  const info = book?.bookInfo || book?.book || book
  const bookId = wereadBookIdOf(book)
  const title = compact(info?.title || info?.name)
  return {
    url: pcReadUrlOf(bookId),
    readUrl: pcReadUrlOf(bookId),
    title,
    author: compact(info?.author || info?.authorName) || '未知作者',
    coverUrl: compact(info?.cover || info?.coverUrl),
    format: 'txt',
    intro: compact(info?.intro || info?.description || info?.bookIntro),
    language: 'zh',
    publisher: compact(info?.publisher),
    published: compact(info?.publishTime || info?.publishDate || info?.year),
    identifier: bookId,
    sourceName: SOURCE.name,
    tags: [SOURCE.name, info?.category, '在线阅读'].filter(Boolean),
  }
}

export const getWereadReadUrl = pcReadUrlOf
export const getWereadChapterReadUrl = pcChapterReadUrlOf
const compact = (value = '') => String(value || '').replace(/\s+/g, ' ').trim()
export const wereadBookIdOf = (book: any) => {
  const info = book?.bookInfo || book?.book || book?.albumInfo || book || {}
  return compact(info?.bookId || book?.bookId || book?.privateData?.bookId || info?.albumId || book?.albumId || book?.identifier)
}

export const toWereadHttpBook = (item: any, source: Pick<HttpSourceConfig, 'id' | 'name' | 'url'> = SOURCE): HttpBook | null => {
  const info = item?.bookInfo || item?.book || item
  const bookId = wereadBookIdOf(item)
  const title = compact(info?.title || info?.name)
  if (!bookId || !title) return null
  const rating = Number(info?.newRating || info?.rating || 0)
  const ratingText = rating ? `评分 ${(rating / 100).toFixed(1)}` : ''
  return {
    name: title,
    author: compact(info?.author || info?.authorName) || '未知作者',
    bookUrl: detailUrlOf(bookId),
    readUrl: pcReadUrlOf(bookId),
    canDownload: false,
    privateData: { bookId, searchIdx: item?.searchIdx, raw: item },
    coverUrl: compact(info?.cover),
    intro: compact(info?.intro || info?.description || info?.bookIntro),
    extension: 'WEB',
    language: 'zh',
    publisher: compact(info?.publisher),
    year: compact(info?.publishTime || info?.publishDate),
    identifier: bookId,
    pages: compact(info?.totalWords ? `${Math.round(Number(info.totalWords) / 10000)}万字` : ''),
    sourceName: source.name,
    sourceId: source.id,
    sourceUrl: source.url,
    kind: ['微信读书', ratingText, info?.newRatingDetail?.title].filter(Boolean).join(' / '),
  }
}

export const loadWereadHttpBookDetail = async (book: HttpBook, source?: Pick<HttpSourceConfig, 'id' | 'name' | 'url' | 'auth'> | null) => {
  const apiKey = source ? apiKeyOf(source as HttpSourceConfig) : ''
  const bookId = wereadBookIdOf(book)
  if (!apiKey || !bookId) return book
  const [infoRes, chapterRes, progressRes, markRes, mineRes, bestRes, publicRes] = await Promise.allSettled([
    callWereadAgentDirect(apiKey, '/book/info', { bookId }),
    callWereadAgentDirect(apiKey, '/book/chapterinfo', { bookId }),
    callWereadAgentDirect(apiKey, '/book/getprogress', { bookId }),
    callWereadAgentDirect(apiKey, '/book/bookmarklist', { bookId }),
    callWereadAgentDirect(apiKey, '/review/list/mine', { bookid: bookId, count: 20 }),
    callWereadAgentDirect(apiKey, '/book/bestbookmarks', { bookId, chapterUid: 0 }),
    callWereadAgentDirect(apiKey, '/review/list', { bookId, count: 10 }),
  ])
  const info = infoRes.status === 'fulfilled' ? infoRes.value : {}
  const chapters = chapterRes.status === 'fulfilled' ? chapterRes.value?.chapters || [] : []
  const progress = progressRes.status === 'fulfilled' ? progressRes.value : {}
  const marks = markRes.status === 'fulfilled' ? markRes.value?.updated || [] : []
  const mineReviews = mineRes.status === 'fulfilled' ? mineRes.value?.reviews || [] : []
  const best = bestRes.status === 'fulfilled' ? bestRes.value : {}
  const publicReviews = publicRes.status === 'fulfilled' ? publicRes.value?.reviews || [] : []
  const raw = book.privateData?.raw || book
  const detail = toWereadHttpBook({ ...raw, bookInfo: { ...(raw.bookInfo || {}), ...(info.bookInfo || info.book || info) } }, source || undefined) || book
  return {
    ...book,
    ...detail,
    intro: detail.intro || book.intro,
    privateData: {
      ...(book.privateData || {}),
      ...(detail.privateData || {}),
      detail: info,
      stats: {
        progress: Number(progress?.book?.progress || progress?.progress || 0),
        chapters: chapters.length,
        marks: marks.length,
        reviews: mineReviews.length + publicReviews.length,
        bestMarks: Number(best?.totalCount || best?.total || best?.items?.length || 0),
        readingTime: Number(progress?.book?.readingTime || 0),
      },
    },
  }
}

const parseSearchResults = (data: WereadAgentResponse, source: HttpSourceConfig) => {
  const rows: any[] = []
  if (Array.isArray(data.results)) {
    data.results.forEach(group => {
      if (Array.isArray(group?.books)) rows.push(...group.books)
      if (Array.isArray(group?.items)) rows.push(...group.items)
    })
  }
  if (Array.isArray(data.books)) rows.push(...data.books)
  if (Array.isArray(data.items)) rows.push(...data.items)

  const seen = new Set<string>()
  return rows
    .map(item => toWereadHttpBook(item, source))
    .filter((book): book is HttpBook => {
      const id = String(book?.privateData?.bookId || '')
      if (!book || !id || seen.has(id)) return false
      seen.add(id)
      return true
    })
    .slice(0, 20)
}

const extension: HttpSourceExtension = {
  sources: [SOURCE],
  async search(source, keyword, helpers) {
    const data = await callWereadAgent(apiKeyOf(source), '/store/search', {
      keyword,
      scope: 10,
      count: 20,
    }, helpers).catch(() => null)
    return data ? parseSearchResults(data, source) : []
  },
  getOnlineBookInfo(book: HttpBook): OnlineBookImportInfo {
    if (!book.readUrl) throw new Error('微信读书在线阅读地址为空')
    return {
      url: book.readUrl,
      title: book.name,
      author: book.author,
      coverUrl: book.coverUrl,
      format: 'txt',
      readUrl: book.readUrl,
      intro: book.intro,
      language: book.language,
      publisher: book.publisher,
      published: book.year,
      identifier: book.identifier,
      sourceName: book.sourceName,
      tags: [book.sourceName, '在线阅读'].filter(Boolean),
    }
  },
}

export const registerWereadAgentSources = (manager: HttpSourceManager) => manager.registerExtension(extension)
