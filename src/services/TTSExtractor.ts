const BLOCK_TAGS = new Set(['article', 'aside', 'blockquote', 'div', 'dl', 'dt', 'dd', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'tr'])

export function* extractBlocks(doc: Document, startRange?: Range): Generator<Range> {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT)
  let last: Range | null = null
  let startNode: Element | null = null

  if (startRange) {
    let node: Node | null = startRange.startContainer.nodeType === Node.TEXT_NODE ? startRange.startContainer.parentElement : startRange.startContainer
    while (node && !BLOCK_TAGS.has((node as Element).tagName?.toLowerCase())) node = node.parentElement
    if (node && BLOCK_TAGS.has((node as Element).tagName?.toLowerCase())) {
      startNode = node as Element
      while (walker.nextNode() !== startNode);
    }
  }

  for (let node = startNode || walker.nextNode(); node; node = walker.nextNode()) {
    if (!BLOCK_TAGS.has((node as Element).tagName.toLowerCase())) continue
    if (last) {
      last.setEndBefore(node)
      if (last.toString().trim()) yield last
    }
    last = doc.createRange()
    last.setStart(node, 0)
  }

  if (last) {
    last.setEndAfter(doc.body.lastChild || doc.body)
    if (last.toString().trim()) yield last
  }
}

export class TextIterator {
  private arr: any[] = []
  private iter: Iterator<Range>
  private idx = -1

  constructor(iter: Iterator<Range>) { this.iter = iter }

  get(targetIdx: number) {
    if (targetIdx < 0) return null
    if (this.arr[targetIdx]) return (this.idx = targetIdx, this.arr[targetIdx])
    while (this.arr.length <= targetIdx) {
      const { done, value } = this.iter.next()
      if (done) return null
      this.arr.push({ index: this.arr.length, text: value.toString().trim(), range: value })
    }
    return (this.idx = targetIdx, this.arr[targetIdx])
  }

  next() { return this.get(this.idx + 1) }
}
