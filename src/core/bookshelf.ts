/**
 * 书架管理 - 极简架构
 */
import { reactive } from 'vue';
import { getDatabase } from './database';
import { getBookFileDataPath, getCoverFileDataPath, getManagedFileExt, normalizeBookTitle, readDirEntries, readFileBlob, readManagedFile, removeManagedFile, saveManagedFile } from './bookStore';

export type BookFormat = 'pdf' | 'epub' | 'mobi' | 'azw3' | 'online' | 'txt';
export type BookStatus = 'unread' | 'reading' | 'finished';
export interface GroupConfig { id: string; name: string; icon?: string; color?: string; parentId?: string; order: number; type: 'folder' | 'smart'; rules?: { tags?: string[]; format?: BookFormat[]; status?: BookStatus[]; rating?: number } }
export type SortType = 'time' | 'name' | 'author' | 'update' | 'progress' | 'rating' | 'readTime' | 'added';
export interface FilterOptions { query?: string; status?: BookStatus[]; rating?: number; formats?: BookFormat[]; tags?: string[]; groups?: string[]; hasUpdate?: boolean; sortBy?: SortType; reverse?: boolean }
export interface BookStats { total: number; byStatus: Record<BookStatus, number>; byFormat: Record<string, number>; byRating: Record<number, number>; withUpdate: number; annotationCount: number }

// ===== 常量 =====
export const SORTS = [['time','最近阅读'],['added','最近添加'],['progress','阅读进度'],['rating','评分'],['readTime','阅读时长'],['name','书名'],['author','作者'],['update','最近更新']] as const;
export const STATUS_OPTIONS = [['unread','未读'],['reading','在读'],['finished','读完']] as const;
export const STATUS_MAP: Record<BookStatus,string> = {unread:'未读',reading:'在读',finished:'读完'};
export const RATING_OPTIONS = [[0,'☆☆☆☆☆ 全部'],[5,'★★★★★ 仅5星'],[4,'★★★★☆ 4星及以上'],[3,'★★★☆☆ 3星及以上']] as const;
export const FORMAT_OPTIONS: BookFormat[] = ['epub','pdf','mobi','azw3','txt','online'];

class BookshelfManager {
  private ready = false;
  private coverCache = reactive<Record<string, string | null>>({});
  private db = async () => { await this.init(); return getDatabase(); };
  private async useDb<T>(task: (db: Awaited<ReturnType<typeof getDatabase>>) => Promise<T>) {
    return task(await this.db());
  }
  private saveBookData = async (book: any, notify = true) => {
    await this.useDb(db => db.saveBook(book));
    if (notify) this.notify();
  };
  private withBook = async <T>(url: string, task: (book: any) => Promise<T>, fallback: T) => {
    const book = await this.getBook(url);
    return book ? task(book) : fallback;
  };
  private mutateBook = async (url: string, mutate: (book: any) => any, fallback = false, notify = true) =>
    this.withBook(url, async book => {
      const patch = await mutate(book);
      if (!patch || patch === book) return false;
      await this.saveBookData({ ...book, ...patch }, notify);
      return true;
    }, fallback);
  
  // ===== 存储助手 =====
  private saveManagedBookFile = async (file: File, url: string) => {
    const ext = file.name.split('.').pop() || 'bin';
    return await saveManagedFile(file, getBookFileDataPath(url, ext));
  };
  private saveManagedCoverFile = async (blob: Blob, url: string) => {
    const ext = getManagedFileExt(blob.type.split('/').pop() || '', 'jpg');
    return await saveManagedFile(blob, getCoverFileDataPath(url, ext));
  };
  private saveCoverBlob = async (blob: Blob | undefined, url: string) =>
    blob ? await this.saveManagedCoverFile(blob, url) : undefined;
  private toFileUrl = (value = '') => {
    const path = String(value || '').trim()
    if (!path) return ''
    if (path.startsWith('file://')) return path
    if (path.startsWith('/')) return `file://${encodeURI(path)}`
    return `file:///${path.replace(/\\/g, '/').replace(/^\/+/, '')}`
  }
  private prepareLocalBook = async (file: File, parsedMeta?: any) => {
    const originalFormat = this.getFormat(file.name)
    if (file.name.toLowerCase().endsWith('.txt')) file = await (await import('@/core/txt')).convertTxtFile(file)
    const format = originalFormat
    const name = file.name.replace(/\.[^.]+$/, '')
    const meta = parsedMeta || await this.extractMeta(file, format, name)
    const title = normalizeBookTitle(meta.title || name) || name
    return { file, format, name, meta, title }
  }
  private downloadCover = async (coverUrl: string | undefined, url: string) => {
    if (!coverUrl) return '';
    try {
      const { httpSourceManager } = await import('@/utils/HttpSources');
      const blob = await httpSourceManager.downloadCover(coverUrl);
      return blob ? await this.saveManagedCoverFile(blob, url) : '';
    } catch { return ''; }
  };
  private buildBookPayload = (info: any) => ({
    url: info.url,
    title: normalizeBookTitle(info.title || '未知') || '未知',
    author: info.author || '未知',
    cover: info.cover || '',
    format: info.format || 'epub',
    path: info.path || '',
    size: info.size || 0,
    added: info.added,
    read: info.read,
    finished: info.finished,
    status: info.status || 'unread',
    progress: info.progress || 0,
    time: info.time || 0,
    chapter: info.chapter || 0,
    total: info.total || 0,
    pos: info.location || info.pos || {},
    source: info.source || {},
    rating: info.rating || 0,
    meta: info.metadata || info.meta || {},
    tags: info.tags || [],
    groups: info.groups || [],
    bindDocId: info.bindDocId || '',
    bindDocName: info.bindDocName || '',
    autoSync: info.autoSync || false,
    syncDelete: info.syncDelete || false,
  });
  
  async init() { if (this.ready) return; await getDatabase(); this.ready = true; }
  async getBooks() { return this.useDb(db => db.getBooks()); }
  async getBook(url: string) { return this.useDb(db => db.getBook(url)); }
  async getSetting<T = any>(key: string, fallback?: T) {
    const value = await this.useDb(db => db.getSetting<T>(key));
    return (value ?? fallback) as T;
  }
  async saveSetting(key: string, value: any) {
    await this.useDb(db => db.saveSetting(key, value));
  }
  async flush() {
    await this.useDb(db => db.cleanup());
  }
  async recordReading(bookUrl: string, duration: number) {
    if (!bookUrl || duration <= 0) return;
    await this.useDb(db => db.saveDailyReading(bookUrl, duration));
    await this.mutateBook(bookUrl, book => ({ time: (book.time || 0) + duration, read: Date.now() }), false, false);
  }
  hasBook = async (url: string) => !!(await this.getBook(url))
  
  async addBook(info: any) {
    if (!info.url) throw new Error('URL required');
    if (await this.useDb(db => db.getBook(info.url))) throw new Error('已存在');
    const now = Date.now();
    await this.saveBookData(this.buildBookPayload({ ...info, added: now, read: now, finished: 0 }));
  }

  async updateBook(url: string, updates: any) { 
    return this.mutateBook(url, () => updates); 
  }
  async removeBook(url: string) { 
    return this.withBook(url, async book => {
      await this.useDb(db => db.deleteBook(url));
      await Promise.all([removeManagedFile(book.path), removeManagedFile(book.cover)]);
      this.notify();
      return true;
    }, false); 
  }
  
  removeBooks = async (urls: string[]) => this.batch(urls, url => this.removeBook(url));
  
  async filterBooks(opt: FilterOptions = {}) {
    const { query, groups, ...dbOpt } = opt;
    let books = await this.useDb(db => db.filterBooks(dbOpt));
    if (query) { const q = query.toLowerCase(); books = books.filter(b => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)); }
    if (groups?.length) books = books.filter(b => groups.some((g: string) => b.groups?.includes(g)));
    return books;
  }
  
  async getStats(): Promise<BookStats> { 
    const dbStats = await this.useDb(db => db.getStats());
    return { total: (await this.getBooks()).length, ...dbStats };
  }
  async getTodayReading() {
    return this.useDb(db => db.getTodayReading());
  }
  async getDailyReading(year: number, month?: number) {
    return this.useDb(db => db.getDailyReading(year, month));
  }
  
  // ===== 进度管理 =====
  private progressTimer: any = null
  // 更新阅读进度
  async updateProgress(url:string,progress:number,chapter?:number,cfi?:string){
    const b=await this.getBook(url);if(!b)return false
    const p=Math.max(0,Math.min(100,progress)),now=Date.now()
    // 状态逻辑：手动标注为finished后不再自动更新状态
    const s=b.status==='finished'?'finished':p>0&&p<100?'reading':p===100?'finished':'unread'
    return this.updateBook(url,{progress:p,status:s,read:now,pos:{...b.pos,chapter:chapter??b.pos.chapter,timestamp:now,cfi},...(chapter!==undefined&&{chapter}),...(p===100&&{finished:now})})
  }
  
  // 自动更新进度（防抖）
  async updateProgressAuto(url:string,reader?:any,pdfViewer?:any,view?:any){
    clearTimeout(this.progressTimer)
    this.progressTimer=setTimeout(async()=>{
      try{
        if(pdfViewer){const p=pdfViewer.getCurrentPage()||1,t=pdfViewer.getPageCount()||1;return this.updateProgress(url,Math.round(p/t*100),p,`#page-${p}`)}
        const loc=reader?.getLocation?.()??view?.lastLocation;if(!loc)return
        const{getCurrentChapter}=await import('@/core/online'),ch=getCurrentChapter(reader)
        if(ch!==undefined){const b=await this.getBook(url);return this.updateProgress(url,b?.total?Math.round((ch+1)/b.total*100):0,ch,loc.cfi)}
        loc.fraction!==undefined&&this.updateProgress(url,Math.round(loc.fraction*100),loc.index,loc.cfi)
      }catch{}
    },2000)
  }
  
  // 恢复阅读进度
  async restoreProgress(url:string,reader?:any,pdfViewer?:any,view?:any){
    try{
      const b=await this.getBook(url);if(!b?.pos&&!b?.chapter)return
      if(pdfViewer){
        const p=b.chapter||0,t=pdfViewer.getPageCount()
        if(p>=1&&p<=t)return pdfViewer.goToPage(p)
        const cfi=b.pos?.cfi;if(cfi?.startsWith('#page-')){const pg=parseInt(cfi.slice(6));pg>=1&&pg<=t&&pdfViewer.goToPage(pg)}
      }else{
        const tgt=reader||view,loc=b.pos?.cfi||b.chapter;if(!tgt||!loc)return
        await new Promise(r=>setTimeout(r,300))
        try{await tgt.goTo(loc)}catch{b.chapter&&tgt.goTo(b.chapter).catch(()=>{})}
      }
    }catch{}
  }
  
  // 清理资源
  cleanup(){clearTimeout(this.progressTimer)}
  
  updateRating=async(url:string,rating:number)=>this.updateBook(url,{rating:rating?Math.max(1,Math.min(5,rating)):undefined}); // 更新评分(1-5星)
  updateStatus=async(url:string,status:BookStatus)=>this.updateBook(url,{status,...(status==='finished'&&{finished:Date.now(),progress:100})}); // 更新状态(未读/在读/已读)
  updateReadTime=async(url:string,seconds:number)=>this.mutateBook(url,book=>({time:(book.time||0)+seconds}),false,false); // 累加阅读时长
  
  // ===== 标签管理 =====
  manageTags = async (url: string, action: 'add' | 'remove' | 'set', data: string | string[]) => {
    return this.mutateBook(url, book => {
      const tags = book.tags || [];
      if (action === 'set') return { tags: data as string[] };
      if (action === 'add') return tags.includes(data as string) ? null : { tags: [...tags, data as string] };
      return { tags: tags.filter((t: string) => t !== data) };
    });
  };
  
  getAllTags = async () => this.useDb(db => db.getAllTags());
  
  // ===== 分组管理 =====
  getGroups = async () => this.useDb(db => db.getGroups());
  saveGroups = async (groups: GroupConfig[]) => { await this.useDb(db => db.saveGroups(groups)); this.notify() };
  createGroup = async (name: string, type: 'folder' | 'smart' = 'folder', icon?: string) => { 
    const groups = await this.getGroups(); 
    const newGroup: GroupConfig = { id: 'group_' + Date.now(), name, icon: icon || (type === 'folder' ? '📁' : '⚡'), order: groups.length, type }; 
    await this.saveGroups([...groups, newGroup]); 
    return newGroup; 
  };
  
  deleteGroup = async (gid: string) => { 
    await this.useDb(db => db.deleteGroup(gid));
    this.notify();
    return true;
  };
  
  manageGroup = async (url: string, gid: string, action: 'add' | 'remove') => {
    return this.mutateBook(url, book => {
      const groups = book.groups || [];
      if (action === 'add') return groups.includes(gid) ? null : { groups: [...groups, gid] };
      return { groups: groups.filter((group: string) => group !== gid) };
    });
  };
  
  addBooksToGroup = async (urls: string[], gid: string) => this.batch(urls, url => this.manageGroup(url, gid, 'add'));
  
  getGroupCount = async (gid: string, groups?: GroupConfig[]) => {
    const allGroups = groups || await this.getGroups();
    const group = allGroups.find(g => g.id === gid);
    if (!group) return 0;
    if (group.type === 'smart') return (await this.getGroupBooks(gid)).length;
    return this.useDb(db => db.getGroupCount(gid));
  };
  getGroupPreviewBooks = async (gid: string, limit = 4, groups?: GroupConfig[]) => {
    const allGroups = groups || await this.getGroups();
    const group = allGroups.find(g => g.id === gid);
    if (!group) return [];
    if (group.type === 'smart') return (await this.getGroupBooks(gid)).slice(0, limit);
    return this.useDb(db => db.getGroupPreviewBooks(gid, limit));
  };
  getGroupBooks = async (gid: string) => { 
    const group = (await this.getGroups()).find(g => g.id === gid); 
    if (!group) return []; 
    const books = await this.getBooks(); 
    if (group.type === 'folder') return books.filter(b => b.groups?.includes(gid)); 
    if (group.type === 'smart' && group.rules) { 
      const { tags = [], format = [], status = [], rating = 0 } = group.rules; 
      return books.filter(b => 
        (!tags.length || tags.some(t => b.tags?.includes(t))) && 
        (!format.length || format.includes(b.format)) && 
        (!status.length || status.includes(b.status)) && 
        (!rating || (b.rating || 0) >= rating)
      ); 
    } 
    return []; 
  };
  
  // 批量操作
  private batch = async <T>(items: T[], op: (item: T) => Promise<boolean>) => { 
    const results = await Promise.allSettled(items.map(op)), success = results.filter(r => r.status === 'fulfilled' && r.value).length; 
    return { success, failed: items.length - success }; 
  };
  
  batchUpdateRating=async(urls:string[],rating:number)=>this.batch(urls,url=>this.updateRating(url,rating));
  batchUpdateStatus=async(urls:string[],status:BookStatus)=>this.batch(urls,url=>this.updateStatus(url,status));
  
  // ===== Assets PDF 同步 =====
  async syncAssetsPDF() {
    await this.init()
    const GID='assets-pdf',gs=await this.getGroups()
    if(!gs.find(g=>g.id===GID))await this.saveGroups([...gs,{id:GID,name:'Assets PDF',order:gs.length,type:'folder'}])
    const files = await readDirEntries('/data/assets')
    const assets=new Set(files.filter((f:any)=>!f.isDir&&f.name.endsWith('.pdf')).map((f:any)=>`asset://assets/${f.name}`)),all=new Set((await this.getBooks()).map(b=>b.url)),grp=new Set((await this.getGroupBooks(GID)).map(b=>b.url))
    let add=0,del=0
    for(const u of assets){if(all.has(u)){grp.has(u)||await this.manageGroup(u,GID,'add');continue}try{const n=u.split('/').pop()!;await this.addAssetBook(`assets/${n}`,new File([await(await fetch(`/assets/${n}`)).blob()],n,{type:'application/pdf'}));await this.manageGroup(u,GID,'add');add++}catch(e){console.error('[同步]',u,e)}}
    for(const b of await this.getGroupBooks(GID))assets.has(b.url)||await this.removeBook(b.url)&&del++
    this.notify()
    return{added:add,removed:del,total:assets.size}
  }
  
  private notify = () => typeof window !== 'undefined' && window.dispatchEvent(new Event('sireader:bookshelf-updated'));
  
  // ===== UI辅助 =====
  getBookColor(title: string) {
    const colors = ['#fef3c7', '#dbeafe', '#fce7f3', '#e0e7ff', '#d1fae5', '#fed7aa', '#fae8ff', '#f3e8ff', '#fecaca', '#fbcfe8'];
    let hash = 0;
    for (let i = 0; i < title.length; i++) hash = title.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }
  
  getCoverUrl(book: any) {
    if (!book.cover) return '';
    if (book.cover.startsWith('/assets/') || /^https?:\/\//.test(book.cover)) return book.cover;
    if (book.cover.startsWith('/public/siyuan-sireader/')) {
      if (!(book.cover in this.coverCache)) this.loadCover(book.cover);
      return this.coverCache[book.cover] || '';
    }
    if (book.cover.startsWith('/public/')) return book.cover;
    if (book.cover.startsWith('/data/')) {
      if (!(book.cover in this.coverCache)) this.loadCover(book.cover);
      return this.coverCache[book.cover] || '';
    }
    return book.cover;
  }
  
  private async loadCover(path: string) {
    try {
      const blob = await readFileBlob(path);
      if (!blob) throw new Error();
      this.coverCache[path] = URL.createObjectURL(blob);
    } catch {
      this.coverCache[path] = null;
    }
  }
  
  // ===== 书籍操作 =====
  async moveBookToGroup(url: string, targetGroupId: string | null) {
    return this.updateBook(url, { groups: targetGroupId ? [targetGroupId] : [] })
  }
  
  async updateBookInfo(url: string, formData: { title: string; author: string; tags: string; rating: number; status: BookStatus; cover: string; groups: string[]; bindDocId?: string; bindDocName?: string; autoSync?: boolean; syncDelete?: boolean }) {
    const book = await this.getBook(url)
    if (!book || !formData.title.trim()) return { success: false, error: '书名不能为空' }
    const tags = formData.tags.split(/[,，]/).map(t => t.trim()).filter(t => t)
    await this.updateBook(url, { title: formData.title.trim(), author: formData.author.trim(), tags, rating: formData.rating || undefined, status: formData.status, cover: formData.cover.trim() || '', groups: formData.groups, bindDocId: formData.bindDocId || '', bindDocName: formData.bindDocName || '', autoSync: formData.autoSync || false, syncDelete: formData.syncDelete || false })
    return { success: true }
  }
  
  async uploadBooks(files: File[]) {
    const r={success:0,failed:0}
    for(const f of files){try{await this.addLocalBook(f);r.success++}catch{r.failed++}}
    return r
  }
  
  async addLocalBook(file: File, parsedMeta?: any) {
    await this.init()
    const { file: source, format, meta, title } = await this.prepareLocalBook(file, parsedMeta)
    const url=`${format}://${source.name.replace(/\.[^.]+$/,'')}_${source.size}`
    const [path, cover] = await Promise.all([this.saveManagedBookFile(source, url), this.saveCoverBlob(meta.coverBlob, url)])
    await this.addBook({ url, title, author: meta.author || '未知作者', cover, format, path, size: source.size, metadata: this.buildMetadata(meta) })
  }

  async addLocalLinkBook(file: File, parsedMeta?: any) {
    await this.init()
    const localPath = (file as any)?.path || (file as any)?._path || ''
    if (!localPath) throw new Error('本地文件链接不可用')
    const { file: source, format, meta, title } = await this.prepareLocalBook(file, parsedMeta)
    const url=this.toFileUrl(localPath)
    const cover = await this.saveCoverBlob(meta.coverBlob, url)
    await this.addBook({ url, title, author: meta.author || '未知作者', cover, format, path: url, size: source.size, metadata: this.buildMetadata(meta) })
  }
  
  async addUrlBook(url: string, coverUrl?: string, bookInfo?: { title?: string; author?: string }, parsedMeta?: any) {
    await this.init()
    
    // HTTP书源快速通道：跳过文件下载和元数据提取
    if (bookInfo?.title) {
      const format = this.getFormat(url)
      const cover = await this.downloadCover(coverUrl, url)
      const file = await this.loadFile(url)
      const path = await this.saveManagedBookFile(file, url)
      await this.addBook({ url, title: normalizeBookTitle(bookInfo.title) || bookInfo.title, author: bookInfo.author || '未知作者', cover, format, path, size: file.size, metadata: {} })
      return
    }
    
    // 常规路径：需要下载文件提取元数据
    const { filePath, name, format, meta } = parsedMeta ? { filePath: url, name: parsedMeta.title || url.split(/[/\\]/).pop()?.split('?')[0]?.replace(/\.[^.]+$/, '') || '未知书籍', format: this.getFormat(url), meta: parsedMeta } : await this.parseUrlBook(url)
    const file = await this.loadFile(filePath)
    const title = normalizeBookTitle(meta.title || name) || name
    const path = await this.saveManagedBookFile(file, filePath)
    let cover = await this.downloadCover(coverUrl, filePath)
    if (!cover) cover = await this.saveCoverBlob(meta.coverBlob, filePath)
    await this.addBook({ url: filePath, title, author: meta.author || '未知作者', cover, format, path, size: file.size, metadata: this.buildMetadata(meta) })
  }
  
  async previewUrlBook(url: string) {
    const { meta, format } = await this.parseUrlBook(url)
    return { ...meta, format, cover: meta.coverBlob ? URL.createObjectURL(meta.coverBlob) : '' }
  }

  async previewLocalBook(file: File) {
    await this.init()
    const originalFormat = this.getFormat(file.name)
    if (file.name.toLowerCase().endsWith('.txt')) file = await (await import('@/core/txt')).convertTxtFile(file)
    const format = originalFormat
    const name = file.name.replace(/\.[^.]+$/, '')
    const meta = await this.extractMeta(file, format, name)
    return { ...meta, format, title: normalizeBookTitle(meta.title || name) || name, cover: meta.coverBlob ? URL.createObjectURL(meta.coverBlob) : '' }
  }
  
  private async parseUrlBook(url: string) {
    const isHttp = /^https?:\/\//.test(url), isAbsolute = /^[a-zA-Z]:[\\\/]/.test(url) || url.startsWith('/')
    if (!isHttp && !isAbsolute && !url.includes('/') && !url.includes('\\')) throw new Error('请输入有效的链接或文件路径')
    
    const filePath = isAbsolute && !url.startsWith('file://') ? `file://${url.replace(/\\/g, '/')}` : url
    const name = url.split(/[/\\]/).pop()?.split('?')[0]?.replace(/\.[^.]+$/, '') || '未知书籍', format = this.getFormat(url)
    const meta = await this.extractMeta(await this.loadFile(filePath), format, name)
    
    return { filePath, name, format, meta }
  }
  
  async addAssetBook(assetPath: string, file: File) {
    await this.init()
    const format = this.getFormat(file.name), name = file.name.replace(/\.[^.]+$/, ''), url = `asset://${assetPath}`, meta = await this.extractMeta(file, format, name)
    const title = normalizeBookTitle(meta.title || name) || name
    await this.addBook({ url, title, author: meta.author || '未知作者', cover: await this.saveCoverBlob(meta.coverBlob, url), format, path: assetPath, metadata: this.buildMetadata(meta) })
  }
  
  // 统一文件加载方法（用于添加书籍和阅读器）
  async loadFile(path: string): Promise<File> {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      const res = await fetch(path)
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      return new File([await res.arrayBuffer()], path.split('/').pop()?.split('?')[0] || 'book', { type: res.headers.get('content-type') || 'application/octet-stream' })
    }
    if (path.startsWith('file://')) {
      const filePath = decodeURI(path.substring(7)).replace(/^\/([a-zA-Z]:[\\/])/, '$1')
      if (typeof window !== 'undefined' && (window as any).require) {
        const fs = (window as any).require('fs'), buffer = fs.readFileSync(filePath)
        return new File([buffer], filePath.split(/[/\\]/).pop() || 'book')
      }
      throw new Error('本地文件仅支持桌面端')
    }
    const publicPath = path.startsWith('/assets/') || path.startsWith('/public/')
      ? path
      : path.startsWith('assets/') || path.startsWith('public/')
        ? `/${path}`
        : ''
    if (publicPath) {
      if (publicPath.startsWith('/public/siyuan-sireader/')) {
        const file = await readManagedFile(publicPath, path.split(/[/\\]/).pop() || 'book')
        if (!file) throw new Error('文件加载失败')
        return file
      }
      const res = await fetch(publicPath)
      if (!res.ok) throw new Error('文件加载失败')
      return new File([await res.arrayBuffer()], path.split(/[/\\]/).pop() || 'book', { type: res.headers.get('content-type') || 'application/octet-stream' })
    }
    const blob = await readFileBlob(path)
    if (!blob) throw new Error('文件加载失败')
    return new File([blob], path.split(/[/\\]/).pop() || 'book', { type: blob.type || 'application/octet-stream' })
  }
  
  private buildMetadata = (meta: any) => ({ publisher: meta.publisher, publishDate: meta.published, language: meta.language, isbn: meta.identifier, description: meta.intro, series: meta.series })
  private getFormat = (path: string): BookFormat => { const ext = path.split('.').pop()?.toLowerCase() || ''; return ({ epub: 'epub', pdf: 'pdf', mobi: 'mobi', azw3: 'azw3', azw: 'azw3', txt: 'txt' } as Record<string, BookFormat>)[ext] || 'epub' }
  private async extractMeta(file: File, format: BookFormat, defaultName: string) {
    const def = { title: defaultName, author: '未知作者', publisher: undefined, published: undefined, language: undefined, identifier: undefined, intro: undefined, subjects: [], series: undefined, coverBlob: undefined, subtitle: undefined }
    if (!['epub', 'mobi', 'azw3', 'txt'].includes(format)) return def
    try {
      const view = document.createElement('foliate-view') as any
      await Promise.race([view.open(file), new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))])
      const { metadata = {} } = view.book || {}
      const norm = (v: any) => typeof v === 'string' ? v : (v?.['zh-CN'] || v?.['zh'] || v?.['en'] || Object.values(v || {})[0] || '')
      const arr = (v: any) => v ? (Array.isArray(v) ? v : [v]) : []
      const contrib = (v: any) => arr(v).map((c: any) => typeof c === 'string' ? c : norm(c?.name)).filter(Boolean).join(', ') || undefined
      const coverBlob = (format === 'epub' || format === 'txt') ? await this.extractCover(file).catch(() => undefined) : undefined
      view.remove()
      return {
        title: normalizeBookTitle(norm(metadata.title) || defaultName) || defaultName, subtitle: norm(metadata.subtitle), author: contrib(metadata.author) || '未知作者',
        publisher: contrib(metadata.publisher), published: metadata.published instanceof Date ? metadata.published.toISOString().split('T')[0] : metadata.published ? String(metadata.published) : undefined,
        language: arr(metadata.language)[0], identifier: arr(metadata.identifier)[0], intro: metadata.description,
        subjects: arr(metadata.subject).map((s: any) => typeof s === 'string' ? s : norm(s?.name)).filter(Boolean),
        series: Array.isArray(metadata.belongsTo) ? metadata.belongsTo[0] : metadata.belongsTo, coverBlob
      }
    } catch { return def }
  }
  
  private async extractCover(file: File): Promise<Blob | undefined> {
    try {
      const JSZip = (await import('jszip')).default, zip = await JSZip.loadAsync(file), container = await zip.file('META-INF/container.xml')?.async('text'), opfPath = container?.match(/full-path="([^"]+)"/)?.[1];
      if (!opfPath) return;
      const opf = await zip.file(opfPath)?.async('text');
      if (!opf) return;
      const base = opfPath.replace(/[^/]+$/, ''), norm = (h: string) => (base + h).replace(/\/+/g, '/'), getBlob = async (h: string) => {
        return await zip.file(norm(h))?.async('blob')
      };
      let href = opf.match(/<item[^>]+properties="cover-image"[^>]+href="([^"]+)"/)?.[1] || opf.match(/<item[^>]+href="([^"]+)"[^>]+properties="cover-image"/)?.[1];
      if (href) return await getBlob(href);
      const item = opf.match(/<item[^>]+id="cover(-image)?"[^>]+href="([^"]+)"/i)?.[2];
      if (item) {
        if (/\.(xhtml|html)$/i.test(item)) {
          const html = await zip.file(norm(item))?.async('text')
          const img = html?.match(/<(?:img|image)[^>]+(?:src|(?:xlink:)?href)="([^"]+)"/i)?.[1]
          const bg = html?.match(/background(?:-image)?:\s*url\((['"]?)([^'")]+)\1\)/i)?.[2]
          const inlineSvg = html?.match(/<(?:image)[^>]+(?:xlink:href|href)=["']([^"']+)["']/i)?.[1]
          const coverRef = img || bg || inlineSvg
          if (coverRef) return await getBlob((item.replace(/[^/]+$/, '') + coverRef).replace(/^\.?\//, ''))
        }
        return await getBlob(item)
      }
      const id = opf.match(/<meta\s+name="cover"\s+content="([^"]+)"/i)?.[1];
      if (id && (href = opf.match(new RegExp(`<item[^>]+id="${id}"[^>]+href="([^"]+)"`, 'i'))?.[1])) return await getBlob(href);
      if (href = opf.match(/<item[^>]+href="([^"]+\.(?:jpg|jpeg|png|gif))"/i)?.[1]) return await getBlob(href);
      for (const n of ['cover.jpg', 'cover.jpeg', 'cover.png']) for (const p of [n, 'Images/' + n, 'images/' + n]) if (zip.file(norm(p))) return await getBlob(p);
    } catch {}
  }
}

export const bookshelfManager = new BookshelfManager();
export type { Book } from './database';

