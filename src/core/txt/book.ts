interface TxtChapter { index: number; title: string; content: string }

const CHAPTER_RE = /^(第[零一二三四五六七八九十百千万\d]+[章节回集部]|Chapter\s+\d+|\d+\.|【[^】]+】)/i
const HTML = 'text/html'
const XML_ESCAPE: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }
const cleanText = (text: string) => text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
const escapeHtml = (text: string) => cleanText(text).replace(/[&<>"']/g, char => XML_ESCAPE[char])

const decodeWith = (label: string, bytes: Uint8Array, fatal = false) => {
  try { return new TextDecoder(label, { fatal }).decode(bytes) } catch { return '' }
}

const scoreText = (text: string) => {
  if (!text) return -Infinity
  const bad = (text.match(/\uFFFD/g) || []).length
  const cn = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const ascii = (text.match(/[a-zA-Z0-9，。！？、；：“”‘’（）《》]/g) || []).length
  return cn * 4 + ascii - bad * 20
}

const decodeTxt = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer)
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return decodeWith('utf-8', bytes.slice(3))
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return decodeWith('utf-16le', bytes.slice(2))
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return decodeWith('utf-16be', bytes.slice(2))

  const sample = bytes.subarray(0, Math.min(bytes.length, 64 * 1024))
  const utf8 = decodeWith('utf-8', sample, true)
  if (utf8 && scoreText(utf8) >= 0) return decodeWith('utf-8', bytes)

  const candidates = ['gb18030', 'gbk', 'big5'].map(label => {
    const text = decodeWith(label, sample)
    return { label, score: scoreText(text) }
  }).sort((a, b) => b.score - a.score)
  return decodeWith(candidates[0]?.label || 'utf-8', bytes) || decodeWith('utf-8', bytes)
}

const splitChapters = (text: string): TxtChapter[] => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const chapters: TxtChapter[] = []
  let title = '开始'
  let content: string[] = []
  let index = 0
  const maxLines = 5000

  const push = () => {
    if (!content.length) return
    chapters.push({ index, title, content: content.join('\n') })
    index += 1
    content = []
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (CHAPTER_RE.test(line) && content.length) {
      push()
      title = line.slice(0, 120)
    } else {
      content.push(line)
      if (content.length >= maxLines) {
        push()
        title = `第${index + 1}部分`
      }
    }
  }
  push()
  return chapters.length ? chapters : [{ index: 0, title: '全文', content: text }]
}

const chapterHtml = ({ index, title, content }: TxtChapter) => {
  const paragraphs = content.split(/\n+/).filter(Boolean).map((line, i) =>
    `<p id="p-${index}-${i}">${escapeHtml(line)}</p>`).join('\n')
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <section id="txt-${index}" data-txt-section="${index}">
    <h1>${escapeHtml(title)}</h1>
    ${paragraphs}
  </section>
</body>
</html>`
}

const sourceName = (source: File | string) => {
  const name = typeof source === 'string' ? source.split(/[?#]/)[0].split('/').pop() || 'TXT' : source.name
  try { return decodeURIComponent(name) } catch { return name }
}

const readSource = async (source: File | string) => source instanceof File
  ? source.arrayBuffer()
  : fetch(source).then(res => {
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return res.arrayBuffer()
    })

export const isTxtSource = (source: unknown) => source instanceof File
  ? /\.txt$/i.test(source.name)
  : typeof source === 'string' && /\.txt(?:[?#].*)?$/i.test(source)

export const createTxtBook = async (source: File | string) => {
  const name = sourceName(source)
  const title = name.replace(/\.txt$/i, '') || 'TXT'
  const text = decodeTxt(await readSource(source))
  if (!text.trim()) throw new Error('TXT 内容为空')

  const chapters = splitChapters(text)
  const htmlCache = new Map<number, string>()
  const urlCache = new Map<number, string>()
  const getHtml = (chapter: TxtChapter) => {
    if (!htmlCache.has(chapter.index)) htmlCache.set(chapter.index, chapterHtml(chapter))
    return htmlCache.get(chapter.index)!
  }
  const load = (chapter: TxtChapter) => {
    const cached = urlCache.get(chapter.index)
    if (cached) return cached
    const url = URL.createObjectURL(new Blob([getHtml(chapter)], { type: HTML }))
    urlCache.set(chapter.index, url)
    return url
  }
  const unload = (chapter: TxtChapter) => {
    const url = urlCache.get(chapter.index)
    if (url) URL.revokeObjectURL(url)
    urlCache.delete(chapter.index)
  }

  const book: any = {
    dir: 'ltr',
    metadata: { title, author: '未知作者', language: 'zh' },
    toc: chapters.map(chapter => ({ label: chapter.title, href: `txt-${chapter.index}` })),
    sections: chapters.map(chapter => ({
      id: `txt-${chapter.index}`,
      size: chapter.content.length,
      load: () => load(chapter),
      unload: () => unload(chapter),
      createDocument: () => new DOMParser().parseFromString(getHtml(chapter), HTML),
    })),
    resolveHref(href = '') {
      const [id, hash] = String(href).replace(/^#/, '').split('#')
      const index = Math.max(0, chapters.findIndex(chapter => `txt-${chapter.index}` === id))
      return {
        index,
        anchor: (doc: Document) => hash
          ? doc.getElementById(hash)
          : doc.querySelector(`[data-txt-section="${chapters[index]?.index ?? 0}"]`) || doc.body,
      }
    },
    splitTOCHref(href = '') { return [href.replace(/^#/, ''), null] },
    getTOCFragment(doc: Document, id: string) {
      return doc.querySelector(`[data-txt-section="${String(id).replace('txt-', '')}"]`) || doc.body
    },
    isExternal: (href = '') => /^https?:\/\//i.test(href),
    destroy() {
      for (const url of urlCache.values()) URL.revokeObjectURL(url)
      urlCache.clear()
      htmlCache.clear()
    },
  }
  return book
}
