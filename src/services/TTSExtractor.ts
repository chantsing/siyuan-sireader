// TTS 文本提取器：EPUB + PDF 文本提取
const BLOCK_TAGS = new Set(['article', 'aside', 'blockquote', 'div', 'dl', 'dt', 'dd', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'tr'])

// 提取文档块级元素（段落）- 支持 EPUB 和 PDF
export function* extractBlocks(doc: Document, startRange?: Range): Generator<Range> {
  // PDF 模式：从 textLayer 提取文本段落
  const textLayers = doc.querySelectorAll('.textLayer')
  if (textLayers.length > 0) {
    for (const layer of Array.from(textLayers)) {
      const spans = layer.querySelectorAll('span')
      if (spans.length === 0) continue
      
      // 按段落分组（连续的 span 合并为一个段落）
      let currentGroup: HTMLElement[] = []
      let lastBottom = -1
      
      for (const span of Array.from(spans) as HTMLElement[]) {
        const rect = span.getBoundingClientRect()
        const text = span.textContent?.trim()
        if (!text) continue
        
        // 如果垂直位置差距较大，说明是新段落
        if (lastBottom > 0 && Math.abs(rect.top - lastBottom) > 10) {
          if (currentGroup.length > 0) {
            const range = doc.createRange()
            range.setStartBefore(currentGroup[0])
            range.setEndAfter(currentGroup[currentGroup.length - 1])
            yield range
          }
          currentGroup = [span]
        } else {
          currentGroup.push(span)
        }
        lastBottom = rect.bottom
      }
      
      // 处理最后一组
      if (currentGroup.length > 0) {
        const range = doc.createRange()
        range.setStartBefore(currentGroup[0])
        range.setEndAfter(currentGroup[currentGroup.length - 1])
        yield range
      }
    }
    return
  }
  
  // EPUB 模式：提取块级元素
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT)
  let last: Range | null = null
  let startNode: Element | null = null
  
  if (startRange) {
    let node: Node | null = startRange.startContainer.nodeType === Node.TEXT_NODE ? startRange.startContainer.parentElement : startRange.startContainer
    while (node && !BLOCK_TAGS.has((node as Element).tagName?.toLowerCase())) node = node.parentElement
    if (node && BLOCK_TAGS.has((node as Element).tagName?.toLowerCase())) {
      startNode = node as Element
      walker.currentNode = doc.body
      while (walker.nextNode() !== startNode);
    }
  }
  
  for (let node = startNode || walker.nextNode(); node; node = walker.nextNode()) {
    if (BLOCK_TAGS.has((node as Element).tagName.toLowerCase())) {
      if (last) {
        last.setEndBefore(node)
        if (last.toString().trim()) yield last
      }
      last = doc.createRange()
      last.setStart(node, 0)
    }
  }
  
  if (last) {
    last.setEndAfter(doc.body.lastChild || doc.body)
    if (last.toString().trim()) yield last
  }
}

// 文本迭代器（缓存已读取的段落）
export class TextIterator {
  private arr: any[] = []
  private iter: Iterator<Range>
  private idx = -1

  constructor(iter: Iterator<Range>) { this.iter = iter }

  private getNext(targetIdx: number) {
    if (this.arr[targetIdx]) return (this.idx = targetIdx, this.arr[targetIdx])
    const { done, value } = this.iter.next()
    if (!done) {
      this.arr.push({ text: value.toString().trim(), range: value })
      return (this.idx = targetIdx, this.arr[targetIdx])
    }
    return null
  }

  first() { return this.getNext(0) }
  next() { return this.getNext(this.idx + 1) }
}
