/**
 * 字幕核心模块
 */

import { forwardProxyRequest } from '@/utils/webdav-proxy'

export interface Subtitle {
  time: number
  text: string
  endTime?: number
}
export interface SubtitleTrack {
  name: string
  lang: string
  url: string
  sourceUrl?: string
  sourcePath?: string
  matched?: boolean
  default?: boolean
}

const AUDIO_TEXT_EXTS = ['.lrc', '.vtt', '.srt']
const VIDEO_TEXT_EXTS = ['.vtt', '.srt', '.ass', '.ssa', '.lrc']
const SUBTITLE_RE = /\.(srt|ass|ssa|vtt|sub|lrc)$/i
const REMOTE_RE = /^(https?:|file:|blob:)/i
export const isSubtitlePath = (value = '') => SUBTITLE_RE.test(value)
export const inferSubtitleLang = (value = '') => /\b(en|eng|english)\b/i.test(value) ? 'en' : /\b(ja|jp|jpn|japanese)\b/i.test(value) ? 'ja' : /\b(ko|kr|kor|korean)\b/i.test(value) ? 'ko' : 'zh'
export const matchSubtitleName = (name = '', media = '') => { const stem = (value = '') => value.replace(/\.[^.]+$/, '').toLowerCase(); const base = stem(media), current = stem(name); return !!base && (current === base || ['.', '_', '-', ' '].some(sep => current.startsWith(`${base}${sep}`))) }
export const normalizeSubtitleTrack = (track: Partial<SubtitleTrack> = {}, media = ''): SubtitleTrack | null => {
  const name = `${track.name || ''}`.trim()
  const url = `${track.url || ''}`.trim()
  if (!url) return null
  const matched = !!(track.matched ?? matchSubtitleName(name, media))
  return {
    name: name || `${track.lang || '字幕'}`,
    lang: track.lang || inferSubtitleLang(name),
    url,
    ...(track.sourceUrl ? { sourceUrl: track.sourceUrl } : {}),
    ...(track.sourcePath ? { sourcePath: track.sourcePath } : {}),
    matched,
    default: !!(track.default ?? matched),
  }
}
export const pickSubtitleTrack = (tracks: SubtitleTrack[] = [], currentUrl = '') => tracks.find(track => track.url === currentUrl || track.sourceUrl === currentUrl) || tracks.find(track => track.default) || tracks[0] || null
export const getSidecarTextPath = (path = '', type = '', fs = window.require?.('fs')) => {
  if (!path || !fs?.existsSync?.(path)) return ''
  const base = path.replace(/\.[^.]+$/, '')
  const exts = type === 'audio' ? AUDIO_TEXT_EXTS : VIDEO_TEXT_EXTS
  return exts.map(ext => `${base}${ext}`).find(candidate => candidate !== path && fs.existsSync(candidate)) || ''
}
const normalizeCloudDir = (path = '/') => { const clean = `${path || '/'}`.replace(/[?#].*$/, '').replace(/\/+/g, '/').replace(/^\/?/, '/'); return clean === '/' ? '/' : `${clean.replace(/\/$/, '')}/` }
export const getSubtitleTracks = async (item: any, storage: any, options: { listCloudFiles?: (parentPath: string, item: any) => Promise<any[]> } = {}): Promise<SubtitleTrack[]> => {
  if (!storage || !item) return []
  const media = item.name || item.title || `${item.cloudPath || ''}`.split('/').pop() || ''
  const normalize = (track: any) => normalizeSubtitleTrack(track, media)
  const resolveCloud = async () => {
    if (!item?.cloudAccountId || !options.listCloudFiles) return []
    const cloudPath = `${item.cloudPath || item.sourcePath || ''}`
    const parentPath = normalizeCloudDir(cloudPath.split('/').slice(0, -1).join('/'))
    return (await options.listCloudFiles(parentPath, item))
      .filter((file: any) => file.type === 'subtitle' || isSubtitlePath(file.name || file.title || file.url || ''))
      .map((file: any) => normalize({ name: file.name || file.title, url: file.url, sourcePath: file.sourcePath || file.cloudPath || '' }))
      .filter(Boolean) as SubtitleTrack[]
  }
  const { BaseDriver } = await import('@/drivers/base/BaseDriver')
  const resolveUrl = async (track: SubtitleTrack) => {
    if (!track?.url || REMOTE_RE.test(track.url)) return track
    const parsed = BaseDriver.parseItemUrl(track.url, item.source || '')
    const resolved = parsed ? await BaseDriver.resolvePlayUrl({ ...item, url: track.url, source: parsed.source, sourcePath: track.sourcePath || parsed.sourcePath }, storage).catch(() => null) : null
    return resolved?.url ? { ...track, sourceUrl: track.url, url: resolved.url } : track
  }
  return await Promise.all(((item?.cloudAccountId ? await resolveCloud() : await BaseDriver.getSubtitleCandidates(item, storage).catch(() => []))
    .map(normalize)
    .filter(Boolean)
    .map(resolveUrl))) as SubtitleTrack[]
}

/**
 * 字幕管理器
 */
export class SubtitleManager {
  private static cache = new Map<string, Subtitle[]>()
  private static urlCache = new Map<string, string>()
  private static parseTime = (value = '', dot = false) => {
    const match = value.match(dot ? /(\d+):(\d+):(\d+)\.(\d+)/ : /(\d+):(\d+):(\d+)[,.](\d+)/)
    return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4]}`) : 0
  }
  private static parseBlocks = (text: string, dot = false) => text.split(/\r?\n\r?\n+/).flatMap(block => {
    const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    const timeLine = lines.find(line => line.includes('-->'))
    if (!timeLine) return []
    const [start, end] = timeLine.split(/\s*-->\s*/)
    const body = lines.slice(lines.indexOf(timeLine) + 1).join('\n').trim()
    return body ? [{ time: this.parseTime(start, dot), endTime: this.parseTime(end, dot), text: body }] : []
  })
  private static parseByPath(path = '', text = ''): Subtitle[] {
    return /\.srt$/i.test(path) ? this.parseSrt(text)
      : /\.vtt$/i.test(path) ? this.parseVtt(text)
      : /\.(ass|ssa)$/i.test(path) ? this.parseAss(text)
      : this.parseLrc(text)
  }
  private static detectPath(path = '', text = ''): string {
    if (/\.(srt|vtt|ass|ssa|lrc)$/i.test(path)) return path
    return /-->/.test(text) ? `${path || 'subtitle'}.srt`
      : /^WEBVTT/i.test(text) ? `${path || 'subtitle'}.vtt`
      : /^\[?\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]/m.test(text) ? `${path || 'subtitle'}.lrc`
      : /Dialogue:/i.test(text) ? `${path || 'subtitle'}.ass`
      : path
  }

  private static createUrl(key: string, subtitles: Subtitle[]): string {
    this.cache.set(key, subtitles)
    const prevUrl = this.urlCache.get(key)
    if (prevUrl) URL.revokeObjectURL(prevUrl)
    const vttUrl = URL.createObjectURL(new Blob([this.toVtt(subtitles)], { type: 'text/vtt' }))
    this.urlCache.set(key, vttUrl)
    return vttUrl
  }

  private static parseLrc(text: string): Subtitle[] {
    const subtitles: Subtitle[] = []
    text.split(/\r?\n/).forEach(line => {
      const content = line.replace(/\[[^\]]+\]/g, '').trim()
      if (!content) return
      const tags = [...line.matchAll(/\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)]
      tags.forEach(match => {
        const ms = String(match[3] || '0').padEnd(3, '0').slice(0, 3)
        subtitles.push({
          time: Number(match[1]) * 60 + Number(match[2]) + Number(ms) / 1000,
          text: content,
        })
      })
    })
    return subtitles.sort((a, b) => a.time - b.time)
  }

  private static parseSrt(text: string): Subtitle[] {
    return this.parseBlocks(text)
  }

  private static parseVtt(text: string): Subtitle[] {
    return this.parseBlocks(text.replace(/^WEBVTT\s*/i, ''), true)
  }

  private static parseAss(text: string): Subtitle[] {
    return text.split(/\r?\n/).flatMap(line => {
      if (!/^Dialogue:/i.test(line)) return []
      const parts = line.split(',', 10)
      const body = parts[9]?.replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').trim()
      return body ? [{ time: this.parseTime(parts[1], true), endTime: this.parseTime(parts[2], true), text: body }] : []
    })
  }

  private static async loadLocal(url: string): Promise<string> {
    try {
      const fs = window.require?.('fs')
      if (!fs) return ''
      const path = decodeURIComponent(url.replace(/^file:\/\//, ''))
      let text = ''
      if (/\.(lrc|srt|vtt|ass|ssa)$/i.test(path)) text = fs.readFileSync(path, 'utf8')
      else {
        const { parseBuffer } = await import('music-metadata-browser')
        const bytes = new Uint8Array(fs.readFileSync(path))
        const metadata = await parseBuffer(bytes, { mimeType: '', size: bytes.byteLength })
        text = metadata.common.lyrics?.join('\n') || ''
      }
      const subtitles = this.parseByPath(path, text)
      return subtitles.length ? this.createUrl(url, subtitles) : ''
    } catch {
      return ''
    }
  }

  private static async loadRemote(url: string): Promise<string> {
    try {
      const fullUrl = url.startsWith('//') ? `https:${url}` : url
      const res = await forwardProxyRequest(fullUrl)
      if (res.status < 200 || res.status >= 300) return ''
      const type = String(res.headers?.['content-type'] || res.headers?.['Content-Type'] || res.contentType || '')
      if (/json/i.test(type)) {
        const data = JSON.parse(res.body || '{}')
        const body = data.body || []
        return this.createUrl(url, body.map((s: any) => ({ time: s.from, endTime: s.to, text: s.content })))
      }
      const text = String(res.body || '')
      const path = this.detectPath(new URL(fullUrl).pathname, text)
      const subtitles = this.parseByPath(path, text)
      return subtitles.length ? this.createUrl(url, subtitles) : ''
    } catch {
      return ''
    }
  }

  static async load(url: string): Promise<string> {
    if (!url) return ''
    if (!/^https?:\/\//i.test(url) && !url.startsWith('//')) return this.loadLocal(url)
    return this.loadRemote(url)
  }

  /**
   * 读取缓存的字幕列表，供侧边面板直接展示。
   */
  static get(url: string): Subtitle[] {
    return this.cache.get(url) || []
  }

  private static toVtt(body: Subtitle[]): string {
    const fmt = (s: number) => {
      const h = s / 3600 | 0
      const m = (s % 3600) / 60 | 0
      const sec = s % 60 | 0
      const ms = (s % 1) * 1000 | 0
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
    }

    return `WEBVTT\n\n${body.map((item: Subtitle, i: number) => {
      const text = (item.text || '').trim()
      const end = item.endTime ?? Math.max(item.time + 0.1, body[i + 1]?.time ?? item.time + 5)
      return text ? `${i + 1}\n${fmt(item.time || 0)} --> ${fmt(end)}\n${text}\n` : ''
    }).filter(Boolean).join('\n')}`
  }

  static clear(): void {
    this.cache.clear()
    this.urlCache.forEach(url => URL.revokeObjectURL(url))
    this.urlCache.clear()
  }
}
