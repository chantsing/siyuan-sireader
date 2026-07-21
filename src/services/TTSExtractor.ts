import { textWalker } from 'foliate-js/text-walker.js'

const textNodeFilter = (node: Node) => {
  if (node.nodeType !== Node.ELEMENT_NODE) return NodeFilter.FILTER_ACCEPT
  const el = node as Element
  return el.matches('script,style,svg,nav,link,meta') || ttsNodeFilter(node) === NodeFilter.FILTER_REJECT
    ? NodeFilter.FILTER_REJECT
    : NodeFilter.FILTER_SKIP
}

export const extractText = (root: Document | DocumentFragment | Element | Range | null) => {
  if (!root) return ''
  const join = function* (strs: string[]) { yield strs.join('') }
  return Array.from(textWalker(root, join, textNodeFilter)).join('')
    .replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

export const ttsNodeFilter = (node: Node) => {
  if (node.nodeType !== Node.ELEMENT_NODE) return NodeFilter.FILTER_ACCEPT
  const el = node as Element
  const tokens = [
    el.getAttribute('epub:type'),
    el.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type'),
    el.getAttribute('role'),
  ].join(' ')
  return el.matches('.epubtype-footnote,.duokan-footnote-content,.duokan-footnote-item,.md-footnotes')
    || /\b(footnote|endnote|rearnote|note|doc-footnote|doc-endnote)\b/i.test(tokens)
    ? NodeFilter.FILTER_REJECT
    : NodeFilter.FILTER_ACCEPT
}
