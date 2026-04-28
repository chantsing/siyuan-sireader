/**
 * 在线书籍 - 统一管理
 */
import { getBookFileDataPath, getCoverFileDataPath, getManagedFileExt, saveManagedFile } from '@/core/bookStore'

const getPath = (_title: string, url: string, ext: string) => getBookFileDataPath(url, ext)
const load = async (path: string) => await fetch(path.startsWith('/assets/') || path.startsWith('/public/') ? path : '/api/file/getFile', path.startsWith('/assets/') || path.startsWith('/public/') ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) }).then(r => r.ok ? r.text() : null).catch(() => null)
const save = async (path: string, html: string) => saveManagedFile(new Blob([html], { type: 'text/html' }), path, path.split('/').pop()!)
const has = (html: string, i: number) => html.includes(`id="ch${i}"`)
const append = (html: string, i: number, title: string, content: string) => html.replace('</body>', `  <section id="ch${i}">\n    <h2>${title}</h2>\n${content.split(/\n+/).filter(Boolean).map(p => `    <p>${p}</p>`).join('\n')}\n  </section>\n</body>`)
const extract = (html: string, i: number) => {
  const m = html.match(new RegExp(`<section id="ch${i}">([\\s\\S]*?)</section>`))
  return m ? `<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <style>\n    body { max-width: 800px; margin: 0 auto; padding: 2em; font-size: 18px; line-height: 1.8; }\n    h2 { text-align: center; margin: 2em 0 1em; }\n    p { text-indent: 2em; margin: 1em 0; }\n  </style>\n</head>\n<body>\n  <section id="ch${i}">\n${m[1]}\n  </section>\n</body>\n</html>` : null
}

export const getCurrentChapter = (reader: any) => reader?.getBook?.()?.getCurrentChapter?.() ?? undefined

export async function addOnlineBook(book: any, preloadedChapters?: any[]) {
  const { bookSourceManager } = await import('@/utils/BookSearch')
  const { bookshelfManager } = await import('@/core/bookshelf')
  const chapters = preloadedChapters || await bookSourceManager.getChapters(book.sourceUrl || book.origin, book.tocUrl || book.bookUrl)
  if (!chapters.length) throw new Error('无法获取章节列表')

  const htmlPath = getPath(book.name, book.bookUrl, 'html')
  const loaded = (await Promise.all(chapters.slice(0, 3).map(async (ch: any, i: number) => {
    try {
      const content = (await bookSourceManager.getChapterContent(book.sourceUrl || book.origin, ch.url)).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
      return { i, name: ch.name, content }
    } catch { return null }
  }))).filter(Boolean)

  const sections = loaded.map(ch => `  <section id="ch${ch!.i}">\n    <h2>${ch!.name}</h2>\n${ch!.content.split(/\n+/).filter(Boolean).map(p => `    <p>${p}</p>`).join('\n')}\n  </section>`).join('\n')
  const publicHtmlPath = await save(htmlPath, `<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <title>${book.name}</title>\n  <style>\n    body { max-width: 800px; margin: 0 auto; padding: 2em; font-size: 18px; line-height: 1.8; }\n    section { margin-bottom: 3em; }\n    h2 { text-align: center; margin: 2em 0 1em; }\n    p { text-indent: 2em; margin: 1em 0; }\n  </style>\n</head>\n<body>\n${sections}\n</body>\n</html>`)

  let cover = ''
  if (book.coverUrl?.startsWith('http')) {
    try {
      const res = await fetch(book.coverUrl)
      if (res.ok) {
        const blob = await res.blob()
        const ext = getManagedFileExt(blob.type.split('/').pop() || book.coverUrl, 'jpg')
        const coverPath = getCoverFileDataPath(book.bookUrl, ext)
        cover = await saveManagedFile(blob, coverPath, coverPath.split('/').pop()!)
      }
    } catch {}
  }

  await bookshelfManager.addBook({
    url: book.bookUrl,
    title: book.name,
    author: book.author || '未知作者',
    cover,
    format: 'online',
    path: publicHtmlPath,
    size: 0,
    source: { origin: book.sourceUrl || book.origin, originName: book.sourceName || book.originName, bookUrl: book.bookUrl, tocUrl: book.tocUrl || book.bookUrl, kind: book.kind, intro: book.intro, wordCount: book.wordCount, lastChapter: book.lastChapter },
    tags: book.kind ? [book.kind] : []
  })
}

export async function refreshOnlineBook(book: any, onRefresh: () => Promise<void>, showMessage: (msg: string, duration: number, type: string) => void) {
  const { bookSourceManager } = await import('@/utils/BookSearch')
  const { bookshelfManager } = await import('@/core/bookshelf')
  const chapters = await bookSourceManager.getChapters(book.source.origin, book.source.tocUrl || book.url)
  const lastChapter = chapters[chapters.length - 1]?.name || book.source.lastChapter
  await bookshelfManager.updateBook(book.url, { total: chapters.length, source: { ...book.source, lastChapter } })
  await onRefresh()
  showMessage(`《${book.title}》已刷新，共${chapters.length}章`, 2000, 'info')
}

export async function loadOnlineBook(reader: any, info: any) {
  const { bookSourceManager } = await import('@/utils/BookSearch')
  const chapters = await bookSourceManager.getChapters(info.source.origin, info.source.tocUrl || info.url)
  let html = await load(info.path), currentChapter = 0, loading = new Set<number>()
  if (!html) throw new Error('书籍文件不存在')

  const loadChapter = async (i: number) => {
    if (has(html!, i) || loading.has(i)) return
    loading.add(i)
    try {
      const content = (await bookSourceManager.getChapterContent(info.source.origin, chapters[i].url)).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
      html = append(html!, i, chapters[i].name, content)
      await save(info.path, html!)
    } finally { loading.delete(i) }
  }

  await reader.open({
    metadata: { title: info.title, author: info.author, language: 'zh' },
    sections: chapters.map((ch: any, i: number) => ({
      id: `ch${i}`,
      load: async () => {
        currentChapter = i
        await loadChapter(i)
        html = await load(info.path) || html!
        const chapterHtml = extract(html!, i)
        if (!chapterHtml) throw new Error(`章节 ${i} 未找到`)
        return URL.createObjectURL(new Blob([chapterHtml], { type: 'text/html' }))
      }
    })),
    toc: chapters.map((ch: any, i: number) => ({ label: ch.name, href: `#ch${i}` })),
    resolveHref: async (href: string) => {
      const m = href.match(/#ch(\d+)/)
      if (m) { currentChapter = parseInt(m[1]); return { index: currentChapter, anchor: href } }
      return { index: 0 }
    },
    splitTOCHref: async (href: string) => { const m = href.match(/#ch(\d+)/); return m ? [`ch${m[1]}`, `ch${m[1]}`] : ['ch0', 'ch0'] },
    getCurrentChapter: () => currentChapter
  })
}
