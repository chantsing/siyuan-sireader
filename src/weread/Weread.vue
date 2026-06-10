<template>
  <div class="wr-page">
    <div class="wr-top">
      <div class="wr-brand">
        <div class="wr-mark">
          <svg><use xlink:href="#iconWeread"/></svg>
        </div>
        <div>
          <h2>微信读书</h2>
          <p>{{ keyReady ? `Agent API 已连接 · ${apiCount} 组数据` : '连接 Agent API 后同步书架、笔记与统计' }}</p>
        </div>
      </div>
      <div class="wr-key">
        <input v-model.trim="apiKey" class="b3-text-field" type="password" autocomplete="off" placeholder="微信读书 API Key">
        <button class="wr-icon b3-tooltips b3-tooltips__sw" aria-label="打开微信读书 Skill 页面获取 API Key" @click="openKeyHelp"><svg><use xlink:href="#iconHelp"/></svg></button>
        <button class="wr-btn b3-tooltips b3-tooltips__sw" aria-label="测试 API Key 并保存到书源配置" :disabled="loading.test" @click="testKey"><svg><use xlink:href="#lucide-radio"/></svg>测试</button>
      </div>
    </div>
    <div class="wr-search">
      <input v-model.trim="keyword" class="b3-text-field" :placeholder="activeTab === 'shelf' ? '搜索当前书架' : '搜索微信读书书城'" @keyup.enter="handleSearch">
      <button class="wr-btn primary b3-tooltips b3-tooltips__s" :aria-label="activeTab === 'shelf' ? '筛选当前书架' : '按关键词搜索微信读书书城'" :disabled="activeTab !== 'shelf' && loading.search" @click="handleSearch"><svg><use xlink:href="#lucide-search"/></svg>{{ activeTab === 'shelf' ? '筛选' : '搜索' }}</button>
      <button class="wr-btn b3-tooltips b3-tooltips__s" aria-label="同步书架、笔记、统计和推荐" :disabled="loading.all" @click="refreshAll"><svg><use xlink:href="#lucide-refresh-cw"/></svg>同步</button>
    </div>

    <div class="wr-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="b3-tooltips b3-tooltips__s"
        :aria-label="`切换到${tab.label}`"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        <svg><use :xlink:href="tab.icon"/></svg>{{ tab.label }}
        <em v-if="countForTab(tab.id)">{{ countForTab(tab.id) }}</em>
      </button>
    </div>

    <div class="wr-overview">
      <div>
        <span>书架</span>
        <strong>{{ shelfBooks.length || '-' }}</strong>
      </div>
      <div>
        <span>笔记</span>
        <strong>{{ notebookSummary.totalNoteCount || noteTotal || '-' }}</strong>
      </div>
      <div>
        <span>阅读</span>
        <strong>{{ formatDuration(stats.totalReadTime || 0) }}</strong>
      </div>
    </div>

    <div
      class="wr-grid"
      :class="{ 'is-stats': activeTab === 'stats' }"
      :style="{ '--wr-left-width': `${leftWidth}px` }"
    >
      <main class="wr-main">
        <section v-if="activeTab === 'search'" class="wr-list">
          <div v-if="searchGroups.length" class="wr-summary">
            <strong>{{ searchResults.length }}</strong><span>条结果</span>
            <strong>{{ raw.search?.sid || '-' }}</strong><span>搜索会话</span>
          </div>
          <template v-for="group in visibleSearchGroups" :key="group.title || group.scope">
            <div class="wr-group-title">
              <span>{{ group.title || '搜索结果' }}</span>
              <em>{{ group.currentCount || group.books?.length || 0 }} / {{ group.scopeCount || group.books?.length || 0 }}</em>
            </div>
            <article v-for="book in group.books || []" :key="bookKey(book)" class="wr-row b3-list-item--hide-action bs-row" @click="selectBook(book)">
              <img :src="coverOf(book)" @error="hideBrokenCover">
              <div class="wr-row-main">
                <h3>{{ titleOf(book) }}</h3>
                <p>{{ authorOf(book) }}</p>
                <div class="wr-meta">
                  <span v-if="ratingOf(book)">{{ ratingOf(book) }}</span>
                  <span v-if="categoryOf(book)">{{ categoryOf(book) }}</span>
                  <span v-if="book.readingCount">{{ book.readingCount }} 人在读</span>
                  <span v-if="book.searchIdx">#{{ book.searchIdx }}</span>
                </div>
              </div>
              <div class="wr-row-actions" @click.stop>
                <button class="wr-icon b3-tooltips b3-tooltips__nw" aria-label="在阅读器中打开微信读书网页" @click="readBook(book)"><svg><use xlink:href="#lucide-book-open-text"/></svg></button>
                <button class="wr-icon b3-tooltips b3-tooltips__nw" :aria-label="isInShelf(book) ? '已在 SiReader 书架' : '添加到 SiReader 书架'" :class="{ done: isInShelf(book) }" @click="addBook(book)"><svg><use :xlink:href="isInShelf(book) ? '#lucide-check' : '#lucide-book-plus'"/></svg></button>
              </div>
            </article>
          </template>
          <div v-if="!searchResults.length && !loading.search" class="wr-empty">没有搜索结果</div>
        </section>

        <section v-else-if="activeTab === 'shelf'" class="wr-list">
          <div class="wr-summary">
            <strong>{{ filteredShelfBooks.length }}</strong><span>电子书</span>
            <strong>{{ shelfAlbums.length }}</strong><span>有声书</span>
            <strong>{{ shelfArchives.length }}</strong><span>分组</span>
          </div>
          <template v-for="group in shelfGroups" :key="group.name">
            <div v-if="shelfGroups.length > 1" class="wr-group-title is-toggle" @click="toggleShelfGroup(group.name)">
              <span><i :class="{ open: isShelfGroupOpen(group.name) }"></i>{{ group.name }}</span><em>{{ group.books.length }}</em>
            </div>
            <article v-for="book in isShelfGroupOpen(group.name) ? group.books : []" :key="bookKey(book)" class="wr-row b3-list-item--hide-action bs-row" @click="selectBook(book)">
              <img :src="coverOf(book)" @error="hideBrokenCover">
              <div class="wr-row-main">
                <h3>{{ titleOf(book) }}</h3>
                <p>{{ authorOf(book) }}</p>
                <div class="wr-progress"><i :style="{ width: `${progressOf(book)}%` }"></i></div>
                <div class="wr-meta">
                  <span v-if="book.isTop">置顶</span>
                  <span v-if="book.secret">私密</span>
                  <span v-if="book.finishReading">已读完</span>
                  <span v-if="book.readUpdateTime">读于 {{ formatDate(book.readUpdateTime) }}</span>
                </div>
              </div>
              <div class="wr-row-actions" @click.stop>
                <button class="wr-icon b3-tooltips b3-tooltips__nw" aria-label="在阅读器中打开微信读书网页" @click="readBook(book)"><svg><use xlink:href="#lucide-book-open-text"/></svg></button>
                <button class="wr-icon b3-tooltips b3-tooltips__nw" :aria-label="isInShelf(book) ? '已在 SiReader 书架' : '添加到 SiReader 书架'" :class="{ done: isInShelf(book) }" @click="addBook(book)"><svg><use :xlink:href="isInShelf(book) ? '#lucide-check' : '#lucide-book-plus'"/></svg></button>
              </div>
            </article>
          </template>
          <div v-if="shelfAlbums.length" class="wr-group-title"><span>有声书</span><em>{{ shelfAlbums.length }}</em></div>
          <article v-for="album in shelfAlbums" :key="bookKey(album)" class="wr-row is-muted">
            <img :src="coverOf(album)" @error="hideBrokenCover">
            <div class="wr-row-main">
              <h3>{{ titleOf(album) }}</h3>
              <p>{{ authorOf(album) }}</p>
              <div class="wr-meta"><span>{{ infoOf(album).trackCount || 0 }} 集</span><span v-if="infoOf(album).finishStatus">{{ infoOf(album).finishStatus }}</span><span>API 已返回</span></div>
            </div>
          </article>
          <div v-if="!filteredShelfBooks.length && !loading.shelf" class="wr-empty">{{ keyword ? '当前书架没有匹配书籍' : '暂无书架数据' }}</div>
        </section>

        <section v-else-if="activeTab === 'notes'" class="wr-list">
          <div class="wr-summary">
            <strong>{{ notebookSummary.totalBookCount || notebooks.length }}</strong><span>本书</span>
            <strong>{{ notebookSummary.totalNoteCount || noteTotal }}</strong><span>条笔记</span>
            <strong>{{ notebookSummary.hasMore ? '有' : '无' }}</strong><span>更多</span>
          </div>
          <article v-for="item in notebooks" :key="bookKey(item)" class="wr-row b3-list-item--hide-action bs-row" @click="selectBook(item)">
            <img :src="coverOf(item)" @error="hideBrokenCover">
            <div class="wr-row-main">
              <h3>{{ titleOf(item) }}</h3>
              <p>{{ authorOf(item) }}</p>
              <div class="wr-meta"><span>{{ item.noteCount || 0 }} 划线</span><span>{{ item.reviewCount || 0 }} 想法</span><span>{{ item.bookmarkCount || 0 }} 书签</span><span>{{ progressOf(item) }}%</span></div>
            </div>
          </article>
        </section>

        <section v-else-if="activeTab === 'stats'" class="wr-stats">
          <div class="wr-stat-modes">
            <button v-for="mode in statModes" :key="mode.id" class="b3-tooltips b3-tooltips__s" :aria-label="`加载${mode.label}阅读统计`" :class="{ active: statsMode === mode.id }" :disabled="loading.stats" @click="loadStats(mode.id)">{{ mode.label }}</button>
          </div>
          <div class="wr-stat-line">
            <div><strong>{{ formatDuration(stats.totalReadTime) }}</strong><span>阅读时长</span></div>
            <div><strong>{{ stats.readDays || 0 }}</strong><span>阅读天数</span></div>
            <div><strong>{{ formatDuration(stats.dayAverageReadTime) }}</strong><span>日均</span></div>
            <div><strong>{{ compareText }}</strong><span>环比</span></div>
          </div>
          <div v-if="stats.readStat?.length" class="wr-stat-chips">
            <span v-for="item in stats.readStat" :key="item.stat">{{ item.stat }} {{ item.counts }}</span>
          </div>
          <div v-if="!hasStats" class="wr-empty">当前周期暂无阅读统计，试试切换到“全部”</div>
          <div class="wr-bars">
            <div v-for="item in categoryStats" :key="item.categoryTitle">
              <span>{{ item.categoryTitle }}</span>
              <i><b :style="{ width: `${item.percent}%` }"></b></i>
              <em>{{ item.readingCount || 0 }} 本 · {{ formatDuration(item.readingTime) }}</em>
            </div>
          </div>
          <div class="wr-days" v-if="readTimeDays.length">
            <span v-for="day in readTimeDays" :key="day.date" class="b3-tooltips b3-tooltips__n" :aria-label="`${day.date} ${formatDuration(day.seconds)}`" :style="{ height: `${day.height}%` }"></span>
          </div>
          <div class="wr-mini-books">
            <article v-for="item in longestReads" :key="bookKey(item.book)" @click="selectBook(item.book)">
              <strong>{{ titleOf(item.book) }}</strong>
              <span>{{ formatDuration(item.readTime) }} <template v-if="item.tags?.length">· {{ item.tags.join(' / ') }}</template></span>
            </article>
          </div>
        </section>

        <section v-else class="wr-list">
          <article v-for="book in recommendBooks" :key="bookKey(book)" class="wr-row b3-list-item--hide-action bs-row" @click="selectBook(book)">
            <img :src="coverOf(book)" @error="hideBrokenCover">
            <div class="wr-row-main">
              <h3>{{ titleOf(book) }}</h3>
              <p>{{ authorOf(book) }}</p>
              <div class="wr-meta"><span v-if="categoryOf(book)">{{ categoryOf(book) }}</span><span v-if="ratingOf(book)">{{ ratingOf(book) }}</span><span v-if="infoOf(book).price">¥{{ infoOf(book).price }}</span></div>
            </div>
            <div class="wr-row-actions" @click.stop>
              <button class="wr-icon b3-tooltips b3-tooltips__nw" aria-label="在阅读器中打开微信读书网页" @click="readBook(book)"><svg><use xlink:href="#lucide-book-open-text"/></svg></button>
              <button class="wr-icon b3-tooltips b3-tooltips__nw" :aria-label="isInShelf(book) ? '已在 SiReader 书架' : '添加到 SiReader 书架'" :class="{ done: isInShelf(book) }" @click="addBook(book)"><svg><use :xlink:href="isInShelf(book) ? '#lucide-check' : '#lucide-book-plus'"/></svg></button>
            </div>
          </article>
          <div v-if="!recommendBooks.length && !loading.recommend" class="wr-empty">暂无推荐数据</div>
        </section>
      </main>

      <div class="wr-resizer b3-tooltips b3-tooltips__n" aria-label="拖动调整两栏宽度" @mousedown.prevent="startResize"></div>

      <aside class="wr-detail">
        <div v-if="!selectedBook" class="wr-empty detail">选择一本书查看目录和笔记</div>
        <template v-else>
          <div class="wr-detail-head">
            <img :src="coverOf(selectedBook)" @error="hideBrokenCover">
            <div>
              <h2>{{ titleOf(selectedBook) }}</h2>
              <p>{{ authorOf(selectedBook) }}</p>
              <div class="wr-meta"><span v-if="detailRating">{{ detailRating }}</span><span v-if="detail.category">{{ detail.category }}</span><span v-if="detail.publisher">{{ detail.publisher }}</span></div>
            </div>
          </div>
          <div class="wr-actions">
            <button class="wr-btn primary b3-tooltips b3-tooltips__s" aria-label="在 SiReader 阅读器中打开微信读书网页" @click="readBook(selectedBook)"><svg><use xlink:href="#lucide-book-open-text"/></svg>阅读</button>
            <button class="wr-btn b3-tooltips b3-tooltips__s" :aria-label="isInShelf(selectedBook) ? '已添加到 SiReader 书架' : '添加到 SiReader 书架'" :class="{ done: isInShelf(selectedBook) }" @click="addBook(selectedBook)"><svg><use :xlink:href="isInShelf(selectedBook) ? '#lucide-check' : '#lucide-book-plus'"/></svg>{{ isInShelf(selectedBook) ? '已在书架' : '加入书架' }}</button>
            <button class="wr-btn b3-tooltips b3-tooltips__s" aria-label="导出书籍信息链接" @click="exportBookInfo"><svg><use xlink:href="#iconUpload"/></svg>导出</button>
          </div>
          <section v-if="detail.intro" class="wr-book-section wr-intro-section">
            <div class="wr-section-title">简介</div>
            <p class="wr-intro" :class="{ expanded: introExpanded }">{{ detail.intro }}</p>
            <button v-if="introCollapsible" class="wr-intro-more" @click="introExpanded = !introExpanded">{{ introExpanded ? '收起' : '展开全部' }}</button>
          </section>
          <div class="wr-kpis">
            <div><strong>{{ progressDetail }}</strong><span>进度</span></div>
            <div><strong>{{ chapters.length }}</strong><span>章节</span></div>
            <div><strong>{{ highlights.length }}</strong><span>我的划线</span></div>
            <div><strong>{{ bestBookmarksTotal }}</strong><span>热门划线</span></div>
          </div>
          <section v-if="detail.publishTime || detail.isbn || progress.value?.book?.readingTime || progress.value?.book?.chapterUid" class="wr-book-section">
            <div class="wr-section-title">书籍信息</div>
            <div class="wr-fields">
              <span v-if="detail.publishTime"><em>出版</em>{{ detail.publishTime }}</span>
              <span v-if="detail.isbn"><em>ISBN</em>{{ detail.isbn }}</span>
              <span v-if="progress.value?.book?.readingTime"><em>已读</em>{{ formatDuration(progress.value.book.readingTime) }}</span>
              <span v-if="progress.value?.book?.chapterUid"><em>章节</em>{{ progress.value.book.chapterUid }}</span>
            </div>
          </section>
          <div class="wr-subtabs">
            <button v-for="tab in detailTabs" :key="tab.id" class="b3-tooltips b3-tooltips__s" :aria-label="`查看${tab.label}`" :class="{ active: detailTab === tab.id }" @click="detailTab = tab.id">{{ tab.label }}<em v-if="detailCount(tab.id)">{{ detailCount(tab.id) }}</em></button>
          </div>
          <div class="wr-detail-body">
            <template v-if="detailTab === 'chapters'">
              <div class="wr-toc fn__flex-1 fn__flex-column file-tree sy__file bs-view bs-tree-view">
                <div
                  class="fn__flex-1 fn__hidescrollbar"
                  @click="onChapterTocClick"
                  @contextmenu.prevent.stop
                  @mouseover="onChapterTocMouseover"
                  v-html="chapterTreeHtml"
                ></div>
              </div>
              <div v-if="underlines.length" class="wr-underlines">
                <div class="wr-group-title"><span>章节热度</span><em>{{ underlines.length }}</em></div>
                <div v-for="item in underlines.slice(0, 20)" :key="item.range" class="wr-heat"><span>{{ item.range }}</span><i><b :style="{ width: `${heatPercent(item)}%` }"></b></i><em>{{ item.count || 0 }} 人</em></div>
              </div>
            </template>
            <template v-else-if="detailTab === 'marks'">
              <div v-if="highlightMarks.length" class="wr-group-title"><span>我的划线</span><em>{{ highlightMarks.length }}</em></div>
              <div v-for="mark in highlightMarks" :key="mark.id" class="sr-card">
                <MarkCard :time="formatDateTime(mark.timestamp)" :tags="mark.tags" :text="mark.text" :chapter="mark.chapter" :note="mark.note" :mark-color="mark.color" @go="goMark(mark)">
                  <template #actions><div class="sr-head-actions"><button class="b3-tooltips b3-tooltips__nw" aria-label="复制标注链接" @click.stop="exportMark(mark)"><svg><use xlink:href="#iconCopy"/></svg></button></div></template>
                  <template #meta><div class="wr-meta"><span>{{ mark.range }}</span></div></template>
                </MarkCard>
              </div>
              <div v-if="bestBookmarkMarks.length" class="wr-group-title"><span>热门划线 TOP20</span><em>{{ bestBookmarkMarks.length }} / {{ bestBookmarksTotal }}</em></div>
              <div v-for="mark in bestBookmarkMarks" :key="mark.id" class="sr-card is-hot">
                <MarkCard :time="formatDateTime(mark.timestamp)" :tags="mark.tags" :text="mark.text" :chapter="mark.chapter" :note="mark.note" :mark-color="mark.color" @go="goMark(mark)">
                  <template #actions><div class="sr-head-actions"><button class="b3-tooltips b3-tooltips__nw" aria-label="复制标注链接" @click.stop="exportMark(mark)"><svg><use xlink:href="#iconCopy"/></svg></button><button class="b3-tooltips b3-tooltips__nw" aria-label="加载这条热门划线下的公众想法" @click.stop="loadReadReviews(mark)"><svg><use xlink:href="#lucide-message-circle"/></svg></button></div></template>
                </MarkCard>
              </div>
              <div v-for="group in readReviews" :key="group.range" class="wr-review-group">
                <div class="wr-group-title"><span>{{ group.range }} 的想法</span><em>{{ group.totalCount || 0 }}</em></div>
                <div v-for="mark in pageReviewMarks(group)" :key="mark.id" class="sr-card">
                  <MarkCard :time="formatDateTime(mark.timestamp)" :tags="mark.tags" :text="mark.text" :chapter="mark.chapter" :note="mark.note" mark-color="blue" @go="goMark(mark)">
                    <template #actions><div class="sr-head-actions"><button class="b3-tooltips b3-tooltips__nw" aria-label="复制想法链接" @click.stop="exportMark(mark)"><svg><use xlink:href="#iconCopy"/></svg></button></div></template>
                  </MarkCard>
                </div>
              </div>
            </template>
            <template v-else-if="detailTab === 'reviews'">
              <div v-for="mark in reviewMarks" :key="mark.id" class="sr-card">
                <MarkCard :time="formatDateTime(mark.timestamp)" :tags="mark.tags" :text="mark.text" :chapter="mark.chapter" :note="mark.note" mark-color="blue" @go="goMark(mark)">
                  <template #actions><div class="sr-head-actions"><button class="b3-tooltips b3-tooltips__nw" aria-label="复制想法链接" @click.stop="exportMark(mark)"><svg><use xlink:href="#iconCopy"/></svg></button><button class="b3-tooltips b3-tooltips__nw" aria-label="加载单条想法详情" @click.stop="loadReviewSingle(mark)"><svg><use xlink:href="#lucide-message-circle"/></svg></button></div></template>
                  <template #meta><div class="wr-meta"><span v-if="mark.authorName">{{ mark.authorName }}</span><span v-if="mark.likesCount">{{ mark.likesCount }} 赞</span><span v-if="mark.commentsCount">{{ mark.commentsCount }} 评论</span><span v-if="mark.star">{{ mark.star }} 分</span></div></template>
                </MarkCard>
              </div>
            </template>
            <template v-else-if="detailTab === 'similar'">
              <article v-for="book in similarBooks" :key="bookKey(book)" class="wr-similar" @click="selectBook(book)">
                <img :src="coverOf(book)" @error="hideBrokenCover">
                <div><span>{{ titleOf(book) }}</span><em>{{ authorOf(book) }}</em></div>
              </article>
            </template>
          </div>
        </template>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { showMessage } from 'siyuan'
import { addOnlineBookToShelf } from '@/composables/useBookImport'
import { bookshelfManager } from '@/core/bookshelf'
import { httpSourceManager } from '@/utils/HttpSources'
import { exportBookLink, copyMark as copyMarkUtil } from '@/utils/copy'
import MarkCard from '@/components/MarkCard.vue'
import { callWereadAgentDirect, createWereadOnlineBookInfo, getWereadChapterReadUrl, getWereadReadUrl, testWereadAgentKey } from '@/weread/agent'
import { createWereadReaderContext, getWereadChapterTitle, getWereadChapterUid, toWereadHighlightMark, toWereadReviewMark } from '@/weread/context'

defineProps<{ i18n: any }>()

const SOURCE_ID = 'weread-agent'
const KEY_HELP_URL = 'https://weread.qq.com/r/weread-skills'
const tabs = [
  { id: 'search', label: '搜索', icon: '#lucide-search' },
  { id: 'shelf', label: '书架', icon: '#lucide-library-big' },
  { id: 'notes', label: '笔记', icon: '#lucide-square-pen' },
  { id: 'stats', label: '统计', icon: '#lucide-chart-pie' },
  { id: 'recommend', label: '推荐', icon: '#lucide-zap' },
] as const
const detailTabs = [{ id: 'chapters', label: '目录' }, { id: 'marks', label: '划线' }, { id: 'reviews', label: '想法' }, { id: 'similar', label: '相似' }] as const
const statModes = [{ id: 'weekly', label: '本周' }, { id: 'monthly', label: '本月' }, { id: 'annually', label: '今年' }, { id: 'overall', label: '全部' }] as const

const activeTab = ref<(typeof tabs)[number]['id']>('shelf')
const detailTab = ref<(typeof detailTabs)[number]['id']>('chapters')
const apiKey = ref('')
const keyword = ref('')
const statsMode = ref<(typeof statModes)[number]['id']>('monthly')
const selectedBook = ref<any>(null)
const searchGroups = ref<any[]>([])
const searchResults = ref<any[]>([])
const shelfBooks = ref<any[]>([])
const shelfAlbums = ref<any[]>([])
const shelfArchives = ref<any[]>([])
const notebooks = ref<any[]>([])
const recommendBooks = ref<any[]>([])
const similarBooks = ref<any[]>([])
const chapters = ref<any[]>([])
const highlights = ref<any[]>([])
const bestBookmarks = ref<any[]>([])
const mineReviews = ref<any[]>([])
const publicReviews = ref<any[]>([])
const readReviews = ref<any[]>([])
const underlines = ref<any[]>([])
const detail = ref<any>({})
const progress = ref<any>({})
const stats = ref<any>({})
const notebookSummary = ref<any>({})
const introExpanded = ref(false)
const shelfKeys = ref(new Set<string>())
const expandedShelfGroups = ref(new Set<string>())
const expandedChapters = ref(new Set<string>())
const leftWidth = ref(Number(localStorage.getItem('sireader.weread.leftWidth') || 360))
const raw = reactive<Record<string, any>>({})
const loading = reactive({ all: false, search: false, shelf: false, recommend: false, detail: false, test: false, stats: false, extra: false })

const keyReady = computed(() => !!apiKey.value)
const apiCount = computed(() => Object.keys(raw).length)
const visibleSearchGroups = computed(() => searchGroups.value.length ? searchGroups.value : [{ title: '搜索结果', books: searchResults.value }])
const filteredShelfBooks = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (activeTab.value !== 'shelf' || !q) return shelfBooks.value
  return shelfBooks.value.filter(book => [titleOf(book), authorOf(book), categoryOf(book)].join(' ').toLowerCase().includes(q))
})
const shelfGroups = computed(() => {
  const books = filteredShelfBooks.value
  const archives = shelfArchives.value || []
  if (!archives.length) return [{ name: '全部', books }]
  const used = new Set<string>()
  const idOf = (item: any) => typeof item === 'string' ? item : bookIdOf(item)
  const groups = archives.map(archive => {
    const ids = new Set([...(archive.bookIds || archive.bookIdList || []), ...(archive.books || []).map(idOf)].map(String))
    const groupBooks = books.filter(book => ids.has(bookIdOf(book)))
    groupBooks.forEach(book => used.add(bookIdOf(book)))
    return { name: archive.name || archive.title || '未命名分组', books: groupBooks }
  }).filter(group => group.books.length)
  const rest = books.filter(book => !used.has(bookIdOf(book)))
  return rest.length ? [...groups, { name: '未分组', books: rest }] : groups
})
const noteTotal = computed(() => notebooks.value.reduce((sum, item) => sum + Number(item.noteCount || 0) + Number(item.reviewCount || 0) + Number(item.bookmarkCount || 0), 0))
const detailRating = computed(() => ratingOf(detail.value || selectedBook.value))
const progressDetail = computed(() => `${Number(progress.value?.book?.progress || progress.value?.progress || progressOf(selectedBook.value) || 0)}%`)
const introCollapsible = computed(() => String(detail.value?.intro || '').length > 90)
const bestBookmarksTotal = computed(() => Number(raw.bestBookmarks?.totalCount || bestBookmarks.value.length || 0))
const compareText = computed(() => {
  const value = Number(stats.value?.compare || 0)
  if (!value) return '-'
  return `${value > 0 ? '+' : ''}${Math.round(value * 100)}%`
})
const categoryStats = computed(() => {
  const list = Array.isArray(stats.value?.preferCategory) ? stats.value.preferCategory : []
  const max = Math.max(1, ...list.map((item: any) => Number(item.readingTime || 0)))
  return list.slice(0, 10).map((item: any) => ({ ...item, percent: Math.max(6, Math.round(Number(item.readingTime || 0) / max * 100)) }))
})
const longestReads = computed(() => (Array.isArray(stats.value?.readLongest) ? stats.value.readLongest : []).slice(0, 6))
const readTimeDays = computed(() => {
  const entries = Object.entries(stats.value?.readTimes || {}) as Array<[string, any]>
  const max = Math.max(1, ...entries.map(([, seconds]) => Number(seconds || 0)))
  return entries.slice(-42).map(([ts, seconds]) => ({ date: formatDate(Number(ts)), seconds: Number(seconds || 0), height: Math.max(8, Math.round(Number(seconds || 0) / max * 100)) }))
})
const hasStats = computed(() => Number(stats.value?.totalReadTime || 0) > 0 || Number(stats.value?.readDays || 0) > 0 || categoryStats.value.length > 0 || longestReads.value.length > 0)
const selectedBookId = computed(() => bookIdOf(selectedBook.value))
const highlightMarks = computed(() => highlights.value.map((item, index) => toWereadHighlightMark(item, index, '我的划线', selectedBookId.value, chapters.value)))
const bestBookmarkMarks = computed(() => bestBookmarks.value.map((item, index) => toWereadHighlightMark(item, index, '热门划线', selectedBookId.value, chapters.value)))
const reviewMarks = computed(() => [
  ...mineReviews.value.map((item, index) => toWereadReviewMark(item, index, '我的想法', selectedBookId.value, chapters.value)),
  ...publicReviews.value.map((item, index) => toWereadReviewMark(item, index, '公开想法', selectedBookId.value, chapters.value)),
].filter(item => item.text || item.note))
type ChapterNode = { id: string; level: number; chapter: any; children: ChapterNode[] }
const chapterUidOf = (chapter: any, index = 0) => getWereadChapterUid(chapter) || Number(chapter?.chapterUid || chapter?.chapterId || chapter?.uid || index + 1)
const chapterTree = computed(() => {
  const roots: ChapterNode[] = []
  const stack: ChapterNode[] = []
  chapters.value.forEach((chapter, index) => {
    const level = Math.max(1, Number(chapter?.level || 1))
    const node = { id: String(chapterUidOf(chapter, index)), level, chapter, children: [] as ChapterNode[] }
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
    ;(stack[stack.length - 1]?.children || roots).push(node)
    stack.push(node)
  })
  return roots
})
const isChapterOpen = (node: ChapterNode) => expandedChapters.value.has(node.id)
const toggleChapter = (node: ChapterNode) => {
  const next = new Set(expandedChapters.value)
  next.has(node.id) ? next.delete(node.id) : next.add(node.id)
  expandedChapters.value = next
}
const esc = (value: unknown) => {
  const div = document.createElement('div')
  div.textContent = String(value ?? '')
  return div.innerHTML
}
const chapterNodeById = computed(() => {
  const map = new Map<string, ChapterNode>()
  const walk = (nodes: ChapterNode[]) => nodes.forEach(node => {
    map.set(node.id, node)
    walk(node.children)
  })
  walk(chapterTree.value)
  return map
})
const renderChapterNode = (node: ChapterNode) => {
  const hasChild = !!node.children.length
  const isOpen = isChapterOpen(node)
  const title = esc(node.chapter?.title || '未命名章节')
  const wordCount = Number(node.chapter?.wordCount || 0)
  const row = `<li class="b3-list-item b3-list-item--hide-action" style="--file-toggle-width:${(node.level - 1) * 18 + 18}px" data-id="${esc(node.id)}" data-has-child="${hasChild}" data-type="${node.level > 1 ? 'navigation-file' : 'navigation-root'}" data-toc-item>
    <span style="padding-left:${(node.level - 1) * 18}px" class="b3-list-item__toggle b3-list-item__toggle--hl${hasChild ? '' : ' fn__hidden'}" data-act="toggle">
      ${hasChild ? `<svg class="b3-list-item__arrow${isOpen ? ' b3-list-item__arrow--open' : ''}"><use xlink:href="#iconRight"></use></svg>` : ''}
    </span>
    <span class="b3-list-item__text ariaLabel" aria-label="${title}" data-act="open" data-toc-item>${title}</span>
    <span class="fn__space"></span>
    <span class="wr-chapter-meta">${wordCount} 字</span>
    <span class="b3-list-item__action b3-tooltips b3-tooltips__nw" aria-label="复制章节链接" data-act="copy"><svg><use xlink:href="#iconCopy"></use></svg></span>
    <span class="b3-list-item__action b3-tooltips b3-tooltips__nw" aria-label="加载本章划线热度" data-act="heat"><svg><use xlink:href="#lucide-zap"></use></svg></span>
  </li>`
  const children = hasChild && isOpen ? `<ul class="b3-list b3-list--background bs-tree-children">${node.children.map(renderChapterNode).join('')}</ul>` : ''
  return row + children
}
const chapterTreeHtml = computed(() => chapterTree.value.length
  ? `<ul class="b3-list b3-list--background">${chapterTree.value.map(renderChapterNode).join('')}</ul>`
  : '<ul class="b3-list b3-list--background"><li class="b3-list-item"><span class="b3-list-item__toggle fn__hidden"></span><span class="b3-list-item__text ft__secondary">暂无目录</span></li></ul>')
const onChapterTocClick = (event: MouseEvent) => {
  event.stopPropagation()
  const target = event.target as HTMLElement
  const item = target.closest<HTMLElement>('.b3-list-item[data-id]')
  if (!item) return
  const node = chapterNodeById.value.get(item.dataset.id || '')
  if (!node) return
  const act = target.closest<HTMLElement>('[data-act]')?.dataset.act || 'open'
  if (act === 'toggle') return toggleChapter(node)
  if (act === 'copy') return void exportChapter(node.chapter)
  if (act === 'heat') return void loadUnderlines(chapterUidOf(node.chapter))
  goChapter(node.chapter)
}
const onChapterTocMouseover = (event: MouseEvent) => {
  if ((event.target as HTMLElement).hasAttribute('data-toc-item')) event.stopPropagation()
}

const infoOf = (book: any) => book?.bookInfo || book?.book || book?.albumInfo || book || {}
const bookIdOf = (book: any) => String(infoOf(book)?.bookId || book?.bookId || infoOf(book)?.albumId || book?.albumId || '')
const bookKey = (book: any) => `${bookIdOf(book)}-${book?.searchIdx || book?.sort || infoOf(book)?.updateTime || ''}`
const titleOf = (book: any) => String(infoOf(book)?.title || infoOf(book)?.name || '未命名')
const authorOf = (book: any) => String(infoOf(book)?.author || infoOf(book)?.authorName || '未知作者')
const coverOf = (book: any) => String(infoOf(book)?.cover || '')
const categoryOf = (book: any) => String(infoOf(book)?.category || infoOf(book)?.newRatingDetail?.title || '')
const progressOf = (book: any) => Number(book?.readingProgress || book?.progress || infoOf(book)?.progress || 0)
const ratingOf = (book: any) => {
  const rating = Number(infoOf(book)?.newRating || infoOf(book)?.rating || 0)
  return rating ? `${(rating / 100).toFixed(1)} 分` : ''
}
const reviewNodeOf = (item: any) => item?.review?.review || item?.review || item
const reviewOuterOf = (item: any) => item?.review || item
const reviewIdOf = (item: any) => String(reviewNodeOf(item)?.reviewId || reviewOuterOf(item)?.reviewId || item?.reviewId || `${Math.random()}`)
const hideBrokenCover = (event: Event) => ((event.target as HTMLImageElement).style.visibility = 'hidden')
const formatDuration = (seconds: number) => {
  const value = Number(seconds || 0)
  if (value < 60) return `${value} 秒`
  if (value < 3600) return `${Math.round(value / 60)} 分钟`
  return `${Math.round(value / 360) / 10} 小时`
}
const formatDate = (seconds?: number) => seconds ? new Date(Number(seconds) * 1000).toLocaleDateString('zh-CN') : '-'
const formatDateTime = (time?: number) => time ? new Date(Number(time)).toLocaleString('zh-CN') : '-'
const chapterTitle = (chapterUid: number) => getWereadChapterTitle(chapters.value, chapterUid)
const heatPercent = (item: any) => {
  const max = Math.max(1, ...underlines.value.map(line => Number(line.count || line.score || 0)))
  return Math.max(5, Math.round(Number(item.count || item.score || 0) / max * 100))
}
const countForTab = (id: string) => id === 'search' ? searchResults.value.length : id === 'shelf' ? shelfBooks.value.length : id === 'notes' ? notebooks.value.length : id === 'recommend' ? recommendBooks.value.length : ''
const detailCount = (id: string) => id === 'chapters' ? chapters.value.length : id === 'marks' ? `${highlights.value.length + bestBookmarks.value.length}/${highlights.value.length + bestBookmarksTotal.value}` : id === 'reviews' ? mineReviews.value.length + publicReviews.value.length : id === 'similar' ? similarBooks.value.length : ''
const isShelfGroupOpen = (name: string) => !!keyword.value.trim() || shelfGroups.value.length <= 1 || expandedShelfGroups.value.has(name)
const toggleShelfGroup = (name: string) => {
  const next = new Set(expandedShelfGroups.value)
  next.has(name) ? next.delete(name) : next.add(name)
  expandedShelfGroups.value = next
}

const callApi = async (apiName: string, params: Record<string, unknown> = {}, rawKey = apiName.replace(/^\//, '').replace(/\W+/g, '_')) => {
  const data = await callWereadAgentDirect(apiKey.value, apiName, params)
  raw[rawKey] = data
  return data
}
const sourceBook = (book: any) => ({ ...infoOf(book), bookId: bookIdOf(book) })
const readUrlOfBook = (book: any) => getWereadReadUrl(bookIdOf(book))
const chapterUrlOf = (chapter: any) => getWereadChapterReadUrl(selectedBookId.value, chapterUidOf(chapter))
const isInShelf = (book: any) => shelfKeys.value.has(readUrlOfBook(book))
const exportCtx = (clipboard = true) => ({
  bookUrl: readUrlOfBook(selectedBook.value),
  bookInfo: selectedBook.value,
  settings: clipboard ? { ...((window as any).__sireader_settings || {}), noteInsertTarget: 'clipboard' } : undefined,
  showMsg: (msg: string, type?: string) => showMessage(msg, 1600, type as any),
})
const openWereadUrl = (url: string, title = titleOf(selectedBook.value)) => {
  if (!url) return
  window.dispatchEvent(new CustomEvent('sireader:open-online-reader', { detail: { title, url } }))
  window.dispatchEvent(new CustomEvent('sireader:goto', { detail: { cfi: url } }))
}
const goChapter = (chapter: any) => openWereadUrl(chapterUrlOf(chapter))
const goMark = (mark: any) => openWereadUrl(mark.cfi)
const exportChapter = async (chapter: any) => {
  const title = chapter.title || `章节 ${chapter.chapterUid || ''}`
  await exportBookLink({ chapter: title, cfi: chapterUrlOf(chapter), text: title }, exportCtx(true))
}
const exportMark = async (mark: any) => copyMarkUtil(mark, exportCtx(true))
const exportBookInfo = async () => {
  if (!selectedBook.value) return
  const text = [detail.value?.intro, progressDetail.value ? `进度 ${progressDetail.value}` : '', chapters.value.length ? `${chapters.value.length} 章` : ''].filter(Boolean).join('\n')
  await exportBookLink({ chapter: '书籍信息', cfi: readUrlOfBook(selectedBook.value), text }, exportCtx(true))
}
const pageReviewMarks = (group: any) => (group?.pageReviews || []).map((item: any, index: number) => toWereadReviewMark(item, index, '划线想法', selectedBookId.value, chapters.value)).filter((item: any) => item.text || item.note)
const openKeyHelp = () => {
  window.dispatchEvent(new CustomEvent('sireader:open-online-reader', { detail: { title: '微信读书 API Key', url: KEY_HELP_URL } }))
}

const loadKey = async () => {
  await httpSourceManager.init()
  const source = httpSourceManager.getSource(SOURCE_ID)
  apiKey.value = source?.auth?.password || source?.auth?.cookies || ''
}
const validateKey = () => {
  const value = apiKey.value.trim()
  if (!value) return '请填写微信读书 API Key'
  if (/^Bearer\s+/i.test(value) || /^Authorization\s*:/i.test(value)) return '只需要填写 wrk- 开头的 Key，不要带 Bearer 或请求头名称'
  if (value.includes('*')) return '这个 Key 仍包含星号，可能复制的是页面展示的打码值'
  if (!/^wrk-[A-Za-z0-9_-]{12,}$/.test(value)) return 'Key 格式看起来不对，应为 wrk- 开头的一长串字符'
  return ''
}
const testKey = async () => {
  const invalid = validateKey()
  if (invalid) {
    return showMessage(invalid, 3000, 'error')
  }
  loading.test = true
  try {
    const result = await testWereadAgentKey(apiKey.value)
    await saveKey()
    raw.test = result
    showMessage('测试通过，API Key 已保存', 2200, 'info')
  } catch (error: any) {
    showMessage(`测试失败：${error.message || '未知错误'}${error.errcode ? `（${error.errcode}）` : ''}`, 4200, 'error')
  } finally {
    loading.test = false
  }
}
const saveKey = async () => {
  const invalid = validateKey()
  if (invalid) throw new Error(invalid)
  await httpSourceManager.init()
  const source = httpSourceManager.getSource(SOURCE_ID)
  if (!source) throw new Error('微信读书私密模块未安装')
  await httpSourceManager.updateSource(SOURCE_ID, { enabled: true, auth: { ...(source.auth || {}), password: apiKey.value, cookies: apiKey.value } })
}
const checkShelf = async (books: any[]) => {
  await Promise.all(books.map(async book => {
    const url = readUrlOfBook(book)
    if (url && await bookshelfManager.hasBook(url)) shelfKeys.value.add(url)
  }))
  shelfKeys.value = new Set(shelfKeys.value)
}
const searchBooks = async () => {
  if (!keyword.value) return
  loading.search = true
  try {
    const data = await callApi('/store/search', { keyword: keyword.value, scope: 10, count: 20 }, 'search')
    searchGroups.value = Array.isArray(data.results) ? data.results.filter((group: any) => Array.isArray(group.books) && group.books.length) : []
    searchResults.value = searchGroups.value.length ? searchGroups.value.flatMap((group: any) => group.books || []) : data.books || []
    await checkShelf(searchResults.value)
    activeTab.value = 'search'
  } catch (error: any) {
    showMessage(error.message || '搜索失败', 3000, 'error')
  } finally {
    loading.search = false
  }
}
const handleSearch = () => activeTab.value === 'shelf' ? undefined : searchBooks()
const loadShelf = async () => {
  loading.shelf = true
  try {
    const data = await callApi('/shelf/sync', {}, 'shelf')
    shelfBooks.value = [...(data.books || []), ...(data.mp?.book ? [data.mp.book] : [])]
    shelfAlbums.value = data.albums || []
    shelfArchives.value = data.archive || []
    await checkShelf(shelfBooks.value)
  } finally {
    loading.shelf = false
  }
}
const loadNotebooks = async () => {
  const data = await callApi('/user/notebooks', { count: 50 }, 'notebooks')
  notebookSummary.value = data
  notebooks.value = data.books || []
  await checkShelf(notebooks.value)
}
const loadStats = async (mode: (typeof statModes)[number]['id'] = statsMode.value) => {
  statsMode.value = mode
  loading.stats = true
  try {
    stats.value = await callApi('/readdata/detail', { mode }, `stats_${mode}`)
  } finally {
    loading.stats = false
  }
}
const loadRecommend = async () => {
  loading.recommend = true
  try {
    const data = await callApi('/book/recommend', { count: 18 }, 'recommend')
    recommendBooks.value = data.books || []
    await checkShelf(recommendBooks.value)
  } finally {
    loading.recommend = false
  }
}
const refreshAll = async () => {
  if (!apiKey.value) return showMessage('请先填写微信读书 API Key', 2500, 'error')
  loading.all = true
  const results = await Promise.allSettled([loadShelf(), loadNotebooks(), loadStats(), loadRecommend()])
  loading.all = false
  const failed = results.filter(item => item.status === 'rejected').length
  showMessage(failed ? `同步完成，${failed} 项失败` : '微信读书同步完成', 2000, failed ? 'error' : 'info')
}
const selectBook = async (book: any) => {
  selectedBook.value = sourceBook(book)
  detailTab.value = 'chapters'
  introExpanded.value = false
  expandedChapters.value = new Set()
  readReviews.value = []
  underlines.value = []
  const bookId = bookIdOf(book)
  if (!bookId) return
  loading.detail = true
  try {
    const [infoRes, chapterRes, progressRes, markRes, mineRes, bestRes, publicRes, similarRes] = await Promise.allSettled([
      callApi('/book/info', { bookId }, 'bookInfo'),
      callApi('/book/chapterinfo', { bookId }, 'chapterInfo'),
      callApi('/book/getprogress', { bookId }, 'progress'),
      callApi('/book/bookmarklist', { bookId }, 'bookmarkList'),
      callApi('/review/list/mine', { bookid: bookId, count: 20 }, 'mineReviews'),
      callApi('/book/bestbookmarks', { bookId, chapterUid: 0 }, 'bestBookmarks'),
      callApi('/review/list', { bookId, count: 10 }, 'publicReviews'),
      callApi('/book/similar', { bookId, count: 10 }, 'similar'),
    ])
    detail.value = infoRes.status === 'fulfilled' ? infoRes.value : selectedBook.value
    chapters.value = chapterRes.status === 'fulfilled' ? chapterRes.value.chapters || [] : []
    progress.value = progressRes.status === 'fulfilled' ? progressRes.value : {}
    highlights.value = markRes.status === 'fulfilled' ? markRes.value.updated || [] : []
    mineReviews.value = mineRes.status === 'fulfilled' ? mineRes.value.reviews || [] : []
    bestBookmarks.value = bestRes.status === 'fulfilled' ? bestRes.value.items || [] : []
    publicReviews.value = publicRes.status === 'fulfilled' ? publicRes.value.reviews || [] : []
    similarBooks.value = similarRes.status === 'fulfilled' ? similarRes.value.books || [] : []
    selectedBook.value = { ...selectedBook.value, ...detail.value }
    await checkShelf([selectedBook.value, ...similarBooks.value])
  } catch (error: any) {
    showMessage(error.message || '加载书籍详情失败', 3000, 'error')
  } finally {
    loading.detail = false
  }
}
const loadUnderlines = async (chapterUid: number) => {
  const bookId = bookIdOf(selectedBook.value)
  if (!bookId || !chapterUid) return
  loading.extra = true
  try {
    const data = await callApi('/book/underlines', { bookId, chapterUid }, 'underlines')
    underlines.value = data.underlines || []
    detailTab.value = 'chapters'
  } catch (error: any) {
    showMessage(error.message || '加载章节热度失败', 2500, 'error')
  } finally {
    loading.extra = false
  }
}
const loadReadReviews = async (bookmark: any) => {
  const bookId = bookIdOf(selectedBook.value)
  if (!bookId || !bookmark?.chapterUid || !bookmark?.range) return
  loading.extra = true
  try {
    const data = await callApi('/book/readreviews', { bookId, chapterUid: bookmark.chapterUid, reviews: [{ range: bookmark.range, count: 5 }] }, 'readReviews')
    readReviews.value = data.reviews || []
  } catch (error: any) {
    showMessage(error.message || '加载划线想法失败', 2500, 'error')
  } finally {
    loading.extra = false
  }
}
const loadReviewSingle = async (review: any) => {
  const reviewId = reviewIdOf(review)
  if (!reviewId) return
  loading.extra = true
  try {
    await callApi('/review/single', { reviewId, commentsCount: 10, likesCount: 10 }, 'reviewSingle')
    showMessage('想法详情已加载', 1200, 'info')
  } catch (error: any) {
    showMessage(error.message || '加载想法详情失败', 2500, 'error')
  } finally {
    loading.extra = false
  }
}
const addBook = async (book: any) => {
  try {
    const info = createWereadOnlineBookInfo(sourceBook(book))
    await addOnlineBookToShelf(info)
    shelfKeys.value = new Set([...shelfKeys.value, info.url])
    window.dispatchEvent(new CustomEvent('sireader:bookshelf-updated'))
    showMessage(`《${info.title || titleOf(book)}》已添加到书架`, 2000, 'info')
  } catch (error: any) {
    showMessage(error.message || '添加失败', 3000, 'error')
  }
}
const readBook = (book: any) => {
  const url = readUrlOfBook(book)
  if (!url) return showMessage('阅读地址为空', 2000, 'error')
  const context = createWereadReaderContext({ book: sourceBook(book), apiKey: apiKey.value, callApi })
  window.dispatchEvent(new CustomEvent('sireader:open-online-reader', { detail: { title: titleOf(book), url, context } }))
}
const startResize = (event: MouseEvent) => {
  const startX = event.clientX
  const startWidth = leftWidth.value
  const onMove = (move: MouseEvent) => {
    leftWidth.value = Math.min(560, Math.max(240, startWidth + move.clientX - startX))
  }
  const onUp = () => {
    localStorage.setItem('sireader.weread.leftWidth', String(leftWidth.value))
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

onMounted(async () => {
  await loadKey()
  if (apiKey.value) refreshAll()
})
onUnmounted(() => localStorage.setItem('sireader.weread.leftWidth', String(leftWidth.value)))
</script>

<style scoped lang="scss">
.wr-page{--wr-green:var(--b3-theme-primary);--wr-green-dark:var(--b3-theme-primary);--wr-mint:color-mix(in srgb,var(--b3-theme-primary) 10%,var(--b3-theme-background));--wr-ink:var(--b3-theme-on-background);--wr-soft:var(--b3-theme-surface);--wr-panel:color-mix(in srgb,var(--b3-theme-surface) 92%,var(--b3-theme-background));--wr-line:color-mix(in srgb,var(--b3-border-color) 82%,transparent);height:100%;display:flex;flex-direction:column;gap:7px;padding:10px;box-sizing:border-box;overflow:hidden;background:var(--b3-theme-background);color:var(--b3-theme-on-surface)}
.wr-top,.wr-search,.wr-tabs{display:flex;align-items:center;gap:7px;flex:0 0 auto}
.wr-top{justify-content:space-between;padding:8px 10px;border:1px solid var(--wr-line);border-radius:8px;background:var(--wr-panel)}
.wr-brand{display:flex;align-items:center;gap:9px;min-width:0;h2{margin:0;font-size:16px;line-height:1.2;font-weight:800;letter-spacing:0;color:var(--wr-ink)}p{margin:2px 0 0;font-size:11px;color:var(--b3-theme-on-surface-variant);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
.wr-mark{width:32px;height:32px;border-radius:7px;display:flex;align-items:center;justify-content:center;overflow:hidden;svg{width:100%;height:100%;display:block}}
.wr-key{display:flex;align-items:center;gap:6px;min-width:220px;max-width:430px;flex:1;justify-content:flex-end;input{max-width:280px;background:var(--b3-theme-background)}}
.wr-search{padding:0 1px;input{flex:1;min-width:0;background:var(--b3-theme-background);border-color:var(--wr-line)}}
.wr-btn,.wr-icon,.wr-tabs button,.wr-subtabs button{border:1px solid var(--wr-line);background:var(--wr-panel);color:var(--b3-theme-on-surface);border-radius:7px;cursor:pointer;box-sizing:border-box;transition:background .15s,border-color .15s,color .15s,transform .15s}
.wr-btn{height:30px;padding:0 10px;display:inline-flex;align-items:center;justify-content:center;gap:5px;font-size:12px;white-space:nowrap;svg{width:14px;height:14px}.primary,&.primary{background:var(--wr-green);border-color:var(--wr-green);color:var(--b3-theme-on-primary,#fff)}.done{opacity:.78}.active{border-color:color-mix(in srgb,var(--wr-green) 48%,var(--wr-line));color:var(--wr-green-dark);background:var(--wr-mint)}&:hover:not(:disabled){transform:translateY(-1px);border-color:color-mix(in srgb,var(--wr-green) 55%,var(--wr-line))}}
.wr-btn:disabled{opacity:.55;cursor:not-allowed}
.wr-tabs{overflow:auto;padding:1px 1px 2px;button{height:30px;padding:0 10px;display:inline-flex;align-items:center;gap:5px;font-size:12px;white-space:nowrap;svg{width:14px;height:14px}em{font-style:normal;font-size:10px;color:inherit;opacity:.68}&.active{background:var(--wr-green);border-color:var(--wr-green);color:var(--b3-theme-on-primary,#fff)}}}
.wr-overview{display:flex;align-items:center;gap:10px;min-height:28px;padding:0 2px;flex:0 0 auto;overflow:auto;div{display:flex;align-items:baseline;gap:4px;min-width:max-content;padding:0 8px;border-left:1px solid var(--wr-line)}div:first-child{border-left:0;padding-left:0}span{font-size:11px;color:var(--b3-theme-on-surface-variant)}strong{font-size:13px;color:var(--wr-ink);font-weight:800;white-space:nowrap}}
.wr-grid{min-height:0;flex:1;display:grid;grid-template-columns:minmax(240px,var(--wr-left-width)) 8px minmax(360px,1fr);gap:0;overflow:hidden;&.is-stats{grid-template-columns:minmax(0,1fr);.wr-main{border-radius:8px}.wr-resizer,.wr-detail{display:none}}}
.wr-main,.wr-detail{min-width:0;min-height:0;overflow:auto;border:1px solid var(--wr-line);background:var(--wr-panel)}
.wr-main{border-radius:8px 0 0 8px}.wr-detail{border-radius:0 8px 8px 0}
.wr-resizer{width:8px;cursor:col-resize;background:linear-gradient(90deg,transparent 3px,color-mix(in srgb,var(--wr-green) 38%,var(--wr-line)) 3px,color-mix(in srgb,var(--wr-green) 38%,var(--wr-line)) 5px,transparent 5px);opacity:.75}
.wr-list{display:flex;flex-direction:column;gap:7px;padding:9px}
.wr-summary{display:flex;align-items:baseline;gap:6px;padding:8px 9px;border-radius:8px;background:var(--wr-mint);color:var(--wr-green-dark);border:1px solid color-mix(in srgb,var(--wr-green) 26%,var(--wr-line));strong{font-size:16px}span{font-size:11px;margin-right:8px}}
.wr-group-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px;padding:4px 3px;color:var(--b3-theme-on-surface-variant);font-size:12px;font-weight:700;em{font-style:normal;font-size:11px;font-weight:500}span{display:flex;align-items:center;gap:6px;min-width:0}i{width:0;height:0;border-top:4px solid transparent;border-bottom:4px solid transparent;border-left:5px solid currentColor;transition:transform .15s;&.open{transform:rotate(90deg)}}&.is-toggle{cursor:pointer;border-radius:5px;&:hover{background:var(--b3-list-hover);color:var(--b3-theme-primary)}}}
.wr-row{display:grid;grid-template-columns:48px minmax(0,1fr) auto;gap:10px;align-items:center;min-height:74px;padding:8px;border:1px solid var(--wr-line);border-radius:8px;background:var(--b3-theme-background);cursor:pointer;box-sizing:border-box;img{width:48px;height:64px;object-fit:cover;border-radius:5px;background:var(--b3-theme-surface-lighter);box-shadow:0 5px 12px #0001}h3{margin:0;font-size:13px;line-height:1.28;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--wr-ink)}p{margin:4px 0 0;font-size:11px;color:var(--b3-theme-on-surface-variant);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}&:hover{border-color:color-mix(in srgb,var(--wr-green) 50%,var(--wr-line));background:var(--wr-soft)}.is-muted,&.is-muted{opacity:.82;cursor:default}}
.wr-row-main{min-width:0}.wr-row-actions{display:flex;gap:5px}
.wr-icon{width:29px;height:29px;display:inline-flex;align-items:center;justify-content:center;padding:0;svg{width:14px;height:14px}&.done{color:var(--wr-green);background:var(--wr-mint);border-color:color-mix(in srgb,var(--wr-green) 35%,var(--wr-line))}&:hover{border-color:color-mix(in srgb,var(--wr-green) 55%,var(--wr-line));color:var(--wr-green-dark)}}
.wr-meta{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px;span{max-width:150px;height:18px;line-height:18px;padding:0 6px;border-radius:5px;background:var(--wr-mint);font-size:10px;color:var(--b3-theme-on-surface-variant);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
.wr-progress{height:5px;margin-top:8px;border-radius:999px;background:var(--wr-soft);overflow:hidden;i{display:block;height:100%;background:var(--wr-green);border-radius:inherit}}
.wr-empty{padding:34px 12px;text-align:center;color:var(--b3-theme-on-surface-variant);font-size:12px;&.detail{height:100%;display:flex;align-items:center;justify-content:center;box-sizing:border-box}}
.wr-stats{display:flex;flex-direction:column;gap:10px;padding:10px}.wr-stat-line{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;div{padding:10px;border-radius:8px;background:var(--b3-theme-background);color:var(--wr-green-dark);border:1px solid var(--wr-line);display:flex;flex-direction:column;gap:3px}strong{font-size:17px;color:var(--wr-ink)}span{font-size:11px;color:var(--b3-theme-on-surface-variant)}}
.wr-stat-modes{display:flex;gap:6px;button{height:28px;padding:0 10px;border:1px solid var(--wr-line);border-radius:7px;background:var(--wr-panel);color:var(--b3-theme-on-surface);font-size:12px;cursor:pointer;&.active{background:var(--wr-green);border-color:var(--wr-green);color:var(--b3-theme-on-primary,#fff)}&:disabled{opacity:.55;cursor:not-allowed}}}
.wr-stat-chips{display:flex;flex-wrap:wrap;gap:6px;span{padding:3px 7px;border-radius:5px;background:var(--wr-mint);font-size:11px;color:var(--wr-green-dark)}}
.wr-bars{display:flex;flex-direction:column;gap:8px;div{display:grid;grid-template-columns:80px minmax(0,1fr) 94px;align-items:center;gap:8px;font-size:11px}span,em{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-style:normal;color:var(--b3-theme-on-surface-variant)}i{height:8px;border-radius:999px;background:var(--wr-soft);overflow:hidden}b{display:block;height:100%;background:var(--wr-green);border-radius:inherit}}
.wr-days{height:56px;display:flex;align-items:flex-end;gap:2px;padding:8px;border-radius:8px;background:var(--b3-theme-background);border:1px solid var(--wr-line);span{flex:1;min-width:3px;border-radius:2px 2px 0 0;background:var(--wr-green)}}
.wr-mini-books{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px;article{padding:9px;border:1px solid var(--wr-line);border-radius:8px;background:var(--b3-theme-background);cursor:pointer;strong,span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}strong{font-size:12px;color:var(--wr-ink)}span{margin-top:3px;font-size:11px;color:var(--b3-theme-on-surface-variant)}}}
.wr-detail{padding:12px;box-sizing:border-box;display:flex;flex-direction:column;gap:11px}
.wr-detail-head{display:grid;grid-template-columns:92px minmax(0,1fr);gap:13px;align-items:start;padding:12px;border-radius:8px;background:var(--b3-theme-background);border:1px solid var(--wr-line);img{width:92px;height:130px;object-fit:cover;border-radius:6px;background:var(--b3-theme-surface-lighter);box-shadow:0 10px 22px #0002}h2{margin:0;font-size:19px;line-height:1.28;color:var(--wr-ink);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}p{margin:7px 0 0;font-size:12px;color:var(--b3-theme-on-surface-variant)}}
.wr-actions{display:flex;gap:7px;button{flex:1;min-width:0}}
.wr-book-section{padding:10px;border:1px solid var(--wr-line);border-radius:8px;background:var(--b3-theme-background)}
.wr-section-title{margin-bottom:7px;font-size:12px;font-weight:800;color:var(--wr-ink)}
.wr-intro-section{flex:0 0 auto}
.wr-intro{margin:0;max-height:62px;overflow:hidden;padding:0 3px 0 0;font-size:12px;line-height:1.72;color:var(--b3-theme-on-surface-variant);white-space:pre-wrap;&.expanded{max-height:180px;overflow:auto}}
.wr-intro-more{align-self:flex-start;margin-top:6px;padding:0;border:0;background:transparent;color:var(--b3-theme-primary);font-size:12px;line-height:18px;cursor:pointer}
.wr-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;div{padding:9px 6px;border-radius:8px;background:var(--wr-soft);border:1px solid var(--wr-line);text-align:center;min-width:0}strong,span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}strong{font-size:14px;color:var(--wr-ink)}span{margin-top:3px;font-size:10px;color:var(--b3-theme-on-surface-variant)}}
.wr-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;span{min-width:0;display:flex;align-items:center;gap:6px;font-size:11px;color:var(--b3-theme-on-surface-variant);padding:6px 7px;border-radius:6px;background:var(--wr-soft);border:1px solid var(--wr-line);line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}em{flex:0 0 auto;font-style:normal;color:var(--wr-green-dark);font-weight:700}}
.wr-subtabs{display:flex;gap:5px;padding:3px;border-radius:8px;background:var(--wr-soft);border:1px solid var(--wr-line);button{height:27px;flex:1;font-size:11px;min-width:0;border-color:transparent;background:transparent;em{font-style:normal;margin-left:3px;opacity:.66}&.active{background:var(--b3-theme-background);color:var(--wr-green-dark);border-color:color-mix(in srgb,var(--wr-green) 35%,var(--wr-line))}}}
.wr-detail-body{min-height:260px;flex:1 1 320px;overflow:auto;display:flex;flex-direction:column;gap:7px}
.wr-toc{min-height:0;height:100%;padding:0;box-sizing:border-box;.b3-list-item{cursor:pointer}.b3-list-item__action{border:0;background:transparent;cursor:pointer}.wr-chapter-meta{font-size:10px;color:var(--b3-theme-on-surface-variant);white-space:nowrap}}
.wr-toc.bs-tree-view{padding-top:8px}
.wr-toc :deep(.b3-list){padding:0;margin:0}
.wr-toc :deep(.bs-tree-children){padding:0;margin:0}
.wr-underlines{display:flex;flex-direction:column;gap:6px}.wr-heat{display:grid;grid-template-columns:70px minmax(0,1fr) 56px;gap:6px;align-items:center;font-size:11px;color:var(--b3-theme-on-surface-variant);i{height:7px;border-radius:999px;background:var(--wr-soft);overflow:hidden}b{display:block;height:100%;background:var(--wr-green)}}
.sr-card{--sr-gap:4px;--sr-line:19px;display:flex;gap:var(--sr-gap);padding:6px;margin-bottom:6px;border:1px solid color-mix(in srgb,var(--b3-border-color) 92%,transparent);border-radius:8px;background:linear-gradient(180deg,color-mix(in srgb,var(--b3-theme-background) 96%,white),var(--b3-theme-background));color:var(--b3-theme-on-surface);position:relative;transform:none!important;box-shadow:none!important;transition:border-color .15s;&:hover{border-color:var(--b3-theme-primary)}&.is-hot{border-left:3px solid var(--b3-theme-primary)}}
.sr-head-actions{display:flex;align-items:center;gap:4px;flex-shrink:0;button{display:flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:none;background:transparent;border-radius:4px;line-height:1;cursor:pointer;color:var(--b3-theme-on-surface-variant)}button:hover{background:var(--b3-list-hover);color:var(--b3-theme-primary)}svg{width:14px;height:14px}}
.wr-review-group{display:flex;flex-direction:column;gap:6px}
.wr-similar{display:grid;grid-template-columns:36px minmax(0,1fr);gap:8px;align-items:center;padding:7px;border:1px solid var(--wr-line);border-radius:8px;background:var(--b3-theme-background);cursor:pointer;img{width:36px;height:48px;object-fit:cover;border-radius:5px;background:var(--b3-theme-surface-lighter)}span,em{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}span{font-size:12px;color:var(--wr-ink)}em{margin-top:3px;font-style:normal;font-size:11px;color:var(--b3-theme-on-surface-variant)}}
@media (max-width:900px){.wr-grid{grid-template-columns:1fr}.wr-resizer{display:none}.wr-detail{min-height:420px;border-radius:8px}.wr-main{border-radius:8px}.wr-overview{min-height:26px}}
@media (max-width:720px){.wr-top{align-items:stretch;flex-direction:column}.wr-brand p{white-space:normal}.wr-key{max-width:none;min-width:0;justify-content:stretch;input{max-width:none;flex:1}}.wr-stat-line,.wr-kpis{grid-template-columns:repeat(2,1fr)}}
</style>
