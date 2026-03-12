// TTS 引擎：WebSocket 通信 + 语音管理 + Edge TTS 核心
declare const window: any
const { randomBytes, createHash } = window.require('crypto')
const { URL } = window.require('url')
const net = window.require('net')
const tls = window.require('tls')
const stream = window.require('stream')

const CHROMIUM_VERSION = '143.0.3650.75'
const TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const WINDOWS_EPOCH = 11644473600n
const OUTPUT_FORMAT = 'webm-24khz-16bit-mono-opus'
const VOICES_URL = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=${TRUSTED_TOKEN}`
const CACHE_TTL = 24 * 60 * 60 * 1000

// 生成令牌
const generateToken = () => {
  const ticks = BigInt(Math.floor(Date.now() / 1000 + Number(WINDOWS_EPOCH))) * 10000000n
  return createHash('sha256').update(`${ticks - (ticks % 3000000000n)}${TRUSTED_TOKEN}`, 'ascii').digest('hex').toUpperCase()
}

// 组合 URL
const combineUrl = (url: string) => `${url}?TrustedClientToken=${TRUSTED_TOKEN}&Sec-MS-GEC=${generateToken()}&Sec-MS-GEC-Version=1-${CHROMIUM_VERSION}`

// Buffer 转 ArrayBuffer
export const toArrayBuffer = (buf: Buffer) => {
  const ab = new ArrayBuffer(buf.length)
  new Uint8Array(ab).set(buf)
  return ab
}

// ============ WebSocket 实现 ============
class NodeWebSocket {
  private url: any
  private options: any
  private socket: any
  private buffer = Buffer.alloc(0)
  private isHandshakeComplete = false
  public readyState = 0
  private fragments: Buffer[] = []
  private fragmentOpcode = 0
  public onopen?: () => void
  public onmessage?: (evt: { data: string | Blob }) => void
  public onerror?: (err: Error) => void
  public onclose?: () => void

  constructor(url: string, options: any = {}) {
    this.url = new URL(url)
    this.options = options
  }

  connect() {
    const isSecure = this.url.protocol === 'wss:'
    const port = this.url.port || (isSecure ? 443 : 80)
    const connectOptions = { host: this.options.host || this.url.hostname, port, rejectUnauthorized: this.options.rejectUnauthorized !== false }
    
    this.socket = (isSecure ? tls : net).connect(connectOptions, () => this._sendHandshake())
    this.socket.on('data', (data: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, data])
      this.isHandshakeComplete ? this._processFrames() : this._handleHandshake()
    })
    this.socket.on('close', () => (this.readyState = 3, this.onclose?.()))
    this.socket.on('error', (err: any) => {
      if (err.code === 'ECONNRESET' || err.code === 'EPIPE') return (this.readyState = 3, this.onclose?.())
      this.readyState = 3
      this.onerror?.(err)
    })
  }

  send(data: string | Buffer) {
    if (this.readyState !== 1) throw new Error('WebSocket is not open')
    const opcode = typeof data === 'string' ? 0x1 : 0x2
    const payload = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
    this._writeFrame(opcode, payload)
  }

  close() {
    if (this.readyState === 3) return
    this.readyState = 2
    this.fragments = []
    this.fragmentOpcode = 0
    const payload = Buffer.alloc(2)
    payload.writeUInt16BE(1000, 0)
    this._writeFrame(0x8, payload)
  }

  private _sendHandshake() {
    const key = randomBytes(16).toString('base64')
    const headers = [
      `GET ${this.url.pathname}${this.url.search} HTTP/1.1`,
      `Host: ${this.url.hostname}:${this.url.port || (this.url.protocol === 'wss:' ? 443 : 80)}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13'
    ]
    this.options.origin && headers.push(`Origin: ${this.options.origin}`)
    if (this.options.headers) {
      for (const [k, v] of Object.entries(this.options.headers)) {
        k.toLowerCase() !== 'origin' && headers.push(`${k}: ${v}`)
      }
    }
    this.socket.write(headers.join('\r\n') + '\r\n\r\n')
  }

  private _handleHandshake() {
    const idx = this.buffer.indexOf('\r\n\r\n')
    if (idx === -1) return
    const headers = this.buffer.subarray(0, idx).toString().split('\r\n')
    this.buffer = this.buffer.subarray(idx + 4)
    if (!headers[0].includes('101')) {
      const err = new Error(`Unexpected server response: ${headers[0]}`)
      this.onerror?.(err)
      return this.socket.end()
    }
    this.isHandshakeComplete = true
    this.readyState = 1
    this.onopen?.()
    this.buffer.length > 0 && this._processFrames()
  }

  private _writeFrame(opcode: number, payload: Buffer) {
    if (this.socket.destroyed || !this.socket.writable) return
    const length = payload.length
    let frameSize = 2
    let lengthByte = length < 126 ? length : length < 65536 ? (frameSize += 2, 126) : (frameSize += 8, 127)
    frameSize += 4
    const frame = Buffer.alloc(frameSize + length)
    frame[0] = 0x80 | opcode
    frame[1] = 0x80 | lengthByte
    let payloadOffset = 2
    if (lengthByte === 126) {
      frame.writeUInt16BE(length, 2)
      payloadOffset += 2
    } else if (lengthByte === 127) {
      frame.writeUInt32BE(0, 2)
      frame.writeUInt32BE(length, 6)
      payloadOffset += 8
    }
    const maskKey = randomBytes(4)
    maskKey.copy(frame, payloadOffset)
    payloadOffset += 4
    for (let i = 0; i < length; i++) frame[payloadOffset + i] = payload[i] ^ maskKey[i % 4]
    this.socket.write(frame)
  }

  private _processFrames() {
    while (this.buffer.length >= 2) {
      const firstByte = this.buffer[0]
      const secondByte = this.buffer[1]
      const fin = (firstByte & 0x80) === 0x80
      const opcode = firstByte & 0x0F
      const masked = (secondByte & 0x80) === 0x80
      let payloadLen = secondByte & 0x7F
      let headerSize = 2
      if (payloadLen === 126) {
        if (this.buffer.length < 4) return
        payloadLen = this.buffer.readUInt16BE(2)
        headerSize += 2
      } else if (payloadLen === 127) {
        if (this.buffer.length < 10) return
        payloadLen = this.buffer.readUInt32BE(6)
        headerSize += 8
      }
      if (masked) headerSize += 4
      if (this.buffer.length < headerSize + payloadLen) return
      let payload = this.buffer.subarray(headerSize, headerSize + payloadLen)
      if (masked) {
        const maskKey = this.buffer.subarray(headerSize - 4, headerSize)
        const unmasked = Buffer.alloc(payload.length)
        for (let i = 0; i < payload.length; i++) unmasked[i] = payload[i] ^ maskKey[i % 4]
        payload = unmasked
      }
      this.buffer = this.buffer.subarray(headerSize + payloadLen)
      if (opcode === 0x0) {
        if (this.fragmentOpcode === 0) continue
        this.fragments.push(payload)
        if (fin) {
          const fullPayload = Buffer.concat(this.fragments)
          this.fragmentOpcode === 0x1 ? this.onmessage?.({ data: fullPayload.toString('utf8') }) : this.onmessage?.({ data: new Blob([fullPayload]) })
          this.fragments = []
          this.fragmentOpcode = 0
        }
      } else if (opcode === 0x1 || opcode === 0x2) {
        if (!fin) {
          this.fragmentOpcode = opcode
          this.fragments.push(payload)
        } else {
          opcode === 0x1 ? this.onmessage?.({ data: payload.toString('utf8') }) : this.onmessage?.({ data: new Blob([payload]) })
        }
      } else if (opcode === 0x8) {
        this.close()
      }
    }
  }
}

// ============ 语音管理 ============
export interface TTSVoice {
  name: string
  displayName: string
  locale: string
  gender: 'Male' | 'Female'
  isLocal?: boolean
}

let voiceCache: { at: number; voices: TTSVoice[] } | null = null

export async function loadOnlineVoices(): Promise<TTSVoice[]> {
  if (voiceCache && Date.now() - voiceCache.at < CACHE_TTL) return voiceCache.voices
  try {
    const res = await fetch(VOICES_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const voices: TTSVoice[] = data.map((v: any) => ({
      name: v.ShortName || v.Name,
      displayName: v.FriendlyName || v.DisplayName || v.ShortName,
      locale: v.Locale,
      gender: v.Gender === 'Male' ? 'Male' : 'Female',
      isLocal: false
    }))
    voiceCache = { at: Date.now(), voices }
    return voices
  } catch (error) {
    return voiceCache?.voices || []
  }
}

export async function loadLocalVoices(): Promise<TTSVoice[]> {
  if (!('speechSynthesis' in window)) return []
  let voices = window.speechSynthesis.getVoices()
  if (!voices.length) {
    voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
      const handler = () => {
        const v = window.speechSynthesis.getVoices()
        if (v.length) {
          window.speechSynthesis.removeEventListener('voiceschanged', handler)
          resolve(v)
        }
      }
      window.speechSynthesis.addEventListener('voiceschanged', handler)
      setTimeout(() => {
        window.speechSynthesis.removeEventListener('voiceschanged', handler)
        resolve(window.speechSynthesis.getVoices())
      }, 2000)
    })
  }
  return voices.map(v => ({ name: v.name, displayName: v.name, locale: v.lang || '', gender: 'Female' as const, isLocal: true }))
}

// ============ Edge TTS 核心 ============
export class EdgeTTSCore {
  private ws: any
  private queue: any = {}
  private end: any = {}
  private wsPromise: any = null
  private voice = ''

  async init(voice: string) {
    if (this.wsPromise && this.voice === voice) return this.wsPromise
    if (this.ws) this.ws.close()
    this.voice = voice
    this.queue = {}
    this.end = {}

    this.wsPromise = new Promise((resolve, reject) => {
      const msgQueue: any[] = []
      let i = 0
      
      const checkSend = (id: string, idx: number) => {
        if (!this.end[id] || msgQueue.slice(0, idx + 1).some(m => !m || m.id === null)) return
        msgQueue.slice(0, idx + 1).filter(m => m?.id === id && m.data).forEach(m => this.queue[id].push(m.data))
        this.queue[id].push(null)
      }

      this.ws = new NodeWebSocket(combineUrl('wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'), {
        host: 'speech.platform.bing.com',
        origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        headers: {
          'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_VERSION.split('.')[0]}.0.0.0 Safari/537.36 Edg/${CHROMIUM_VERSION.split('.')[0]}.0.0.0`,
          'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold'
        },
        rejectUnauthorized: false
      })

      this.ws.connect()
      this.ws.onmessage = (m: any) => {
        if (typeof m.data === 'string') {
          const id = /X-RequestId:(.*?)\r\n/.exec(Buffer.from(m.data).toString())?.[1]
          if (id) {
            msgQueue[i] = m.data.includes('Path:turn.end') ? (this.end[id] = i, { id, type: 'end' }) : { id, type: m.data.includes('Path:turn.start') || m.data.includes('Path:response') ? 'ignore' : undefined }
            checkSend(id, i)
          }
        } else if (m.data instanceof Blob) {
          const cur = i
          msgQueue[cur] = { id: null }
          m.data.arrayBuffer().then((buf: ArrayBuffer) => {
            const data = Buffer.from(buf)
            const id = /X-RequestId:(.*?)\r\n/.exec(data.toString())?.[1]
            msgQueue[cur] = id && !(data[0] === 0x00 && data[1] === 0x67 && data[2] === 0x58) 
              ? { id, data: Buffer.from(data.subarray(data.indexOf('Path:audio\r\n') + 12)) }
              : { id, type: 'ignore' }
            checkSend(id, this.end[id] || -1)
          })
        }
        i++
      }

      this.ws.onclose = () => this.wsPromise = null
      this.ws.onopen = () => {
        this.ws.send(`Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"outputFormat":"${OUTPUT_FORMAT}"}}}}`)
        resolve(this.ws)
      }
      this.ws.onerror = reject
    })

    return this.wsPromise
  }

  async toStream(text: string, rate = 1): Promise<Buffer> {
    await this.init(this.voice)
    const id = randomBytes(16).toString('hex')
    const rateVal = Math.round((rate - 1) * 100)
    const rateStr = `${rateVal >= 0 ? '+' : ''}${rateVal}%`
    const locale = /([a-z]{2}-[A-Z]{2})/.exec(this.voice)?.[1] || 'zh-CN'
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}"><voice name="${this.voice}"><prosody rate="${rateStr}">${text}</prosody></voice></speak>`
    
    const readable = new stream.Readable({ read() {} })
    this.queue[id] = readable
    this.ws.send(`X-RequestId:${id}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`)
    
    return new Promise((resolve, reject) => {
      const buffers: Buffer[] = []
      const timeout = setTimeout(() => reject(new Error('TTS timeout')), 30000)
      const cleanup = () => clearTimeout(timeout)
      
      readable.on('data', (d: Buffer) => buffers.push(d))
      readable.on('close', () => (cleanup(), buffers.length ? resolve(Buffer.concat(buffers)) : reject(new Error('No audio'))))
      readable.on('error', (e: any) => (cleanup(), reject(e)))
    })
  }

  setVoice(voice: string) { this.voice = voice }
  close() { this.ws?.close(); this.wsPromise = null }
}
