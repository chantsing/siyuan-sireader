import { ref } from 'vue'
import { showMessage } from 'siyuan'
import { TTS } from 'foliate-js/tts.js'
import { textWalker } from 'foliate-js/text-walker.js'
import { EdgeTTSCore, loadLocalVoices, toArrayBuffer } from './TTSEngine'
import { ttsNodeFilter } from './TTSExtractor'

declare const window: any
const BLOCK_SELECTOR = 'article,aside,blockquote,div,dl,dt,dd,figure,footer,form,h1,h2,h3,h4,h5,h6,header,li,main,ol,p,pre,section,tr'

export class EdgeTTSPlayer {
  private edge = new EdgeTTSCore()
  private foliateTTS: any
  private view: any
  private doc?: Document
  private renderer: any
  private startRange?: Range
  private config: any
  private audioCtx = new AudioContext()
  private stopped = false
  private paused = false
  private isLocal = false
  private currentSource: any = null
  private voiceTask: Promise<void>
  private ticket = 0

  constructor(source: Document | any, config: any, startRange?: Range) {
    this.view = source?.initTTS ? source : null
    this.doc = this.view ? undefined : source
    this.renderer = this.view?.renderer
    this.config = config
    this.startRange = startRange
    this.edge.setVoice(config.voice)
    this.voiceTask = this.checkLocalVoice(config.voice)
  }

  private async checkLocalVoice(voiceName: string) {
    if (!voiceName) return
    const locals = await loadLocalVoices()
    this.isLocal = locals.some(v => v.name === voiceName)
  }

  async updateConfig(config: any) {
    const voiceChanged = config.voice && config.voice !== this.config.voice
    this.config = { ...this.config, ...config }
    if (!voiceChanged) return
    this.edge.setVoice(config.voice)
    await this.checkLocalVoice(config.voice)
    !this.isLocal && this.stopCurrent()
  }

  private highlighter = (range: Range) => {
    this.config.highlightText && this.renderer?.scrollToAnchor?.(range, true)
  }

  private stopCurrent() {
    try { this.isLocal ? window.speechSynthesis.cancel() : this.currentSource?.stop?.() } catch {}
    this.currentSource = null
  }

  private async initPipeline() {
    if (this.view) {
      await this.view.initTTS('sentence', ttsNodeFilter, this.highlighter)
      this.foliateTTS = this.view.tts
      this.renderer = this.view.renderer
    } else if (this.doc) {
      this.foliateTTS ||= new TTS(this.doc, textWalker, ttsNodeFilter, this.highlighter, 'sentence')
    }
  }

  private textOf(ssml: string) {
    try { return new DOMParser().parseFromString(ssml, 'application/xml').documentElement?.textContent?.trim() || '' }
    catch { return ssml.replace(/<[^>]+>/g, ' ').trim() }
  }

  private ssmlOf(range?: Range, fallback = '') {
    if (!range) return fallback
    const doc = document.implementation.createHTMLDocument()
    doc.body.appendChild(range.cloneContents())
    return new TTS(doc, textWalker, ttsNodeFilter, () => {}, 'sentence').start() || fallback
  }

  private markSSML(ssml = '') {
    const mark = /<mark\b[^>]*\bname="([^"]+)"/.exec(ssml)?.[1]
    mark && this.foliateTTS?.setMark(mark)
    return this.ssmlOf(this.foliateTTS?.getLastRange?.(), ssml)
  }

  private firstSSML(fromCurrent: boolean) {
    if (fromCurrent) return this.ssmlOf(this.foliateTTS?.getLastRange?.(), this.foliateTTS?.resume())
    const range = this.startRange
    this.startRange = undefined
    return this.markSSML(range
      ? this.foliateTTS?.from(range)
      : (this.foliateTTS?.start(), this.foliateTTS?.nextMark(this.config.highlightText) || this.foliateTTS?.resume()))
  }

  private async nextSSML(paused = false) {
    const ssml = this.foliateTTS?.nextMark(paused || this.config.highlightText)
    if (ssml || !this.view || !this.config.autoTurnPage) return ssml
    const doc = this.foliateTTS?.doc
    await this.view.next()
    await this.view.initTTS('sentence', ttsNodeFilter, this.highlighter)
    this.foliateTTS = this.view.tts
    if (this.foliateTTS?.doc === doc) return ''
    this.foliateTTS?.start()
    return this.markSSML(this.foliateTTS?.nextMark(paused || this.config.highlightText) || this.foliateTTS?.resume())
  }

  private async playSSML(ssml: string, ticket: number) {
    if (this.stopped || this.paused || ticket !== this.ticket || !ssml) return
    this.config.onBlock?.(this.textOf(ssml))
    const range = this.foliateTTS?.getLastRange?.()
    this.config.highlightText && range && this.renderer?.scrollToAnchor?.(range, true)
    return this.isLocal ? this.playLocal(ssml, ticket) : this.playOnline(ssml, ticket)
  }

  private playLocal(ssml: string, ticket: number) {
    return new Promise<void>((resolve) => {
      if (this.stopped || this.paused || ticket !== this.ticket) return resolve()
      const utterance = new SpeechSynthesisUtterance(this.textOf(ssml))
      const voice = window.speechSynthesis.getVoices().find((v: any) => v.name === this.config.voice)
      if (voice) utterance.voice = voice
      utterance.rate = this.config.rate || 1
      utterance.pitch = this.config.pitch || 1
      this.currentSource = utterance
      utterance.onend = utterance.onerror = () => (this.currentSource = null, resolve())
      window.speechSynthesis.speak(utterance)
    })
  }

  private async playOnline(ssml: string, ticket: number) {
    const buf = await this.edge.toSSMLStream(ssml, this.config.rate || 1, this.config.pitch || 1)
    if (this.stopped || this.paused || ticket !== this.ticket) return
    const source = this.audioCtx.createBufferSource()
    source.buffer = await this.audioCtx.decodeAudioData(toArrayBuffer(buf))
    source.connect(this.audioCtx.destination)
    return new Promise<void>((resolve) => {
      if (this.stopped || this.paused || ticket !== this.ticket) return resolve()
      this.currentSource = source
      source.addEventListener('ended', () => (this.currentSource = null, resolve()), { once: true })
      try { source.start(0) } catch { this.currentSource = null; resolve() }
    })
  }

  private async playFrom(ssml: string, ticket: number) {
    while (!this.stopped && !this.paused && ticket === this.ticket && ssml) {
      await this.playSSML(ssml, ticket)
      if (this.stopped || this.paused || ticket !== this.ticket || !this.config.autoTurnPage) break
      const prev = this.foliateTTS?.getLastRange?.()
      ssml = await this.nextSSML()
      if (ssml) await this.delay(this.gapOf(prev, this.foliateTTS?.getLastRange?.()))
    }
  }

  private blockOf(range?: Range) {
    const node = range?.startContainer
    const el = node?.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement
    return el?.closest?.(BLOCK_SELECTOR)
  }

  private gapOf(prev?: Range, next?: Range) {
    return 1000 * (this.blockOf(prev) && this.blockOf(prev) !== this.blockOf(next)
      ? this.config.paragraphGap ?? 0.3
      : this.config.sentenceGap ?? 0)
  }

  private delay(ms: number) {
    return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve()
  }

  async play(fromCurrent = false) {
    await this.initPipeline()
    await this.voiceTask
    this.stopped = this.paused = false
    await this.playFrom(this.firstSSML(fromCurrent), ++this.ticket)
  }

  jump(delta: number) {
    if (!this.foliateTTS) return
    const ticket = ++this.ticket
    const seek = delta < 0 ? this.markSSML(this.foliateTTS.prevMark(true)) : this.nextSSML(true)
    this.stopped = this.paused = false
    this.stopCurrent()
    Promise.resolve(seek).then(ssml => this.playFrom(ssml, ticket))
  }

  pause() { this.paused = true; this.isLocal ? window.speechSynthesis.pause() : this.currentSource?.context?.suspend() }
  resume() {
    if (!this.paused) return
    this.paused = false
    this.isLocal ? window.speechSynthesis.resume() : this.currentSource?.context?.resume()
    !this.currentSource && this.play(true)
  }

  stop() {
    this.stopped = true
    this.paused = false
    this.ticket++
    this.stopCurrent()
    this.edge.close()
  }
}

export class TTSController {
  private player: EdgeTTSPlayer | null = null
  private loopText: string | null = null
  public isActive = ref(false)
  public paused = ref(false)
  public title = ref('')
  public currentText = ref('')

  async speak(text: string, config: any, title = '选中文本') {
    if (!config?.enabled || !text?.trim()) return
    this.stop()
    this.loopText = text.trim()
    this.title.value = title
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
      this.player = new EdgeTTSPlayer(doc, { ...config, autoTurnPage: true, onBlock: (text: string) => this.currentText.value = text })
      await this.player.play()
      if (!this.loopText) break
    }
  }

  async toggle(getReader: () => any, config: any, selection?: { text: string; range?: Range }, title = '朗读中') {
    if (!config?.enabled) return
    if (this.isActive.value) return this.togglePause()
    this.stop()
    try {
      const { view, doc, renderer, location } = this.getDocument(getReader)
      if (!view && !doc?.body) throw new Error('无法获取文档内容')
      const startRange = selection?.range || (renderer && doc && this.getVisibleRange(renderer, doc, location))
      this.title.value = title
      this.player = new EdgeTTSPlayer(view || doc, { ...config, onBlock: (text: string) => this.currentText.value = text }, startRange)
      this.isActive.value = true
      await this.player.play()
      this.reset()
    } catch (error) { this.reset(); showMessage((error instanceof Error ? error.message : String(error)) || 'TTS 播放失败', 3000, 'error') }
  }

  cancelLoop() { this.loopText && this.destroy() }
  updateConfig(config: any) { this.player?.updateConfig(config) }
  jump(delta: number) { if (this.isActive.value) this.paused.value = false, this.player?.jump(delta) }
  togglePause() { if (this.isActive.value) this.paused.value = !this.paused.value, this.paused.value ? this.player?.pause() : this.player?.resume() }
  stop() { this.loopText = null; this.player?.stop(); this.player = null; this.currentText.value = '' }
  destroy() { this.stop(); this.reset() }
  sync(enabled: boolean) { !enabled && this.destroy() }

  private getDocument(getReader: () => any) {
    const view = getReader()?.getView?.()
    let doc: Document | null = null, renderer: any = null, location: any = null
    if (view?.renderer) doc = view.renderer.getContents?.()?.[0]?.doc, renderer = view.renderer, location = view.lastLocation
    if (!doc?.body) doc = document, renderer = null
    return { view, doc, renderer, location }
  }

  private getVisibleRange(renderer: any, doc: Document, location?: any) {
    try {
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

  private reset() { this.isActive.value = this.paused.value = false; this.player = null; this.title.value = ''; this.currentText.value = '' }
}

let globalTTSController: TTSController | null = null
export const getTTSController = () => globalTTSController || (globalTTSController = new TTSController())
