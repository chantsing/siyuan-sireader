import { ref } from 'vue'
import { showMessage } from 'siyuan'
import { TTS } from 'foliate-js/tts.js'
import { textWalker } from 'foliate-js/text-walker.js'
import { Overlayer } from 'foliate-js/overlayer.js'
import { EdgeTTSCore, loadLocalVoices, toArrayBuffer } from './TTSEngine'
import { ttsNodeFilter } from './TTSExtractor'
import { OFFLINE_TTS_VOICE, synthesizeOfflineTTS } from './OfflineTTS'

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
  private readonly highlightKey = 'sireader-tts-current'
  private highlightedOverlayer: any = null
  private prefetched: Promise<{ ssml: string; audio?: Buffer } | null> | null = null
  private suppressHighlight = false
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
    if (!this.config.highlightText) this.clearHighlight()
    if (!voiceChanged) return
    this.edge.setVoice(config.voice)
    await this.checkLocalVoice(config.voice)
    this.prefetched = null
    !this.isLocal && this.stopCurrent()
  }

  private clearHighlight() {
    this.highlightedOverlayer?.remove?.(this.highlightKey)
    this.highlightedOverlayer = null
  }

  private highlighter = (range: Range) => {
    if (!this.config.highlightText || this.suppressHighlight) return
    this.renderer?.scrollToAnchor?.(range, false)
    const ownerDocument = range.startContainer.ownerDocument
    const content = this.renderer?.getContents?.().find((item: any) => item.doc === ownerDocument)
    if (!content?.overlayer) return
    this.clearHighlight()
    content.overlayer.add(this.highlightKey, range, Overlayer.highlight, {
      color: '#ffd54f',
      padding: 2,
      radius: 3,
    })
    this.highlightedOverlayer = content.overlayer
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
    const generated = new TTS(doc, textWalker, ttsNodeFilter, () => {}, 'sentence').start() || ''
    return this.textOf(generated).trim() ? generated : fallback
  }

  private markSSML(ssml = '', highlight = true) {
    const mark = /<mark\b[^>]*\bname="([^"]+)"/.exec(ssml)?.[1]
    const previous = this.suppressHighlight
    if (!highlight) this.suppressHighlight = true
    try {
      mark && this.foliateTTS?.setMark(mark)
      return this.ssmlOf(this.foliateTTS?.getLastRange?.(), ssml)
    } finally { this.suppressHighlight = previous }
  }

  private firstSSML(fromCurrent: boolean) {
    if (fromCurrent) return this.ssmlOf(this.foliateTTS?.getLastRange?.(), this.foliateTTS?.resume())
    const range = this.startRange
    this.startRange = undefined
    return this.markSSML(range
      ? this.foliateTTS?.from(range)
      : (this.foliateTTS?.start(), this.foliateTTS?.nextMark(false) || this.foliateTTS?.resume()), false)
  }

  private async nextSSML() {
    const ssml = this.foliateTTS?.nextMark(false)
    if (ssml) return this.markSSML(ssml, false)
    if (!this.view || !this.config.autoTurnPage) return ssml
    const doc = this.foliateTTS?.doc
    await this.view.next()
    await this.view.initTTS('sentence', ttsNodeFilter, this.highlighter)
    this.foliateTTS = this.view.tts
    if (this.foliateTTS?.doc === doc) return ''
    this.foliateTTS?.start()
    return this.markSSML(this.foliateTTS?.nextMark(false) || this.foliateTTS?.resume(), false)
  }

  private async playSSML(ssml: string, ticket: number, audio?: Buffer) {
    if (this.stopped || this.paused || ticket !== this.ticket || !ssml) return
    if (this.config.voice === OFFLINE_TTS_VOICE.name) return this.playOffline(ssml, ticket)
    this.config.onBlock?.(this.textOf(ssml))
    const range = this.foliateTTS?.getLastRange?.()
    range && this.highlighter(range)
    return this.isLocal ? this.playLocal(ssml, ticket) : this.playOnline(ssml, ticket, audio)
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

  private async synthesizeOnline(ssml: string) {
    const rate = this.config.rate || 1
    try {
      return await this.edge.toSSMLStream(ssml, rate)
    } catch (error) {
      if (!/timeout|no audio|websocket/i.test(String(error))) throw error
      this.edge.close()
      return this.edge.toSSMLStream(ssml, rate)
    }
  }

  private prefetchNext(ticket: number) {
    if (this.prefetched || this.stopped || this.paused || !this.config.autoTurnPage) return
    this.prefetched = (async () => {
      this.suppressHighlight = true
      try {
        const ssml = await this.nextSSML()
        if (!ssml || this.stopped || ticket !== this.ticket) return null
        try { return { ssml, audio: await this.synthesizeOnline(ssml) } }
        catch { return { ssml } }
      } finally { this.suppressHighlight = false }
    })()
  }

  private async playOnline(ssml: string, ticket: number, prepared?: Buffer) {
    const buf = prepared || await this.synthesizeOnline(ssml)
    const audio = toArrayBuffer(buf)
    if (this.stopped || this.paused || ticket !== this.ticket) return
    if (this.audioCtx.state !== 'running') await this.audioCtx.resume()
    const source = this.audioCtx.createBufferSource()
    source.buffer = await this.audioCtx.decodeAudioData(audio.slice(0))
    source.connect(this.audioCtx.destination)
    return new Promise<void>((resolve) => {
      if (this.stopped || this.paused || ticket !== this.ticket) return resolve()
      this.currentSource = source
      source.addEventListener('ended', () => (this.currentSource = null, resolve()), { once: true })
      try { source.start(0); this.prefetchNext(ticket) } catch { this.currentSource = null; resolve() }
    })
  }

  private async playOffline(ssml: string, ticket: number) {
    // Foliate's marked SSML contains the current mark and the remaining text
    // of the block. Online engines consume the marks, but offline synthesis
    // would read the remainder again on every mark. Synthesize only the range
    // that was just highlighted.
    const text = this.foliateTTS?.getLastRange?.()?.toString?.().trim() || this.textOf(ssml)
    return this.playOfflineText(text, ticket)
  }

  private async playOfflineText(text: string, ticket: number) {
    const audio = await synthesizeOfflineTTS(text, this.config.rate || 1)
    if (this.stopped || this.paused || ticket !== this.ticket) return
    if (this.audioCtx.state !== 'running') await this.audioCtx.resume()
    const buffer = this.audioCtx.createBuffer(1, audio.samples.length, audio.sampleRate)
    buffer.copyToChannel(audio.samples, 0)
    const source = this.audioCtx.createBufferSource()
    source.buffer = buffer
    source.connect(this.audioCtx.destination)
    return new Promise<void>((resolve) => {
      if (this.stopped || this.paused || ticket !== this.ticket) return resolve()
      this.currentSource = source
      source.addEventListener('ended', () => (this.currentSource = null, resolve()), { once: true })
      try { source.start(0) } catch { this.currentSource = null; resolve() }
    })
  }

  private async playFrom(ssml: string, ticket: number) {
    let prepared: Buffer | undefined
    while (!this.stopped && !this.paused && ticket === this.ticket && ssml) {
      const prev = this.foliateTTS?.getLastRange?.()
      if (this.config.voice === OFFLINE_TTS_VOICE.name) {
        // Piper inference is synchronous and single-threaded in WASM. Speak a
        // small batch of adjacent sentences so inference happens less often
        // and the hand-off between AudioBufferSourceNodes is inaudible.
        let text = this.foliateTTS?.getLastRange?.()?.toString?.().trim() || this.textOf(ssml)
        let count = 1
        while (text.length < 240 && count < 3) {
          const next = await this.nextSSML()
          if (!next) break
          const part = this.foliateTTS?.getLastRange?.()?.toString?.().trim() || this.textOf(next)
          if (!part) break
          text += part
          count++
        }
        this.config.onBlock?.(text)
        await this.playOfflineText(text, ticket)
      } else await this.playSSML(ssml, ticket, prepared)
      prepared = undefined
      if (this.stopped || this.paused || ticket !== this.ticket || !this.config.autoTurnPage) break
      const prefetched = this.prefetched
      this.prefetched = null
      if (prefetched) {
        const next = await prefetched
        ssml = next?.ssml || ''
        prepared = next?.audio
      } else ssml = await this.nextSSML()
      if (ssml) await this.delay(this.gapOf(prev, this.foliateTTS?.getLastRange?.()))
    }
  }

  private blockOf(range?: Range) {
    const node = range?.startContainer
    const el = node?.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement
    return el?.closest?.(BLOCK_SELECTOR)
  }

  private gapOf(prev?: Range, next?: Range) {
    const gap = this.blockOf(prev) && this.blockOf(prev) !== this.blockOf(next)
      ? this.config.paragraphGap ?? 0.3
      : this.config.sentenceGap ?? 0
    return 1000 * gap / (this.config.rate || 1)
  }

  private delay(ms: number) {
    return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve()
  }

  async play(fromCurrent = false) {
    await this.initPipeline()
    await this.voiceTask
    this.prefetched = null
    this.stopped = this.paused = false
    await this.playFrom(this.firstSSML(fromCurrent), ++this.ticket)
  }

  jump(delta: number): Promise<void> {
    if (!this.foliateTTS) return Promise.resolve()
    const ticket = ++this.ticket
    this.prefetched = null
    const seek = delta < 0 ? this.markSSML(this.foliateTTS.prevMark(false), false) : this.nextSSML()
    this.stopped = this.paused = false
    this.stopCurrent()
    return Promise.resolve(seek).then(ssml => this.playFrom(ssml, ticket)).then(() => undefined)
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
    this.clearHighlight()
    this.prefetched = null
    this.edge.close()
  }
}

export class TTSController {
  private player: EdgeTTSPlayer | null = null
  private loopText: string | null = null
  private operation = 0
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
      const operation = ++this.operation
      const player = new EdgeTTSPlayer(view || doc, { ...config, onBlock: (text: string) => this.currentText.value = text }, startRange)
      this.player = player
      this.isActive.value = true
      await player.play()
      if (this.operation === operation && this.player === player) this.reset()
    } catch (error) { this.reset(); showMessage((error instanceof Error ? error.message : String(error)) || 'TTS 播放失败', 3000, 'error') }
  }

  cancelLoop() { this.loopText && this.destroy() }
  updateConfig(config: any) { this.player?.updateConfig(config) }
  jump(delta: number) {
    if (!this.isActive.value || !this.player) return
    this.paused.value = false
    const operation = ++this.operation
    const player = this.player
    void player.jump(delta).then(() => { if (this.operation === operation && this.player === player) this.reset() })
  }
  togglePause() { if (this.isActive.value) this.paused.value = !this.paused.value, this.paused.value ? this.player?.pause() : this.player?.resume() }
  stop() { this.operation++; this.loopText = null; this.player?.stop(); this.player = null; this.currentText.value = '' }
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
