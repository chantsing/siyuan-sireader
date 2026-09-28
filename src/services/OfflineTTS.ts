import loadBZip2WASM from 'bzip2-wasm/bzip2-1.0.8/bzip2.mjs'
import createWasmModule from '@/libs/sherpa-onnx/sherpa-onnx-wasm'
import { createOfflineTts } from '@/libs/sherpa-onnx/sherpa-onnx-tts'
import pluginInfo from '@/../plugin.json'

const ROOT = '/data/public/siyuan-sireader/tts'
const PACK_ID = 'zh-CN-xiao-ya'
export const PACK_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-zh_CN-xiao_ya-medium-int8.tar.bz2'
export const OFFLINE_TTS_VOICE = { name: 'offline:zh-CN-xiao-ya', displayName: '中文 · 小雅（离线）', locale: 'zh-CN', isOffline: true }

export type OfflineTTSPack = { id: string; name: string; size: number; installed: boolean; progress?: number }
export const OFFLINE_TTS_PACK: OfflineTTSPack = { id: PACK_ID, name: 'Chinese · Xiao Ya (Piper)', size: 14011298, installed: false }

class BZip2 {
  private module: any
  async init() { this.module ||= await loadBZip2WASM({ locateFile: (file: string) => file.includes('.wasm') ? new URL('bzip2-wasm/bzip2-1.0.8/bzip2.wasm', import.meta.url).href : file }); return this }
  decompress(compressed: Uint8Array, decompressedLength: number) {
    const m = this.module, source = m._malloc(compressed.length), dest = m._malloc(decompressedLength), length = m._malloc(4)
    m.HEAPU8.set(compressed, source); m.setValue(length, decompressedLength, 'i32')
    const code = m._BZ2_bzBuffToBuffDecompress(dest, length, source, compressed.length, 0, 0)
    const size = m.getValue(length, 'i32'), result = new Uint8Array(m.HEAPU8.subarray(dest, dest + size))
    m._free(source); m._free(dest); m._free(length)
    if (code !== 0) throw new Error(`bzip2 decompression failed (${code})`)
    return result
  }
}

const trimTarName = (bytes: Uint8Array) => new TextDecoder().decode(bytes).replace(/\0.*$/, '').trim()
const octal = (bytes: Uint8Array) => parseInt(trimTarName(bytes).replace(/[^0-7]/g, '') || '0', 8)

export const tarEntries = (tar: Uint8Array) => {
  const files: { name: string; data: Uint8Array }[] = []
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (!header.some(Boolean)) break
    const name = trimTarName(header.subarray(0, 100))
    const size = octal(header.subarray(124, 136))
    const type = header[156]
    const body = tar.subarray(offset + 512, offset + 512 + size)
    if (name && type !== 53) files.push({ name, data: body.slice() })
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return files
}

const download = async (onProgress: (value: number) => void) => {
  const encode = (value: string) => btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  const headers = encode(JSON.stringify({ 'User-Agent': ['SiYuan-SiReader'] }))
  const proxyUrl = `/api/network/proxy?u=${encodeURIComponent(encode(PACK_URL))}&h=${encodeURIComponent(headers)}&t=300s`
  let response: Response | null = null
  let errorDetail = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(proxyUrl, { cache: 'no-store' })
    if (response.ok && response.body) break
    errorDetail = (await response.text().catch(() => '')).trim().slice(0, 240)
    if (![502, 503, 504].includes(response.status) || attempt === 2) {
      throw new Error(`TTS pack download failed (HTTP ${response.status}${errorDetail ? `: ${errorDetail}` : ''})`)
    }
    await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)))
  }
  if (!response?.ok || !response.body) throw new Error(`TTS pack download failed${errorDetail ? `: ${errorDetail}` : ''}`)
  const total = Number(response.headers.get('Siyuan-Proxy-Content-Length')) || OFFLINE_TTS_PACK.size
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let loaded = 0
  while (true) {
    const part = await reader.read()
    if (part.done) break
    chunks.push(part.value); loaded += part.value.length; onProgress(Math.min(99, loaded / total * 100))
  }
  const result = new Uint8Array(loaded); let offset = 0
  for (const chunk of chunks) result.set(chunk, offset), offset += chunk.length
  onProgress(100)
  return result
}

export class OfflineTTSManager {
  async installed() {
    try {
      const result = await (await import('@/api')).readDir(`${ROOT}/${PACK_ID}`) as any
      return Array.isArray(result)
        && result.some((entry: any) => /\.onnx$/i.test(entry?.name || ''))
        && result.some((entry: any) => /\.json$/i.test(entry?.name || ''))
    } catch { return false }
  }

  async download(onProgress: (value: number) => void = () => {}) {
    const archive = await download(onProgress)
    const bz = await new BZip2().init()
    let length = archive.length * 8
    let tar: Uint8Array
    while (true) {
      try { tar = bz.decompress(archive, length); break } catch (error) { if (length > archive.length * 128) throw error; length *= 2 }
    }
    const { writeManagedFile } = await import('@/core/storage')
    const files = tarEntries(tar!)
    for (const file of files) {
      const name = file.name.replace(/^\.?\/?[^/]+\//, '')
      if (!name || name.includes('..')) continue
      await writeManagedFile(new Blob([file.data]), `${ROOT}/${PACK_ID}/${name}`, name)
    }
    onProgress(100)
    return files.length
  }
}

type TTSModule = { FS: { writeFile: (path: string, data: Uint8Array) => void }; [key: string]: any }
type OfflineTTS = { generate: (config: { text: string; sid?: number; speed?: number }) => { samples: Float32Array; sampleRate: number }; free: () => void }
const MODEL_ROOT = '/public/siyuan-sireader/tts/zh-CN-xiao-ya'
const MODEL_FILES = { model: 'zh_CN-xiao_ya-medium.onnx', lexicon: 'lexicon.txt', tokens: 'tokens.txt', date: 'date.fst', number: 'number.fst', phone: 'phone.fst' }
let inference: Promise<OfflineTTS> | null = null

const loadModelFile = async (name: string) => {
  const response = await fetch(`${MODEL_ROOT}/${name}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`离线语音文件读取失败（HTTP ${response.status}）：${name}`)
  return new Uint8Array(await response.arrayBuffer())
}

const createInference = async () => {
  const wasmUrl = `/plugins/${pluginInfo.name}/sherpa-onnx/sherpa-onnx.wasm`
  const wasmResponse = await fetch(wasmUrl, { cache: 'force-cache' })
  if (!wasmResponse.ok) throw new Error(`离线语音引擎加载失败（HTTP ${wasmResponse.status}）`)
  const wasm = await wasmResponse.arrayBuffer()
  if (!wasm.byteLength) throw new Error('离线语音引擎文件为空，请重新安装插件')
  const loaded = await Promise.all(Object.values(MODEL_FILES).map(async name => [name, await loadModelFile(name)] as const))
  const module = await createWasmModule({ wasmBinary: wasm, locateFile: () => wasmUrl, instantiateWasm(imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance, compiled: WebAssembly.Module) => void) { WebAssembly.instantiate(wasm, imports).then(({ instance, module }) => receive(instance, module)); return {} } }) as TTSModule
  for (const [name, data] of loaded) module.FS.writeFile(`/${name}`, data)
  return createOfflineTts(module, { offlineTtsModelConfig: { offlineTtsVitsModelConfig: { model: `/${MODEL_FILES.model}`, lexicon: `/${MODEL_FILES.lexicon}`, tokens: `/${MODEL_FILES.tokens}`, dataDir: '' }, numThreads: 1, debug: false, provider: 'cpu' }, ruleFsts: `/${MODEL_FILES.phone},/${MODEL_FILES.date},/${MODEL_FILES.number}`, maxNumSentences: 1 }) as OfflineTTS
}

export const synthesizeOfflineTTS = async (text: string, speed = 1) => {
  inference ||= createInference().catch(error => { inference = null; throw error })
  return (await inference).generate({ text, speed })
}
