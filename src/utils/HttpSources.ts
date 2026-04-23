import { fetchSyncPost } from 'siyuan'
import { bookshelfManager } from '@/core/bookshelf'

interface HttpSourceConfig {
  id: string
  name: string
  type: 'anna' | 'gutenberg' | 'standardebooks' | 'custom'
  enabled: boolean
  url?: string
  searchUrl?: string
  domains?: string[]
  currentDomain?: string
  filters?: { extensions?: string[] }
}

interface HttpBook {
  name: string
  author: string
  bookUrl: string
  downloadUrl?: string
  coverUrl?: string
  intro?: string
  extension?: string
  language?: string
  year?: string
  fileSize?: string
  sourceName: string
  sourceId: string
  sourceUrl?: string
  kind?: string
}

const DEFAULT_SOURCES: HttpSourceConfig[] = [
  { id: 'anna', name: 'Anna Archive', type: 'anna', enabled: false, domains: ['https://annas-archive.se', 'https://annas-archive.li', 'https://annas-archive.gs', 'https://annas-archive.org'], currentDomain: 'https://annas-archive.se', filters: { extensions: [] } },
  { id: 'gutenberg', name: 'Project Gutenberg', type: 'gutenberg', enabled: true, url: 'https://www.gutenberg.org' },
  { id: 'standardebooks', name: 'Standard Ebooks', type: 'standardebooks', enabled: true, url: 'https://standardebooks.org' },
]

const mergeSources = (saved: HttpSourceConfig[] = []) => [
  ...DEFAULT_SOURCES.map(source => ({ ...source, ...(saved.find(item => item.id === source.id) || {}) })),
  ...saved.filter(source => source.type === 'custom'),
]

class HttpSourceManager {
  private readonly KEY = 'http_sources'
  private sources: HttpSourceConfig[] = [...DEFAULT_SOURCES]
  private loading: Promise<void> | null = null
  private loaded = false

  async init() {
    if (this.loaded) return
    if (!this.loading) this.loading = this.load()
    await this.loading
  }

  private async load() {
    try {
      this.sources = mergeSources(await bookshelfManager.getSetting<HttpSourceConfig[]>(this.KEY, []))
    } catch {
      this.sources = [...DEFAULT_SOURCES]
    } finally {
      this.loaded = true
      this.loading = null
    }
  }

  private async save() {
    await this.init()
    await bookshelfManager.saveSetting(this.KEY, this.sources)
    window.dispatchEvent(new CustomEvent('http-sources-updated'))
  }

  getSources = () => [...this.sources]
  getEnabledSources = () => this.sources.filter(source => source.enabled)
  getSource = (id: string) => this.sources.find(source => source.id === id)

  async updateSource(id: string, updates: Partial<HttpSourceConfig>) {
    const index = this.sources.findIndex(source => source.id === id)
    if (index < 0) return
    this.sources[index] = { ...this.sources[index], ...updates }
    await this.save()
  }

  async toggleSource(id: string) {
    const source = this.getSource(id)
    if (!source) return
    source.enabled = !source.enabled
    await this.save()
  }

  async addCustomSource(config: Omit<HttpSourceConfig, 'id' | 'type'>) {
    const source: HttpSourceConfig = { ...config, id: `custom_${Date.now()}`, type: 'custom', enabled: true }
    this.sources.push(source)
    await this.save()
    return source
  }

  async removeSource(id: string) {
    const index = this.sources.findIndex(source => source.id === id)
    if (index < 0 || this.sources[index].type !== 'custom') return
    this.sources.splice(index, 1)
    await this.save()
  }

  async addAnnaDomain(domain: string) {
    const source = this.getSource('anna')
    if (!source?.domains || source.domains.includes(domain)) return
    source.domains.push(domain)
    await this.save()
  }

  switchAnnaDomain = async (domain: string) => this.updateSource('anna', { currentDomain: domain })

  async setAnnaExtensions(extensions: string[]) {
    const source = this.getSource('anna')
    if (!source) return
    await this.updateSource('anna', { filters: { ...source.filters, extensions } })
  }

  async search(keyword: string, sourceId?: string): Promise<HttpBook[]> {
    const sources = sourceId ? [this.getSource(sourceId)].filter(Boolean) : this.getEnabledSources()
    const results = await Promise.allSettled(sources.map(source => this.searchIn(source!, keyword)))
    return results
      .filter((result): result is PromiseFulfilledResult<HttpBook[]> => result.status === 'fulfilled')
      .flatMap(result => result.value.map(book => ({
        ...book,
        sourceUrl: book.sourceId,
        kind: [book.extension, book.language, book.year].filter(Boolean).join(' / '),
      })))
  }

  private searchIn(source: HttpSourceConfig, keyword: string) {
    if (source.type === 'anna') return this.searchAnna(keyword, source)
    if (source.type === 'gutenberg') return this.searchGutenberg(keyword)
    if (source.type === 'standardebooks') return this.searchStandardEbooks(keyword)
    return Promise.resolve([])
  }

  private async searchAnna(keyword: string, source: HttpSourceConfig): Promise<HttpBook[]> {
    try {
      const domain = source.currentDomain || source.domains?.[0] || ''
      const html = await this.request(`${domain}/search?q=${encodeURIComponent(keyword)}`)
      if (!html) return []
      const exts = source.filters?.extensions || []
      return Array.from(new DOMParser().parseFromString(html, 'text/html').querySelectorAll('[class*="search-result"]'))
        .slice(0, 10)
        .map(item => {
          const title = item.querySelector('[class*="title"]')?.textContent?.trim() || ''
          const author = item.querySelector('[class*="author"]')?.textContent?.trim() || 'Unknown'
          const link = item.querySelector('a')?.getAttribute('href') || ''
          const ext = link.match(/\.(epub|pdf|mobi|azw3)/i)?.[1]?.toLowerCase()
          if (!title || (exts.length && ext && !exts.includes(ext))) return null
          return { name: title, author, bookUrl: `${domain}${link}`, downloadUrl: `${domain}${link}`, coverUrl: '', intro: '', extension: ext?.toUpperCase(), sourceName: source.name, sourceId: source.id }
        })
        .filter((book): book is HttpBook => !!book)
    } catch {
      return []
    }
  }

  private async searchGutenberg(keyword: string): Promise<HttpBook[]> {
    try {
      const html = await this.request(`https://www.gutenberg.org/ebooks/search/?query=${encodeURIComponent(keyword)}&submit_search=Go%21`)
      if (!html) return []
      return Array.from(new DOMParser().parseFromString(html, 'text/html').querySelectorAll('li.booklink'))
        .slice(0, 10)
        .map(item => {
          const link = item.querySelector('a[href*="/ebooks/"]')?.getAttribute('href') || ''
          const id = link.match(/\/ebooks\/(\d+)/)?.[1]
          const title = item.querySelector('.title')?.textContent?.trim() || ''
          if (!id || !title) return null
          return {
            name: title,
            author: item.querySelector('.subtitle')?.textContent?.trim() || 'Unknown',
            bookUrl: `https://www.gutenberg.org${link}`,
            downloadUrl: `https://www.gutenberg.org/ebooks/${id}.epub3.images`,
            coverUrl: `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`,
            intro: '',
            extension: 'EPUB',
            language: 'en',
            sourceName: 'Project Gutenberg',
            sourceId: 'gutenberg',
          }
        })
        .filter((book): book is HttpBook => !!book)
    } catch {
      return []
    }
  }

  private async searchStandardEbooks(keyword: string): Promise<HttpBook[]> {
    try {
      const html = await this.request(`https://standardebooks.org/ebooks?query=${encodeURIComponent(keyword)}`)
      if (!html) return []
      return Array.from(new DOMParser().parseFromString(html, 'text/html').querySelectorAll('li[typeof="schema:Book"]'))
        .slice(0, 10)
        .map(item => {
          const link = item.querySelector('a')?.getAttribute('href') || ''
          const title = item.querySelector('[property="schema:name"]')?.textContent?.trim() || ''
          if (!link || !title) return null
          const slug = link.replace('/ebooks/', '')
          return {
            name: title,
            author: item.querySelector('[property="schema:author"]')?.textContent?.trim() || 'Unknown',
            bookUrl: `https://standardebooks.org${link}`,
            downloadUrl: `https://standardebooks.org/ebooks/${slug}/downloads/${slug.replace('/', '_')}.epub?source=download`,
            coverUrl: item.querySelector('img')?.getAttribute('src') ? `https://standardebooks.org${item.querySelector('img')?.getAttribute('src')}` : '',
            intro: '',
            extension: 'EPUB',
            language: 'en',
            sourceName: 'Standard Ebooks',
            sourceId: 'standardebooks',
          }
        })
        .filter((book): book is HttpBook => !!book)
    } catch {
      return []
    }
  }

  private async request(url: string) {
    const res = await fetchSyncPost('/api/network/forwardProxy', {
      url,
      method: 'GET',
      contentType: 'text/html',
      headers: [{ name: 'User-Agent', value: 'Mozilla/5.0' }],
      timeout: 30000,
    }).catch(() => null)
    return res?.code === 0 ? res.data?.body || '' : ''
  }

  async downloadCover(url: string) {
    if (!url) return null
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' })
      return res.ok ? await res.blob() : null
    } catch {
      return null
    }
  }

  async addToBookshelf(book: HttpBook, manager: typeof bookshelfManager) {
    const url = book.downloadUrl || book.bookUrl
    if (!url) throw new Error('无效的下载链接')
    await manager.addUrlBook(url, book.coverUrl, { title: book.name, author: book.author })
  }
}

export const httpSourceManager = new HttpSourceManager()
export type { HttpSourceConfig, HttpBook }
