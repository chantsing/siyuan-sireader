import { showMessage } from 'siyuan'
import * as api from '@/api'
import { createMediaNote, getMediaNoteKey, humanizeText, humanizeUrl, insertByTarget, type ClipboardPayload } from '@/core/document'
import { getStorage, getPlayerSettings } from '@/composables/storage'
import { BaseDriver } from '@/drivers/base/BaseDriver'
import { SubtitleManager } from '@/core/subtitle'
import { LicenseManager } from '@/core/license'
import { forwardProxyBlob } from '@/utils/webdav-proxy'

export type MediaItem = Record<string, any>
export type RuntimeAPI = {
  openMediaListTab?: (folderPath: string, folderName: string, cloudItem?: any) => void
  openDocumentTab?: (id: string) => void
  openPlayerTab?: (mediaItem?: Record<string, any> | null) => Promise<void> | void
  playMediaItem?: (mediaItem: Record<string, any>) => Promise<void> | void
  playPrev?: () => Promise<void> | void
  playNext?: () => Promise<void> | void
  toBackground?: () => Promise<void> | void
  toBackgroundFromMedia?: (mediaItem: Record<string, any>) => Promise<void> | void
  closeActivePlayerTab?: () => Promise<void> | void
  playLink?: (url: string) => Promise<boolean> | boolean
  controller?: any
  player?: any
  config?: Record<string, any>
  settings?: Record<string, any>
  pendingMedia?: Record<string, any> | null
  toggle?: () => void
  seek?: (offset: number) => void
  triggerAction?: (action: string) => void
  increaseSpeed?: () => void
  decreaseSpeed?: () => void
  toggleCustomSpeed?: () => void
  getConfig?: () => Promise<any>
  createTimestampLink?: (time?: number) => Promise<string>
  runAiSummary?: (item?: Record<string, any>) => Promise<void> | void
}

type MediaAction = 'screenshot' | 'timestamp' | 'mediaNotes' | 'loopSegment' | 'prev' | 'next' | 'background' | 'aiSummary'
type ParsedLink = {
  rawUrl: string
  cleanUrl: string
  source: string
  sourcePath?: string
  cloudAccountId?: string
  type: 'audio' | 'video'
  startTime?: number
  endTime?: number
  bvid?: string
  page?: number
}

// ===== 默认值与常量 =====
const DEFAULT_LINK_FORMAT = '[{{标题}} {{时间}}]({{链接}})'
const DEFAULT_NOTES_TEMPLATE = '# {{标题}}\n时长：{{时长}}\n作者：{{作者}}\n简介：{{简介}}\n链接：[{{链接}}]({{链接}})\n![封面]({{封面}})'
const TIME_REGEX = /[?&]t=([^&]+)/
const FILE_ID_SOURCES = new Set(['alidrive', 'pan123', 'pan115', 'quarktv', 'onedrive'])
const PLAY_QUEUE_KEY = 'siyuan-media-player:queue'
const AUTHOR_KEYS = ['artist', 'ownerName', 'author', 'uname', 'upName'] as const
const DESC_KEYS = ['desc', 'description', 'intro', 'dynamic', 'content', 'remarks', 'summary'] as const
const decodeUrlValue = (value = '') => { try { return decodeURIComponent(value) } catch { return value } }
const toPage = (value: any) => Math.max(1, Number(value || '1') || 1)
const resolveBilibiliLink = (value = '', pageHint?: any) => {
  const input = decodeUrlValue(String(value || '').trim())
  if (!input) return null
  const page = toPage(pageHint || input.match(/[?&]p=(\d+)/)?.[1] || input.match(/(?:^|\|)page:(\d+)/)?.[1])
  const suffix = page > 1 ? `?p=${page}` : ''
  const normalized = input
    .replace(/^bilibili:\/\/\/?/, '/')
    .replace(/^bilibili:\/\//, '/')
  const bvid = normalized.match(/(?:^|\/)(BV[\w]+)/i)?.[1] || normalized.match(/(?:^|\|)bvid:([^|/?&#]+)/i)?.[1]
  if (bvid) return { sourcePath: `/video/${bvid}`, publicUrl: `https://www.bilibili.com/video/${bvid}${suffix}`, page, bvid }
  const bangumiId = normalized.match(/(?:bangumi\/play\/ss|\/bangumi\/)(\d+)/i)?.[1]
  if (bangumiId) return { sourcePath: `/bangumi/${bangumiId}`, publicUrl: `https://www.bilibili.com/bangumi/play/ss${bangumiId}${suffix}`, page }
  const roomId = normalized.match(/(?:live\.bilibili\.com\/|\/live\/)(\d+)/i)?.[1]
  if (roomId) return { sourcePath: `/live/${roomId}`, publicUrl: `https://live.bilibili.com/${roomId}`, page: 1 }
  return null
}

// ===== 运行时状态 =====
let initialized = false
let loopStartTime: number | null = null
export const normalizeRange = (startTime?: number, endTime?: number) => {
  const start = typeof startTime === 'number' ? Math.max(0, Number(startTime) || 0) : undefined
  const end = typeof endTime === 'number' ? Math.max(0, Number(endTime) || 0) : undefined
  return { startTime: start, endTime: start !== undefined && end !== undefined && end < start ? start : end }
}

/** 统一获取播放器运行时对象。 */
export const getAPI = (): RuntimeAPI => ((window as any).siyuanMediaPlayer ||= {})
export const playQueuedItems = async (item: MediaItem, siblings?: MediaItem[]) => {
  const items = (siblings?.length ? siblings : [item]).filter((entry: any) => entry && (item?.type === 'image' ? entry.type === 'image' : entry.type !== 'folder'))
  try { localStorage.setItem(PLAY_QUEUE_KEY, JSON.stringify({ items, currentId: item?.id })) } catch {}
  if (item?.type === 'image') {
    const { previewImages } = await import('@/core/imageViewer')
    previewImages(items.length ? items : [item], item)
    return
  }
  await getAPI().playMediaItem?.(item)
}
/** 秒数格式化为时间文本。 */
export const fmt = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}
/** 解析 01:23 或 01:02:03 这类时间文本。 */
export const parseTime = (timeText = ''): number => {
  const value = String(timeText || '').trim()
  if (!value) return 0
  const parts = value.split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return Number(value) || 0
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] || 0
}
/** 统一生成媒体链接。 */
export const getMediaUrl = (item: MediaItem): string => {
  const source = normalizeSource(String(item?.source || ''))
  const sourcePath = String(item?.sourcePath || '')
  const local = String(item?.localPath || item?.originalUrl || item?.url || '')
  const appendSourcePath = (url: string): string => {
    if (!url || !sourcePath.includes('|') || /[?&]path=/.test(url)) return url
    return `${url}${url.includes('?') ? '&' : '?'}path=${encodeURIComponent(sourcePath)}`
  }
  const bilibili = (source === 'bilibili' || item?.bvid)
    ? resolveBilibiliLink(item?.bvid ? `/video/${item.bvid}` : (item?.sourcePath || item?.path || item?.originalUrl || item?.url || ''), item?.page || item?.originalUrl?.match(/[?&]p=(\d+)/)?.[1] || item?.url?.match(/[?&]p=(\d+)/)?.[1])
    : null
  if (bilibili?.publicUrl) return bilibili.publicUrl
  if (BaseDriver.isLocalNativePath(local)) return BaseDriver.toFileUrl(local)
  if ((item?.source === 'tvbox' || item?.site) && item?.originalUrl?.startsWith('tvbox://')) return item.originalUrl
  const url = source === 'quarktv' ? (item?.originalUrl || item?.url || '') : appendSourcePath(item?.originalUrl || item?.url || '')
  const accountId = String(item?.cloudAccountId || '')
  const accountRef = accountId.split('_').pop() || accountId
  const finalUrl = !url || !accountRef || /[?&](?:a|accountId|cloudAccountId)=/.test(url)
    ? url
    : `${url}${url.includes('?') ? '&' : '?'}a=${encodeURIComponent(accountRef)}`
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(finalUrl) && !/^https?:\/\//i.test(finalUrl) ? finalUrl : humanizeUrl(finalUrl)
}

// ===== 广播 =====
const getBroadcastUrl = (channel: string) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/broadcast?channel=${encodeURIComponent(channel)}`
/** 统一创建广播通道，主窗口和新窗口共用。 */
const createBroadcast = (channel: string) => {
  let socket: WebSocket | null = null
  const listeners = new Set<(payload: Record<string, any>) => void>()

  const connect = () => {
    if (socket && socket.readyState < WebSocket.CLOSING) return socket
    socket = new WebSocket(getBroadcastUrl(channel))
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data || '{}'))
        listeners.forEach((listener) => listener(payload))
      } catch {}
    }
    socket.onclose = () => { socket = null }
    return socket
  }

  return {
    post: (payload: Record<string, any>) => api.request('/api/broadcast/postMessage', { channel, message: JSON.stringify(payload) }),
    on: (callback: (payload: Record<string, any>) => void) => {
      listeners.add(callback)
      connect()
      return () => {
        listeners.delete(callback)
        if (!listeners.size && socket) {
          socket.close()
          socket = null
        }
      }
    },
  }
}
const playerBroadcast = createBroadcast('siyuan-media-player')
const mediaListBroadcast = createBroadcast('siyuan-media-list')
export const postPlayerBroadcast = playerBroadcast.post
export const onPlayerBroadcast = playerBroadcast.on
export const postMediaListBroadcast = mediaListBroadcast.post
export const onMediaListBroadcast = mediaListBroadcast.on

// ===== 内部工具 =====
const normalizeMediaUrl = (url = '') => url
  .replace(TIME_REGEX, '')
  .replace(/[?&](?:a|accountId|cloudAccountId)=[^&]*/g, '')
  .replace(/[?&]$/, '')
  .replace(/\?&/, '?')
const normalizeSource = (source = '') => BaseDriver.normalizeSource(source)
const getRuntime = () => getAPI()
const getSettings = async () => ({ ...(await getPlayerSettings()), ...(getRuntime().config || {}) })
/** 统一提示出口。 */
const notify = (text: string, type: 'info' | 'error' = 'info') => {
  const player = getRuntime().player
  if (player?.notice) player.notice.show = text
  showMessage(text, type === 'error' ? 3000 : 2000, type)
}
/** 优先取事件里的时间，其次取当前播放器时间。 */
const getRuntimeTime = (detail?: Record<string, any>): number => {
  if (typeof detail?.currentTime === 'number') return detail.currentTime
  const runtime = getRuntime()
  if (typeof runtime.controller?.getCurrentTime === 'function') return Number(runtime.controller.getCurrentTime()) || 0
  return Number(runtime.player?.currentTime) || 0
}
/** 从已加载字幕中取当前时刻字幕文本。 */
const getCurrentSubtitle = (settings: Record<string, any>, time: number): string => {
  const subtitleUrl = settings.currentSubtitleUrl
  if (!subtitleUrl) return ''
  const subtitles = SubtitleManager.get(subtitleUrl)
  let text = ''
  for (const subtitle of subtitles) {
    if (subtitle.time > time) break
    text = subtitle.text || ''
  }
  return text
}
export const withTime = (url: string, start: number, end?: number) => !url ? '' : `${url}${url.includes('?') ? '&' : '?'}t=${end !== undefined ? `${fmt(start)}-${fmt(end)}` : fmt(start)}`
const applyTemplate = (template: string, replacements: Record<string, string>) => Object.entries(replacements).reduce((output, [token, value]) => output.replaceAll(token, value), template)
const formatDuration = (value: any) => typeof value === 'number' ? fmt(value) : /^\d+(\.\d+)?$/.test(String(value || '')) ? fmt(Number(value)) : String(value || '')
const getMediaMeta = (item: MediaItem) => ({ title: humanizeText(String(item?.title || item?.name || '未命名媒体')), author: pickMeta(item, AUTHOR_KEYS), desc: pickMeta(item, DESC_KEYS), duration: formatDuration(item?.duration ?? item?.durationSec) })
const pickMeta = (item: any, keys: readonly string[]) => keys.map(key => item?.[key]).find(Boolean) || ''
const normalizeImageUrl = (url = ''): string => !url ? '' : url.startsWith('//') ? `https:${url}` : url.startsWith('/') ? `${location.origin}${url}` : url
const isExternalHttpUrl = (url = '') => {
  try {
    const target = new URL(normalizeImageUrl(url))
    return /^https?:$/i.test(target.protocol) && target.origin !== location.origin
  } catch {
    return false
  }
}
/** 拉取图片资源，供封面和截图写入笔记时复用。 */
const getImageBlob = async (imageUrl = ''): Promise<Blob | null> => {
  const source = String(imageUrl || '').trim()
  if (!source) return null
  try {
    const target = normalizeImageUrl(source)
    if (isExternalHttpUrl(target)) return await forwardProxyBlob(target)
    const response = await fetch(target)
    if (!response.ok) throw new Error('图片读取失败')
    return await response.blob()
  } catch {
    return null
  }
}
/** 把图片转为思源资源路径。 */
export const imageToAsset = async (image: string | Blob = '', prefix = 'image'): Promise<string> => {
  if (typeof image === 'string') {
    const source = String(image || '').trim()
    if (!source || source.startsWith('/assets/') || source.startsWith('/plugins/')) return source
    image = await getImageBlob(source) || ''
  }
  if (!(image instanceof Blob)) return ''
  try {
    const type = image.type || 'image/png'
    const ext = type.split('/')[1]?.split(';')[0]?.trim().toLowerCase()
    const file = new File([image], `${prefix}_${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext || 'png'}`, { type })
    return (await api.upload('/assets/', [file]))?.succMap?.[file.name] || ''
  } catch {
    return ''
  }
}
const stripImageToken = (template: string, token = '截图'): string => template.replace(new RegExp(`!?\\[.*?\\]\\(${token}\\)`, 'g'), '').replace(/\n{3,}/g, '\n\n').trim()
/** 统一生成带时间点的媒体链接文本。 */
const buildMediaLink = (item: MediaItem, settings: Record<string, any>, time: number, endTime?: number, subtitle?: string): string => {
  const url = withTime(getMediaUrl(item), time, endTime)
  const timeText = endTime !== undefined ? `${fmt(time)}-${fmt(endTime)}` : fmt(time)
  const output = applyTemplate(stripImageToken(settings.linkFormat || DEFAULT_LINK_FORMAT), {
    '{{时间}}': timeText,
    '{{字幕}}': subtitle || '',
    '{{标题}}': humanizeText(String(item?.title || item?.name || '')),
    '{{艺术家}}': item?.artist || '',
    '{{链接}}': url,
  }).trim()
  return output || `- [${timeText}](${url})`
}
const buildTimestampPayload = (item: MediaItem, settings: Record<string, any>, time: number): ClipboardPayload => ({ text: buildMediaLink(item, settings, time, undefined, getCurrentSubtitle(settings, time)) })
const buildLoopPayload = (item: MediaItem, settings: Record<string, any>, start: number, end: number): ClipboardPayload => ({ text: buildMediaLink(item, settings, start, end, getCurrentSubtitle(settings, start)) })
/** 生成媒体笔记内容。 */
const buildMediaNotesPayload = async (item: MediaItem, settings: Record<string, any>, time: number): Promise<ClipboardPayload> => {
  const thumbnail = normalizeImageUrl(item?.thumbnail || '')
  const image = await getImageBlob(thumbnail) || await getRuntime().controller?.getScreenshotBlob?.(settings.screenshotFormat || 'png', Number(settings.screenshotQuality || 92) / 100)
  const meta = getMediaMeta(item)
  return {
    text: applyTemplate(settings.mediaNotesTemplate || DEFAULT_NOTES_TEMPLATE, {
      '{{标题}}': meta.title,
      '{{作者}}': meta.author,
      '{{艺术家}}': meta.author,
      '{{简介}}': meta.desc,
      '{{链接}}': getMediaUrl(item),
      '{{时长}}': meta.duration,
      '{{封面}}': image ? await imageToAsset(image, 'thumbnail') : '',
      '{{日期}}': new Date().toLocaleDateString(),
    }),
  }
}
/** 生成截图写入内容。 */
const buildScreenshotPayload = async (item: MediaItem, settings: Record<string, any>, time: number, image: Blob): Promise<ClipboardPayload> => {
  const text = settings.screenshotWithTimestamp ? buildMediaLink(item, settings, time, undefined, getCurrentSubtitle(settings, time)) : ''
  if (!text) return { text: '', image } // 纯截图：直接复制图片 Blob，方便粘贴到其他软件
  const imageUrl = await imageToAsset(image, 'screenshot')
  if (!imageUrl) throw new Error('截图上传失败')
  return { text: `${text}\n\n![截图](${imageUrl})` }
}

/** 统一读取当前播放媒体。 */
const getCurrentItem = () => {
  const item = getRuntime().controller?.getCurrentMedia?.()
  if (!item) throw new Error('请先播放媒体')
  return item
}

const getParsedIdentity = (source = '', sourcePath = '', url = '') => {
  const cleanUrl = normalizeMediaUrl(url)
  const parsed = BaseDriver.parseItemUrl(cleanUrl, normalizeSource(source))
  const resolvedSource = normalizeSource(source || parsed?.source || 'standard')
  const resolvedPath = sourcePath || parsed?.sourcePath || ''
  const comparablePath = FILE_ID_SOURCES.has(resolvedSource) ? (resolvedPath.split('|').pop() || resolvedPath) : resolvedPath
  return `${resolvedSource}:${comparablePath || cleanUrl}`
}
const getLinkElement = (target: HTMLElement | null) => target?.matches('a[href], [data-href], span[data-type="a"], span[data-type="url"]') ? target : target?.closest('a[href], [data-href], span[data-type="a"], span[data-type="url"]') || null
/** 从点击目标上提取链接和标题。 */
const getLinkMeta = (target: HTMLElement | null) => {
  const element = getLinkElement(target)
  return {
    url: String(element?.getAttribute('data-media-url') || element?.getAttribute('data-href') || element?.getAttribute('href') || '').trim(),
    title: String(element?.textContent || '').trim(),
  }
}
/** 把文档中的媒体链接统一解析成播放器可识别结构。 */
const parseLink = (url: string): ParsedLink | null => {
  const rawUrl = String(url || '').trim()
  if (!rawUrl) return null
  const [startText = '', endText = ''] = decodeUrlValue(rawUrl.match(TIME_REGEX)?.[1] || '').split('-')
  const { startTime, endTime } = normalizeRange(startText ? parseTime(startText) : undefined, endText ? parseTime(endText) : undefined)
  const accountId = rawUrl.match(/[?&](?:a|accountId|cloudAccountId)=([^&]+)/)?.[1]
  const cleanUrl = normalizeMediaUrl(rawUrl)
  const bilibili = resolveBilibiliLink(cleanUrl)
  if (bilibili) return { rawUrl, cleanUrl, cloudAccountId: accountId, source: 'bilibili', sourcePath: bilibili.sourcePath, type: 'video', startTime, endTime, bvid: bilibili.bvid, page: bilibili.page }
  const parsed = BaseDriver.parseItemUrl(cleanUrl)
  return parsed ? { rawUrl, cleanUrl, cloudAccountId: accountId, ...parsed, startTime, endTime } : null
}

const getLinkTitle = (parsed: ParsedLink, title = '') => {
  const linkText = String(title || '').trim()
  // 带时间参数的链接，其锚文本通常是“时间戳模板”而不是媒体原始标题。
  if (linkText && parsed.startTime === undefined && parsed.endTime === undefined) return linkText
  if (parsed.source === 'bilibili' && parsed.bvid) return parsed.bvid
  const sourceName = parsed.sourcePath?.split('/').filter(Boolean).pop()?.split('|')[0] || ''
  if (sourceName) return sourceName.replace(/\.[^.]+$/, '')
  const name = parsed.cleanUrl.split('/').pop()?.split('?')[0] || ''
  try { return decodeURIComponent(name).replace(/\.[^.]+$/, '') || parsed.cleanUrl } catch { return name.replace(/\.[^.]+$/, '') || parsed.cleanUrl }
}
// ===== 链接匹配与播放 =====/** 判断文档链接和当前媒体是否指向同一资源。 */
const isSameMedia = (item: MediaItem | null | undefined, parsed: ParsedLink) => {
  if (!item) return false
  if (parsed.source === 'bilibili' && parsed.bvid) {
    return item.bvid === parsed.bvid && toPage(item?.page || item?.originalUrl?.match(/[?&]p=(\d+)/)?.[1] || item?.url?.match(/[?&]p=(\d+)/)?.[1]) === (parsed.page || 1)
  }
  return getParsedIdentity(String(item.source || ''), String(item.sourcePath || ''), getMediaUrl(item) || item.url || '') === getParsedIdentity(parsed.source, parsed.sourcePath || '', parsed.cleanUrl)
}
/** 把解析后的链接转成可播放媒体对象。 */
const resolveLinkItem = async (parsed: ParsedLink, title = '') => {
  const storage = await getStorage()
  const cloudAccountId = parsed.cloudAccountId
    ? (await storage.queryCloudAccounts('id = ? OR id LIKE ?', [parsed.cloudAccountId, `%_${parsed.cloudAccountId}`]).catch(() => []))[0]?.id || parsed.cloudAccountId
    : undefined
  if (parsed.source === 'bilibili' && parsed.sourcePath) {
    const { bilibiliDriver } = await import('@/drivers/bilibili')
    const account = await BaseDriver.getAccountBySource(storage, 'bilibili')
    if (account) bilibiliDriver.setConfig(account)
    return bilibiliDriver.createMediaItemFromLink(parsed.sourcePath, parsed.page || 1, { startTime: parsed.startTime, endTime: parsed.endTime })
  }
  const existing = cloudAccountId
    ? (await storage.findMediaByUrls([parsed.cleanUrl, parsed.rawUrl], cloudAccountId))[0]
    : (await storage.findMediaByUrls([parsed.cleanUrl, parsed.rawUrl]))[0]
  if (existing) return existing
  return BaseDriver.attachCloudAccount({
    id: `link-${Date.now()}`,
    url: parsed.cleanUrl,
    originalUrl: parsed.cleanUrl,
    source: parsed.source === 'standard' ? undefined : parsed.source,
    sourcePath: parsed.source === 'standard' ? undefined : parsed.sourcePath,
    cloudAccountId,
    type: parsed.type,
    title: getLinkTitle(parsed, title),
    name: getLinkTitle(parsed, title),
  }, storage)
}
/** 播放解析后的链接；同媒体时优先直接跳转。 */
const playParsedLink = async (parsed: ParsedLink, title = '') => {
  const runtime = getRuntime()
  const current = runtime.controller?.getCurrentMedia?.()
  if (parsed.startTime !== undefined && isSameMedia(current, parsed)) {
    if (parsed.endTime !== undefined) runtime.controller?.setLoopSegment?.(parsed.startTime, parsed.endTime)
    else runtime.controller?.seekTo?.(parsed.startTime)
    runtime.player?.play?.()
    if (runtime.player?.notice) runtime.player.notice.show = `跳转到 ${fmt(parsed.startTime)}${parsed.endTime !== undefined ? `-${fmt(parsed.endTime)}` : ''}`
    return true
  }
  await runtime.playMediaItem?.({ ...(await resolveLinkItem(parsed, title)), startTime: parsed.startTime, endTime: parsed.endTime })
  return true
}
const playLink = async (url: string) => {
  const parsed = parseLink(url)
  return parsed ? playParsedLink(parsed) : false
}

// ===== 动作处理 =====
const getActionTime = (settings: Record<string, any>, detail?: Record<string, any>) => Math.max(0, getRuntimeTime(detail) + Number(settings.timestampOffset || 0))
const getNoteArgs = (item: MediaItem) => [humanizeText(String(item?.title || item?.name || '媒体')), getMediaNoteKey(item)] as const
const insertCurrent = async (settings: Record<string, any>, payload: ClipboardPayload | Promise<ClipboardPayload>) => {
  const item = getCurrentItem()
  await insertByTarget(await payload, settings, ...getNoteArgs(item))
}
/** 插入时间戳链接。 */
const handleTimestamp = async (detail?: Record<string, any>) => {
  const settings = await getSettings()
  const item = getCurrentItem()
  await insertByTarget(buildTimestampPayload(item, settings, getActionTime(settings, detail)), settings, ...getNoteArgs(item))
}
/** 两次触发组成一个循环片段。 */
const handleLoopSegment = async (detail?: Record<string, any>) => {
  const settings = await getSettings()
  const time = getActionTime(settings, detail)
  if (loopStartTime === null) {
    loopStartTime = time
    return void notify(`已记录开始时间 ${fmt(time)}`)
  }
  const { startTime: start, endTime } = normalizeRange(loopStartTime, time)
  loopStartTime = null
  const item = getCurrentItem()
  if (start === undefined || endTime === undefined) return
  await insertByTarget(buildLoopPayload(item, settings, start, endTime), settings, ...getNoteArgs(item))
  endTime === start && notify(`结束时间已自动重置为开始时间 ${fmt(start)}`)
}
/** 创建媒体笔记。 */
const handleMediaNotes = async (detail?: Record<string, any>) => {
  const item = getCurrentItem()
  const settings = await getSettings()
  await createMediaNote(item, settings, await buildMediaNotesPayload(item, settings, getRuntimeTime(detail)))
}
/** 截图并按设置写入。 */
const handleScreenshot = async () => {
  if (!LicenseManager.can('screenshot')) return void LicenseManager.notifyPro()
  const runtime = getRuntime()
  const settings = await getSettings()
  const image = await runtime.controller?.getScreenshotBlob?.(settings.screenshotFormat || 'png', Number(settings.screenshotQuality || 92) / 100)
  if (!image) return void notify('截图失败', 'error')
  await insertCurrent(settings, buildScreenshotPayload(getCurrentItem(), settings, getRuntimeTime(), image))
}
/** 统一分发播放器动作。 */
const handleAction = async (action: MediaAction, detail?: Record<string, any>) => {
  const runtime = getRuntime()
  if (action === 'prev') return runtime.playPrev?.()
  if (action === 'next') return runtime.playNext?.()
  if (action === 'background') return runtime.toBackground?.()
  if (action === 'aiSummary') return runtime.runAiSummary?.()
  if (action === 'timestamp') return handleTimestamp(detail)
  if (action === 'loopSegment') return handleLoopSegment(detail)
  if (action === 'mediaNotes') return handleMediaNotes(detail)
  if (action === 'screenshot') return handleScreenshot()
}
/** 响应全局播放器动作事件。 */
const onMediaPlayerAction = (event: Event) => {
  const detail = (event as CustomEvent<Record<string, any>>).detail || {}
  const action = detail.action as MediaAction | undefined
  if (!action) return
  handleAction(action, detail).catch((error) => {
    console.error('[Player]', error)
    notify(error instanceof Error ? error.message : '操作失败', 'error')
  })
}
/** 拦截文档中的媒体链接点击并直接播放。 */
const getMediaName = (url: string, type: 'video' | 'audio') => url.replace(/^file:\/\/\/?/, '').split(/[\\/]/).pop() || (type === 'video' ? '未命名视频' : '未命名音频')
const getMediaBlockItem = (target: HTMLElement | null) => {
  const block = target?.closest?.('div[data-type="NodeVideo"], div[data-type="NodeAudio"]') as HTMLElement | null
  const mediaEl = !block || target?.closest?.('.protyle-action__drag') ? null : block.querySelector('video, audio') as HTMLMediaElement | null
  const url = String(mediaEl?.currentSrc || mediaEl?.getAttribute('src') || mediaEl?.querySelector('source')?.getAttribute('src') || '').trim()
  if (!mediaEl || !url) return null
  const type = mediaEl.tagName.toLowerCase() as 'video' | 'audio', name = getMediaName(url, type)
  return { url, originalUrl: url, title: name, name, type }
}
const stopEvent = (event: MouseEvent) => (event.preventDefault(), event.stopPropagation())
const onDocumentClick = (event: Event) => {
  const mouseEvent = event as MouseEvent
  if (mouseEvent.defaultPrevented || mouseEvent.button !== 0 || mouseEvent.ctrlKey || mouseEvent.metaKey || mouseEvent.shiftKey || mouseEvent.altKey) return
  const target = mouseEvent.target as HTMLElement | null, mediaItem = getMediaBlockItem(target), runtime = getRuntime()
  if (mediaItem) return stopEvent(mouseEvent), void runtime.playMediaItem?.(mediaItem)
  const { url, title } = getLinkMeta(target), parsed = parseLink(url)
  if (!parsed) return
  stopEvent(mouseEvent)
  playParsedLink(parsed, title).catch((error) => {
    console.error('[PlayerLink]', error)
    notify(error instanceof Error ? error.message : '链接播放失败', 'error')
  })
}
const createTimestampLink = async (time?: number) => {
  const item = getRuntime().controller?.getCurrentMedia?.()
  if (!item) return ''
  const settings = await getSettings()
  const actualTime = Math.max(0, (time ?? getRuntimeTime()) + Number(settings.timestampOffset || 0))
  return buildMediaLink(item, settings, actualTime, undefined, getCurrentSubtitle(settings, actualTime))
}

// ===== 初始化 =====/** 只初始化一次播放器运行时能力。 */
export const initMediaPlayer = () => {
  if (initialized) return
  initialized = true
  window.addEventListener('mediaPlayerAction', onMediaPlayerAction)
  document.addEventListener('click', onDocumentClick, true)
  const runtime = getRuntime()
  runtime.triggerAction = (action: MediaAction) => window.dispatchEvent(new CustomEvent('mediaPlayerAction', { detail: { action } }))
  runtime.createTimestampLink = createTimestampLink
  runtime.playLink = playLink
}
