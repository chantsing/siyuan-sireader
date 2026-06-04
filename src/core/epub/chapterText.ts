import type { TOCItem } from './types'

const flattenToc = (items: TOCItem[], level = 0): Array<{ item: TOCItem; level: number }> =>
  items.flatMap(item => [{ item, level }, ...(item.subitems?.length ? flattenToc(item.subitems, level + 1) : [])])

const elementFromAnchor = (anchor: any): Element | null => {
  if (!anchor) return null
  if (anchor instanceof Element) return anchor
  if (anchor instanceof Range) {
    const node = anchor.startContainer
    return node instanceof Element ? node : node.parentElement
  }
  return null
}

const normalizeText = (root: Element | DocumentFragment | null) => {
  if (!root) return ''
  const copy = root.cloneNode(true) as Element | DocumentFragment
  if ('querySelectorAll' in copy) {
    copy.querySelectorAll('script,style,svg,nav,link,meta').forEach(el => el.remove())
    copy.querySelectorAll('br').forEach(el => el.replaceWith('\n'))
    copy.querySelectorAll('p,div,section,article,header,footer,h1,h2,h3,h4,h5,h6,li,blockquote,tr').forEach(el => el.append('\n'))
  }
  return (copy.textContent || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

const createRange = (doc: Document, startAnchor: any, endAnchor?: any) => {
  const range = doc.createRange()
  const body = doc.body || doc.documentElement
  const startEl = elementFromAnchor(startAnchor)
  const endEl = elementFromAnchor(endAnchor)
  if (startAnchor instanceof Range) range.setStart(startAnchor.startContainer, startAnchor.startOffset)
  else if (startEl) range.setStartBefore(startEl)
  else range.setStart(body, 0)
  if (endAnchor instanceof Range) range.setEnd(endAnchor.startContainer, endAnchor.startOffset)
  else if (endEl) range.setEndBefore(endEl)
  else range.setEndAfter(body.lastChild || body)
  return range
}

const resolveTarget = async (book: any, href = '') => {
  try {
    return href ? await book?.resolveHref?.(href) : null
  } catch {
    return null
  }
}

export const getTocChapterText = async (book: any, href: string, label: string) => {
  const sections = book?.sections || []
  const startTarget = await resolveTarget(book, href)
  const startIndex = Number(startTarget?.index)
  if (!book || !sections.length || !Number.isInteger(startIndex)) throw new Error('无法定位章节内容')

  const flat = flattenToc((book.toc || []) as TOCItem[])
  const currentIndex = flat.findIndex(entry => entry.item.href === href)
  const currentLevel = currentIndex >= 0 ? flat[currentIndex].level : 0
  const next = currentIndex >= 0 ? flat.slice(currentIndex + 1).find(entry => entry.item.href && entry.level <= currentLevel) : undefined
  const endTarget = next?.item.href ? await resolveTarget(book, next.item.href) : null
  const endIndex = Number(endTarget?.index)
  const lastIndex = Number.isInteger(endIndex) && endIndex > startIndex ? Math.min(endIndex - 1, sections.length - 1) : startIndex
  const parts: string[] = [label]

  for (let index = startIndex; index <= lastIndex; index++) {
    const doc = await sections[index]?.createDocument?.()
    if (!doc) continue
    const startAnchor = index === startIndex ? startTarget.anchor?.(doc) : null
    const endAnchor = endTarget && endIndex === index ? endTarget.anchor?.(doc) : null
    const range = index === startIndex || endAnchor ? createRange(doc, startAnchor, endAnchor) : null
    const text = normalizeText(range ? range.cloneContents() : doc.body || doc.documentElement)
    if (text) parts.push(text)
  }

  const text = parts.filter(Boolean).join('\n\n').trim()
  if (!text || text === label) throw new Error('未提取到章节内容')
  return text
}
