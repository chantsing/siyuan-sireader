import { ref } from 'vue'
import { showMessage } from 'siyuan'
import type { Plugin } from 'siyuan'

export function useStats(plugin: Plugin) {
  const stats = ref({ readingTime: 0, sessionStart: 0, currentBook: '', lastSaved: 0 })

  const fmt = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
    return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`
  }

  const fmtShort = (s: number) => {
    const h = Math.floor(s / 3600)
    return h >= 24 ? `${Math.floor(h / 24)}天` : h > 0 ? `${h}时` : `${Math.floor(s / 60)}分`
  }

  const load = async () => {
    const db = await (await import('@/core/database')).getDatabase()
    const data = await db.getSetting('reader_stats')
    if (data) stats.value.readingTime = data.readingTime || 0
    stats.value.sessionStart = 0
  }

  const save = async (duration: number) => {
    const db = await (await import('@/core/database')).getDatabase()
    stats.value.readingTime += duration
    
    const tasks = [db.saveSetting('reader_stats', { readingTime: stats.value.readingTime })]
    
    if (stats.value.currentBook) {
      tasks.push(
        db.saveDailyReading(stats.value.currentBook, duration),
        (async () => {
          const book = await db.getBook(stats.value.currentBook)
          if (book) {
            book.time = (book.time || 0) + duration
            book.read = Date.now()
            await db.saveBook(book)
          }
        })()
      )
    }
    
    await Promise.all(tasks)
  }

  const saveIncrement = async () => {
    if (!stats.value.lastSaved) return
    const now = Date.now()
    const duration = Math.floor((now - stats.value.lastSaved) / 1000)
    if (duration < 1) return
    await save(duration)
    stats.value.lastSaved = now
  }

  const startReading = (bookUrl: string) => {
    const now = Date.now()
    stats.value.sessionStart = now
    stats.value.lastSaved = now
    stats.value.currentBook = bookUrl
  }

  const stopReading = async () => {
    if (!stats.value.sessionStart) return
    await saveIncrement()
    stats.value.sessionStart = 0
    stats.value.lastSaved = 0
    stats.value.currentBook = ''
  }

  const init = () => {
    load()
    
    const bar = document.createElement('div')
    bar.className = 'toolbar__item b3-tooltips b3-tooltips__n'
    bar.id = 'stats-btn'
    bar.innerHTML = '<svg class="toolbar__icon"><use xlink:href="#iconClock"></use></svg>'
    bar.setAttribute('aria-label', '点击查看阅读统计')
    bar.style.cursor = 'pointer'
    bar.addEventListener('click', () => window.dispatchEvent(new CustomEvent('stats:toggle')))
    plugin.addStatusBar({ element: bar, position: 'right' })

    const timer = setInterval(saveIncrement, 60000)
    const beforeUnload = () => stopReading()
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('reader:open', ((e: CustomEvent) => startReading(e.detail?.bookUrl || '')) as any)
    window.addEventListener('reader:close', stopReading as any)

    return () => {
      clearInterval(timer)
      window.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('reader:open', () => {})
      window.removeEventListener('reader:close', stopReading as any)
      stopReading()
    }
  }

  return { stats, fmt, fmtShort, init }
}
