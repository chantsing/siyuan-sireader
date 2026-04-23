import { ref } from 'vue'
import type { Plugin } from 'siyuan'
import { bookshelfManager } from '@/core/bookshelf'

const emptyStats = () => ({ readingTime: 0, sessionStart: 0, currentBook: '', lastSaved: 0, focused: false })
const getEventBookUrl = (e: CustomEvent) => e.detail?.bookUrl || e.detail?.book?.url || ''

export function useStats(plugin: Plugin) {
  const stats = ref(emptyStats())

  const fmt = (seconds: number) => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m ${seconds % 60}s`
  }

  const fmtShort = (seconds: number) => {
    const hours = Math.floor(seconds / 3600)
    if (hours >= 24) return `${Math.floor(hours / 24)}d`
    if (hours > 0) return `${hours}h`
    return `${Math.floor(seconds / 60)}m`
  }

  const persist = async (duration: number) => {
    stats.value.readingTime += duration
    await Promise.all([
      bookshelfManager.saveSetting('reader_stats', { readingTime: stats.value.readingTime }),
      stats.value.currentBook ? bookshelfManager.recordReading(stats.value.currentBook, duration) : Promise.resolve(),
    ])
  }

  const saveIncrement = async () => {
    if (!stats.value.focused || !stats.value.lastSaved) return
    const now = Date.now()
    const duration = Math.floor((now - stats.value.lastSaved) / 1000)
    if (duration < 1) return
    await persist(duration)
    stats.value.lastSaved = now
  }

  const resetSession = (bookUrl = stats.value.currentBook) => Object.assign(stats.value, { currentBook: bookUrl, sessionStart: 0, lastSaved: 0, focused: false })

  const setFocused = (focused: boolean, bookUrl = stats.value.currentBook) => {
    if (bookUrl && stats.value.currentBook !== bookUrl) resetSession(bookUrl)
    if (!stats.value.currentBook || stats.value.focused === focused) return
    if (!focused) return void resetSession()
    const now = Date.now()
    Object.assign(stats.value, { sessionStart: now, lastSaved: now, focused })
  }

  const stopReading = async () => {
    await saveIncrement()
    resetSession('')
  }

  const load = async () => {
    const data = await bookshelfManager.getSetting('reader_stats', { readingTime: 0 })
    Object.assign(stats.value, emptyStats(), { readingTime: Number(data?.readingTime || 0) })
  }

  const init = () => {
    void load()

    const bar = document.createElement('div')
    bar.className = 'toolbar__item b3-tooltips b3-tooltips__n'
    bar.id = 'stats-btn'
    bar.innerHTML = '<svg class="toolbar__icon"><use xlink:href="#iconClock"></use></svg>'
    bar.setAttribute('aria-label', 'Reading stats')
    bar.style.cursor = 'pointer'
    bar.addEventListener('click', () => window.dispatchEvent(new CustomEvent('stats:toggle')))
    plugin.addStatusBar({ element: bar, position: 'right' })

    const timer = window.setInterval(() => void saveIncrement(), 60000)
    const beforeUnload = () => { void stopReading() }
    const onReaderOpen = ((e: CustomEvent) => resetSession(getEventBookUrl(e))) as EventListener
    const onReaderFocus = ((e: CustomEvent) => setFocused(true, getEventBookUrl(e))) as EventListener
    const onReaderBlur = (() => { void saveIncrement().finally(() => resetSession()) }) as EventListener
    const onReaderClose = (() => { void stopReading() }) as EventListener

    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('reader:open', onReaderOpen)
    window.addEventListener('reader:focus', onReaderFocus)
    window.addEventListener('reader:blur', onReaderBlur)
    window.addEventListener('reader:close', onReaderClose)

    return () => {
      clearInterval(timer)
      window.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('reader:open', onReaderOpen)
      window.removeEventListener('reader:focus', onReaderFocus)
      window.removeEventListener('reader:blur', onReaderBlur)
      window.removeEventListener('reader:close', onReaderClose)
      void stopReading()
    }
  }

  return { stats, fmt, fmtShort, init }
}
