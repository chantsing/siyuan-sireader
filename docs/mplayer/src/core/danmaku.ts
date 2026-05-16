/**
 * 通用弹幕处理器
 * 支持 XML、ASS、JSON 三种输入，并统一转换成 ArtPlayer 可直接消费的弹幕数组。
 */

import { forwardProxyText } from '@/utils/webdav-proxy'

export interface Danmaku {
  text: string
  time: number
  color: string
  mode: number
  size?: number
}

type DanmakuFormat = 'xml' | 'ass' | 'json'

export class DanmakuManager {
  private static cache = new Map<string, Danmaku[]>()

  static async fetchBiliXml(cid: string): Promise<string> {
    try {
      return await forwardProxyText(`https://comment.bilibili.com/${cid}.xml`, 'GET')
    } catch {
      return ''
    }
  }

  private static isXmlLike(content: string): boolean {
    return !!content && (content.includes('<i>') || content.includes('<d ') || content.includes('<?xml'))
  }

  /**
   * 合并相同弹幕（按秒分组，相同文本去重并计数）
   */
  static merge(list: Danmaku[]): Danmaku[] {
    return Object.entries(list.reduce((map, d) => ((map[d.time | 0] ||= new Map()).set(d.text, { ...d, count: (map[d.time | 0].get(d.text)?.count || 0) + 1 }), map), {} as Record<number, Map<string, any>>)).flatMap(([, items]) => Array.from(items.values()).map((d: any) => d.count > 1 ? { ...d, text: `${d.text} ×${d.count}` } : d))
  }

  /**
   * 加载 B 站弹幕。
   * 优先使用播放阶段预取到的 XML，避免播放器初始化时再次请求。
   */
  static async loadBili(cid: string, xmlContent = ''): Promise<Danmaku[]> {
    const key = `bili_${cid}`
    if (xmlContent && this.isXmlLike(xmlContent)) {
      const list = this.parseXml(xmlContent)
      this.cache.set(key, list)
      return list
    }
    if (this.cache.has(key)) {
      return this.cache.get(key)!
    }

    try {
      const xml = await this.fetchBiliXml(cid)
      if (!this.isXmlLike(xml)) return []
      const list = xml ? this.parseXml(xml) : []
      this.cache.set(key, list)
      return list
    } catch {
      return []
    }
  }

  /**
   * 加载通用弹幕文件。
   */
  static async load(url: string, format?: DanmakuFormat): Promise<Danmaku[]> {
    if (!url) return []
    if (this.cache.has(url)) return this.cache.get(url)!

    try {
      const content = /^https?:\/\//i.test(url) || url.startsWith('//')
        ? await forwardProxyText(url.startsWith('//') ? `https:${url}` : url, 'GET').catch(() => '')
        : await fetch(url).then(r => r.text()).catch(() => '')
      if (!content) return []

      const type = format || this.detectFormat(content, url)
      const list = this.parse(content, type)
      this.cache.set(url, list)
      return list
    } catch {
      return []
    }
  }

  /**
   * 读取缓存的弹幕数组。
   */
  static get(key: string): Danmaku[] {
    return this.cache.get(key.startsWith('bili_') ? key : `bili_${key}`) || []
  }

  private static parse(content: string, format: DanmakuFormat): Danmaku[] {
    const parsers: Record<DanmakuFormat, (c: string) => Danmaku[]> = {
      xml: this.parseXml,
      ass: this.parseAss,
      json: this.parseJson
    }
    return parsers[format]?.(content) || []
  }

  /**
   * 解析 XML 弹幕。
   */
  private static parseXml(xml: string): Danmaku[] {
    if (!xml?.trim() || xml.startsWith('{')) return []

    try {
      const modeMap = (mode: number) => {
        switch (mode) {
          case 4: return 2
          case 5: return 1
          default: return 0
        }
      }
      const decode = (text: string) => text
        .replaceAll('&quot;', '"')
        .replaceAll('&apos;', '\'')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&amp;', '&')
      const matches = Array.from(xml.matchAll(/<d (?:.*? )??p="(?<p>.+?)"(?: .*?)?>(?<text>.+?)<\/d>/gs))
      const list = matches.map(match => {
        const p = match.groups?.p?.split(',') || []
        const text = decode(match.groups?.text?.trim() || '')
        if (p.length < 4 || !text) return null
        return {
          text,
          time: Number(p[0]) || 0,
          mode: modeMap(Number(p[1])),
          size: Number(p[2]) || 25,
          color: `#${Number(p[3]).toString(16).padStart(6, '0')}`
        }
      }).filter(Boolean) as Danmaku[]

      return list
    } catch {
      return []
    }
  }

  /**
   * 解析 ASS 弹幕。
   */
  private static parseAss(content: string): Danmaku[] {
    if (!content?.trim()) return []

    return content.split(/\r?\n/)
      .filter(line => line.startsWith('Dialogue:'))
      .map(line => {
        const parts = line.split(',')
        if (parts.length < 10) return null

        const text = parts.slice(9).join(',').replace(/\{[^}]*\}|\\N/g, ' ').trim()
        if (!text) return null

        const [h, m, s] = parts[1].trim().split(':').map(Number)
        return {
          text,
          time: h * 3600 + m * 60 + s,
          color: '#ffffff',
          mode: 1,
          size: 25
        }
      })
      .filter(Boolean) as Danmaku[]
  }

  /**
   * 解析 JSON 弹幕。
   */
  private static parseJson(content: string): Danmaku[] {
    try {
      const data = JSON.parse(content)
      if (!Array.isArray(data)) return []

      return data.map(item => ({
        text: item.text || item.content || '',
        time: item.time || item.startTime || 0,
        color: item.color || '#ffffff',
        mode: item.mode || 1,
        size: item.size || 25
      })).filter(d => d.text)
    } catch {
      return []
    }
  }

  /**
   * 自动识别弹幕格式。
   */
  private static detectFormat(content: string, url: string): DanmakuFormat {
    const ext = url.split('.').pop()?.toLowerCase()
    if (ext === 'ass') return 'ass'
    if (ext === 'json') return 'json'

    const trimmed = content.trim()
    if (trimmed.startsWith('[Script Info]')) return 'ass'
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) return 'json'
    return 'xml'
  }

  static clear(): void {
    this.cache.clear()
  }
}
