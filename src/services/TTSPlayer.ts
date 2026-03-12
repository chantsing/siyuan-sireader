// TTS 播放器：播放控制 + 高亮 + UI 交互
import { ref } from 'vue'
import { showMessage } from 'siyuan'
import { EdgeTTSCore, toArrayBuffer, loadLocalVoices } from './TTSEngine'
import { extractBlocks, TextIterator } from './TTSExtractor'

declare const window: any

// TTS 播放器
export class EdgeTTSPlayer {
  private tts = new EdgeTTSCore()
  private textIter: TextIterator
  private renderer: any
  private config: any
  private audioCtx = new AudioContext()
  private blocks: any[] = []
  private stopped = false
  private paused = false
  private loadQueue = Promise.resolve()
  private isLocal: boolean
  private currentSource: any = null
  private isPdf: boolean
  private pdfViewer: any = null

  constructor(doc: Document, renderer: any, config: any, startRange?: Range) {
    this.isLocal = false
    this.isPdf = doc.querySelectorAll('.textLayer').length > 0
    this.tts.setVoice(config.voice)
    this.textIter = new TextIterator(extractBlocks(doc, startRange))
    this.renderer = renderer
    this.config = config
    if (this.isPdf) {
      const container = doc.querySelector('.viewer-container')
      this.pdfViewer = (window as any).__pdfViewer || (container as any)?.__pdfViewer
    }
    // 异步检查是否为本地语音
    this.checkLocalVoice(config.voice)
  }

  private async checkLocalVoice(voiceName: string) {
    if (!voiceName) return
    const locals = await loadLocalVoices()
    this.isLocal = locals.some(v => v.name === voiceName)
  }

  private fillCache() {
    while (this.blocks.length < 3 && !this.stopped) {
      const item = this.blocks.length ? this.textIter.next() : this.textIter.first()
      if (!item) break
      const block: any = { text: item.text, range: item.range, buffer: null, source: null, loading: !this.isLocal, loaded: this.isLocal, aborted: false }
      this.blocks.push(block)
      !this.isLocal && (this.loadQueue = this.loadQueue.then(async () => {
        if (this.stopped || block.aborted) return void (block.loading = false)
        try {
          const buf = await this.tts.toStream(item.text, this.config.rate || 1)
          if (this.stopped || block.aborted) return void (block.loading = false)
          block.buffer = await this.audioCtx.decodeAudioData(toArrayBuffer(buf))
          block.loaded = true
        } catch { block.loaded = false } finally { block.loading = false }
      }).catch(() => (block.loading = false, block.loaded = false)))
    }
  }

  private async playBlock(block: any) {
    while (block.loading && !this.stopped && !this.paused) await new Promise(r => setTimeout(r, 50))
    if (this.stopped || this.paused || !block.loaded) return
    this.config.highlightText && block.range && (this.isPdf ? this.highlightPdf(block) : this.renderer?.scrollToAnchor?.(block.range, true))
    return this.isLocal ? this.playLocal(block) : this.playOnline(block)
  }

  private highlightPdf(block: any) {
    this.clearPdfHighlight()
    const layer = this.getTextLayer(block.range)
    if (!layer) return
    const spans = Array.from(layer.querySelectorAll('span')) as HTMLElement[]
    const fullText = spans.map(s => s.textContent || '').join('').toLowerCase()
    const matchPos = fullText.indexOf(block.text.toLowerCase())
    if (matchPos === -1) return
    let pos = 0, matchEnd = matchPos + block.text.length
    spans.forEach(span => {
      const text = span.textContent || '', start = pos, end = pos + text.length
      pos = end
      if (matchEnd <= start || matchPos >= end) return
      const relStart = Math.max(0, matchPos - start), relEnd = Math.min(text.length, matchEnd - start)
      if (relStart >= relEnd) return
      const frag = document.createDocumentFragment()
      relStart > 0 && frag.appendChild(document.createTextNode(text.substring(0, relStart)))
      const mark = document.createElement('mark')
      mark.className = 'tts-highlight'
      mark.textContent = text.substring(relStart, relEnd)
      frag.appendChild(mark)
      relEnd < text.length && frag.appendChild(document.createTextNode(text.substring(relEnd)))
      span.textContent = ''
      span.appendChild(frag)
    })
    if (this.config.autoTurnPage && this.pdfViewer) {
      const pageEl = layer.closest('[data-page]') as HTMLElement
      const page = pageEl && parseInt(pageEl.dataset.page || '1'), currentPage = this.pdfViewer.getCurrentPage?.() || 1
      page && page !== currentPage && this.pdfViewer.goToPage?.(page)
    }
  }

  private getTextLayer(range: Range) {
    const container = range.commonAncestorContainer
    return container.nodeType === Node.ELEMENT_NODE && (container as Element).classList.contains('textLayer')
      ? container as Element
      : (container as Node).parentElement?.closest('.textLayer')
  }

  private playLocal(block: any) {
    return new Promise<void>((resolve) => {
      if (this.stopped || this.paused) return resolve()
      const utterance = new SpeechSynthesisUtterance(block.text)
      const voice = window.speechSynthesis.getVoices().find((v: any) => v.name === this.config.voice)
      if (voice) utterance.voice = voice
      utterance.rate = this.config.rate || 1
      this.currentSource = utterance
      utterance.onend = utterance.onerror = () => (this.currentSource = null, resolve())
      window.speechSynthesis.speak(utterance)
    })
  }

  private playOnline(block: any) {
    if (block.buffer && !block.source) {
      const source = this.audioCtx.createBufferSource()
      source.buffer = block.buffer
      source.playbackRate.value = this.config.rate || 1
      source.connect(this.audioCtx.destination)
      block.source = source
    }
    if (!block.source) return
    return new Promise<void>((resolve) => {
      if (this.stopped || this.paused) return resolve()
      this.currentSource = block.source
      block.source.addEventListener('ended', () => (this.currentSource = null, resolve()), { once: true })
      try { block.source.start(0) } catch { this.currentSource = null; resolve() }
    })
  }

  private clearPdfHighlight() { document.querySelectorAll('.textLayer mark.tts-highlight').forEach(el => el.replaceWith(...el.childNodes)) }

  async play(fromCurrent = false) {
    this.stopped = this.paused = false
    !fromCurrent && (this.blocks = [], this.currentSource = null, this.fillCache())
    while (!this.stopped && !this.paused) {
      const block = this.blocks.shift()
      if (!block) break
      try { await this.playBlock(block); if (this.stopped || this.paused || !this.config.autoTurnPage) break; this.fillCache() } 
      catch (e) { if (!this.config.autoTurnPage) throw e }
    }
  }

  pause() { this.paused = true; this.isLocal ? window.speechSynthesis.pause() : this.currentSource?.context?.suspend() }
  resume() { if (!this.paused) return; this.paused = false; this.isLocal ? window.speechSynthesis.resume() : this.currentSource?.context?.resume() }

  stop() {
    this.stopped = true
    this.paused = false
    this.blocks.forEach(b => (b.aborted = true, b.source?.stop()))
    this.blocks = []
    this.currentSource && (this.isLocal ? window.speechSynthesis.cancel() : this.currentSource.stop(), this.currentSource = null)
    this.isPdf && this.clearPdfHighlight()
    this.tts.close()
  }
}

// TTS 控制器
export class TTSController {
  private player: EdgeTTSPlayer | null = null
  private loopText: string | null = null
  public isActive = ref(false)
  public paused = ref(false)

  async speak(text: string, config: any) {
    if (!config?.enabled || !text?.trim()) return
    this.stop()
    this.loopText = text.trim()
    this.isActive.value = true
    try { await this.playLoop(config) } 
    catch (error) { showMessage((error instanceof Error ? error.message : String(error)) || 'TTS 播放失败', 3000, 'error') } 
    finally { this.reset() }
  }

  private async playLoop(config: any) {
    while (this.loopText && !this.paused.value) {
      const doc = document.implementation.createHTMLDocument(), p = doc.createElement('p')
      p.textContent = this.loopText
      doc.body.appendChild(p)
      this.player = new EdgeTTSPlayer(doc, null, { ...config, autoTurnPage: true })
      await this.player.play()
      if (!this.loopText) break
    }
  }

  async toggle(getReader: () => any, config: any, selection?: { text: string; range?: Range }) {
    if (!config?.enabled) return
    if (this.isActive.value) return (this.paused.value = !this.paused.value, this.paused.value ? this.player?.pause() : this.player?.resume())
    this.stop()
    try {
      const { doc, renderer, location } = this.getDocument(getReader)
      if (!doc?.body) throw new Error('无法获取文档内容')
      const startRange = selection?.range || this.getSelection(getReader) || (renderer && this.getVisibleRange(renderer, doc, location))
      this.player = new EdgeTTSPlayer(doc, renderer, config, startRange)
      this.isActive.value = true
      await this.player.play()
      this.reset()
    } catch (error) { this.reset(); showMessage((error instanceof Error ? error.message : String(error)) || 'TTS 播放失败', 3000, 'error') }
  }

  cancelLoop() { this.loopText && this.destroy() }
  stop() { this.loopText = null; this.player?.stop(); this.player = null }
  destroy() { this.stop(); this.reset() }
  sync(enabled: boolean) { (!enabled || this.isActive.value) && this.destroy() }

  private getDocument(getReader: () => any) {
    const view = getReader()?.getView?.()
    let doc: Document | null = null, renderer: any = null, location: any = null
    if (view?.renderer) doc = view.renderer.getContents?.()?.[0]?.doc, renderer = view.renderer, location = view.lastLocation
    if (!doc?.body) doc = document, renderer = null, this.injectPdfStyle()
    return { doc, renderer, location }
  }

  private injectPdfStyle() {
    if (document.getElementById('tts-pdf-highlight-style')) return
    const style = document.createElement('style')
    style.id = 'tts-pdf-highlight-style'
    style.textContent = 'mark.tts-highlight{background:rgba(255,255,0,.4);color:inherit}'
    document.head.appendChild(style)
  }

  private getVisibleRange(renderer: any, doc: Document, location?: any) {
    try {
      const sel = doc.defaultView?.getSelection()
      if (sel && !sel.isCollapsed && sel.toString().trim()) return sel.getRangeAt(0)
      if (renderer?.lastVisibleRange) return renderer.lastVisibleRange
      if (location?.range) return location.range
      for (const tag of ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote']) {
        for (const el of Array.from(doc.querySelectorAll(tag))) {
          const text = el.textContent?.trim()
          if (text && text.length > 10) { const range = doc.createRange(); range.selectNodeContents(el); return range }
        }
      }
    } catch {}
  }

  private getSelection(getReader: () => any) {
    try {
      const reader = getReader()
      if (reader) {
        const contents = reader.getView()?.renderer?.getContents?.()
        if (contents) for (const { doc } of contents) {
          const sel = doc.defaultView?.getSelection()
          if (sel && !sel.isCollapsed && sel.toString().trim()) return sel.getRangeAt(0)
        }
      }
      const sel = document.getSelection()
      if (sel && !sel.isCollapsed && sel.toString().trim()) return sel.getRangeAt(0)
    } catch {}
  }

  private reset() { this.isActive.value = this.paused.value = false; this.player = null }
}

