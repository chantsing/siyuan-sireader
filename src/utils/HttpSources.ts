import { getDatabase } from '@/core/database'
import { fetchSyncPost } from 'siyuan'

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
  { id: 'anna', name: '安娜的档案', type: 'anna', enabled: false, domains: ['https://annas-archive.se', 'https://annas-archive.li', 'https://annas-archive.gs', 'https://annas-archive.org'], currentDomain: 'https://annas-archive.se', filters: { extensions: [] } },
  { id: 'gutenberg', name: 'Project Gutenberg', type: 'gutenberg', enabled: true, url: 'https://www.gutenberg.org' },
  { id: 'standardebooks', name: 'Standard Ebooks', type: 'standardebooks', enabled: true, url: 'https://standardebooks.org' }
]

class HttpSourceManager {
  private sources: HttpSourceConfig[] = []
  private readonly KEY = 'http_sources'
  private db: any = null

  constructor() { this.load() }

  private async load() {
    try {
      this.db = await getDatabase()
      const saved = await this.db.getSetting(this.KEY)
      if (saved) {
        this.sources = DEFAULT_SOURCES.map(d => ({ ...d, ...(saved.find((s: HttpSourceConfig) => s.id === d.id) || {}) }))
        this.sources.push(...saved.filter((s: HttpSourceConfig) => s.type === 'custom'))
      } else this.sources = [...DEFAULT_SOURCES]
    } catch { this.sources = [...DEFAULT_SOURCES] }
  }

  private async save() {
    try {
      if (!this.db) this.db = await getDatabase()
      await this.db.saveSetting(this.KEY, this.sources)
      window.dispatchEvent(new CustomEvent('http-sources-updated'))
    } catch (e) { console.error('[HTTP书源保存失败]', e) }
  }

  getSources() { return [...this.sources] }
  getEnabledSources() { return this.sources.filter(s => s.enabled) }
  getSource(id: string) { return this.sources.find(s => s.id === id) }

  async updateSource(id: string, updates: Partial<HttpSourceConfig>) {
    const idx = this.sources.findIndex(s => s.id === id)
    if (idx >= 0) { this.sources[idx] = { ...this.sources[idx], ...updates }; await this.save() }
  }

  async toggleSource(id: string) {
    const s = this.getSource(id)
    if (s) { s.enabled = !s.enabled; await this.save() }
  }

  async addCustomSource(config: Omit<HttpSourceConfig, 'id' | 'type'>) {
    const s: HttpSourceConfig = { ...config, id: `custom_${Date.now()}`, type: 'custom', enabled: true }
    this.sources.push(s)
    await this.save()
    return s
  }

  async removeSource(id: string) {
    const idx = this.sources.findIndex(s => s.id === id)
    if (idx >= 0 && this.sources[idx].type === 'custom') { this.sources.splice(idx, 1); await this.save() }
  }

  async addAnnaDomain(domain: string) {
    const anna = this.getSource('anna')
    if (anna?.domains && !anna.domains.includes(domain)) { anna.domains.push(domain); await this.save() }
  }

  async switchAnnaDomain(domain: string) { await this.updateSource('anna', { currentDomain: domain }) }
  async setAnnaExtensions(extensions: string[]) {
    const anna = this.getSource('anna')
    if (anna) await this.updateSource('anna', { filters: { ...anna.filters, extensions } })
  }

  async search(keyword: string, sourceId?: string): Promise<HttpBook[]> {
    const sources = sourceId ? [this.getSource(sourceId)].filter(Boolean) : this.getEnabledSources()
    const results = await Promise.allSettled(sources.map(s => this.searchIn(s!, keyword)))
    return results.filter((r): r is PromiseFulfilledResult<HttpBook[]> => r.status === 'fulfilled')
      .flatMap(r => r.value.map(b => ({ ...b, sourceUrl: b.sourceId, kind: [b.extension, b.language, b.year].filter(Boolean).join(' · ') })))
  }

  private async searchIn(s: HttpSourceConfig, k: string): Promise<HttpBook[]> {
    const map: Record<string, () => Promise<HttpBook[]>> = {
      anna: () => this.searchAnna(k, s),
      gutenberg: () => this.searchGutenberg(k),
      standardebooks: () => this.searchStandardEbooks(k),
      custom: () => Promise.resolve([])
    }
    return map[s.type]?.() || []
  }

  private async searchAnna(k: string, s: HttpSourceConfig): Promise<HttpBook[]> {
    try {
      const domain = s.currentDomain || s.domains?.[0] || ''
      const html = await this.request(`${domain}/search?q=${encodeURIComponent(k)}`)
      if (!html) return []
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const exts = s.filters?.extensions || []
      return Array.from(doc.querySelectorAll('[class*="search-result"]')).slice(0, 10).map(item => {
        const title = item.querySelector('[class*="title"]')?.textContent?.trim() || ''
        const author = item.querySelector('[class*="author"]')?.textContent?.trim() || 'Unknown'
        const link = item.querySelector('a')?.getAttribute('href') || ''
        const ext = link.match(/\.(epub|pdf|mobi|azw3)/i)?.[1]?.toLowerCase()
        if (exts.length && ext && !exts.includes(ext)) return null
        return { name: title, author, bookUrl: domain + link, downloadUrl: domain + link, coverUrl: '', intro: '', extension: ext?.toUpperCase(), sourceName: s.name, sourceId: s.id }
      }).filter((b): b is HttpBook => !!b?.name)
    } catch (e) { console.error('[安娜搜索失败]', e); return [] }
  }

  private async searchGutenberg(k: string): Promise<HttpBook[]> {
    try {
      const html = await this.request(`https://www.gutenberg.org/ebooks/search/?query=${encodeURIComponent(k)}&submit_search=Go%21`)
      if (!html) return []
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const items = doc.querySelectorAll('li.booklink')
      return Array.from(items).slice(0, 10).map(item => {
        const titleEl = item.querySelector('.title')
        const authorEl = item.querySelector('.subtitle')
        const linkEl = item.querySelector('a[href*="/ebooks/"]')
        const link = linkEl?.getAttribute('href') || ''
        const id = link.match(/\/ebooks\/(\d+)/)?.[1]
        const title = titleEl?.textContent?.trim() || ''
        const author = authorEl?.textContent?.trim() || 'Unknown'
        if (!id || !title) return null
        return { name: title, author, bookUrl: `https://www.gutenberg.org${link}`, downloadUrl: `https://www.gutenberg.org/ebooks/${id}.epub3.images`, coverUrl: `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`, intro: '', extension: 'EPUB', language: 'en', sourceName: 'Project Gutenberg', sourceId: 'gutenberg' }
      }).filter((b): b is HttpBook => !!b?.name)
    } catch (e) { console.error('[Gutenberg搜索失败]', e); return [] }
  }

  private async searchStandardEbooks(k: string): Promise<HttpBook[]> {
    try {
      const html = await this.request(`https://standardebooks.org/ebooks?query=${encodeURIComponent(k)}`)
      if (!html) return []
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const items = doc.querySelectorAll('li[typeof="schema:Book"]')
      return Array.from(items).slice(0, 10).map(item => {
        const title = item.querySelector('[property="schema:name"]')?.textContent?.trim() || ''
        const author = item.querySelector('[property="schema:author"]')?.textContent?.trim() || 'Unknown'
        const link = item.querySelector('a')?.getAttribute('href') || ''
        const cover = item.querySelector('img')?.getAttribute('src') || ''
        const slug = link.replace('/ebooks/', '')
        // Standard Ebooks 正确的下载链接格式：作者_书名.epub?source=download
        const downloadSlug = slug.replace('/', '_')
        return { name: title, author, bookUrl: `https://standardebooks.org${link}`, downloadUrl: `https://standardebooks.org/ebooks/${slug}/downloads/${downloadSlug}.epub?source=download`, coverUrl: cover ? `https://standardebooks.org${cover}` : '', intro: '', extension: 'EPUB', language: 'en', sourceName: 'Standard Ebooks', sourceId: 'standardebooks' }
      }).filter((b): b is HttpBook => !!b?.name)
    } catch (e) { console.error('[Standard Ebooks搜索失败]', e); return [] }
  }

  private async request(url: string): Promise<string> {
    try {
      const res = await fetchSyncPost('/api/network/forwardProxy', { url, method: 'GET', contentType: 'text/html', headers: [{ name: 'User-Agent', value: 'Mozilla/5.0' }], timeout: 30000 })
      return res?.code === 0 ? res.data?.body || '' : ''
    } catch (e) { console.error('[HTTP请求失败]', url, e); return '' }
  }

  async downloadCover(url: string): Promise<Blob | null> {
    if (!url) return null
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' })
      return res.ok ? await res.blob() : null
    } catch { return null }
  }

  async addToBookshelf(book: HttpBook, bookshelfManager: any): Promise<void> {
    const url = book.downloadUrl || book.bookUrl
    if (!url) throw new Error('无效的下载链接')
    await bookshelfManager.addUrlBook(url, book.coverUrl, { title: book.name, author: book.author })
  }
}

export const httpSourceManager = new HttpSourceManager()
export type { HttpSourceConfig, HttpBook }
