/**
 * 阅读器数据库 - 极简架构
 * SQL.js + 文件持久化
 */
import initSqlJs from 'sql.js';

const DB_PATH = '/data/storage/petal/siyuan-sireader/reader.db';

// ==================== 类型 ====================

export interface Book {
  url: string;        // 唯一标识
  title: string;      // 书名
  author: string;     // 作者
  cover: string;      // 封面URL
  format: string;     // 格式(epub/pdf/mobi/azw3)
  path: string;       // 文件路径
  size: number;       // 文件大小(字节)
  added: number;      // 添加时间戳
  read: number;       // 最后阅读时间戳
  finished: number;   // 完成时间戳(0=未完成)
  status: string;     // 状态(unread/reading/finished)
  progress: number;   // 进度(0-100)
  time: number;       // 阅读时长(秒)
  chapter: number;    // 当前章节
  total: number;      // 总章节数
  pos: any;           // 位置(JSON)
  source: any;        // 书源(JSON)
  rating: number;     // 评分(0-5)
  meta: any;          // 元数据(JSON)
  tags: string[];     // 标签数组
  groups: string[];   // 分组数组
  bindDocId?: string; // 绑定文档ID
  bindDocName?: string; // 绑定文档名
  autoSync?: boolean; // 添加时同步
  syncDelete?: boolean; // 删除时同步
}

export type AnnotationType = 'highlight' | 'note' | 'bookmark' | 'vocab' | 'shape' | 'ink' | 'daily_reading';

export interface Annotation {
  id: string;         // 唯一ID
  book: string;       // 书籍URL
  type: AnnotationType; // 类型
  loc: string;        // 位置
  text: string;       // 标注文本
  note: string;       // 笔记内容
  color: string;      // 颜色
  data: any;          // 扩展数据(JSON) - 存储格式特定字段
  created: number;    // 创建时间戳
  updated: number;    // 更新时间戳
  chapter: string;    // 章节名
  block: string;      // 思源块ID
  
  // 便捷访问器（从 data 中读取）
  format?: 'pdf' | 'epub';
  page?: number;      // PDF 页码
  cfi?: string;       // EPUB CFI
  section?: number;   // 章节索引（在线书籍）
  rects?: any[];      // PDF 矩形区域
  style?: string;     // 标注样式
  shapeType?: string; // 形状类型
  filled?: boolean;   // 是否填充
  paths?: any[];      // 墨迹路径
  
  // 每日阅读统计（type='daily_reading'时使用）
  date?: string;      // 日期 YYYY-MM-DD
  duration?: number;  // 阅读时长（秒）
}

// ==================== 数据库 ====================

let sqlJs: any;
const getSql = async () => sqlJs || (sqlJs = await initSqlJs({ locateFile: f => `/plugins/siyuan-sireader/sql.js/sql-wasm.wasm` }));

export class ReaderDatabase {
  private db: any;
  private ready = false;
  private saveLock = false;
  private saveQueue: (() => Promise<void>)[] = [];
  private operationQueue: Array<() => Promise<any>> = [];
  private isProcessingQueue = false;
  private bookCache = new Map<string, Book>();
  private saveTimeout: NodeJS.Timeout | null = null;
  private pendingSaves = false;

  async init() {
    if (this.ready) return;
    this.db = await this.load(await getSql());
    this.ready = true;
  }

  private async load(SQL: any) {
    try {
      const res = await fetch('/api/file/getFile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: DB_PATH }) });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        // 验证 SQLite 魔数文件头 "SQLite format 3\0"
        if (buf.byteLength >= 16) {
          const header = new Uint8Array(buf, 0, 16);
          const magic = String.fromCharCode(...header.slice(0, 15));
          if (magic === 'SQLite format 3' && header[15] === 0) {
            return new SQL.Database(new Uint8Array(buf));
          }
        }
      }
    } catch {}
    // 创建新的空数据库
    const db = new SQL.Database();
    db.exec(`CREATE TABLE books (url TEXT PRIMARY KEY, title TEXT, author TEXT, cover TEXT, format TEXT, path TEXT, size INT, added INT, read INT, finished INT, status TEXT, progress INT, time INT, chapter INT, total INT, pos TEXT, source TEXT, rating INT, meta TEXT, bindDocId TEXT, bindDocName TEXT, autoSync INT, syncDelete INT);CREATE INDEX idx_read ON books(read);CREATE TABLE annotations (id TEXT PRIMARY KEY, book TEXT, type TEXT, loc TEXT, text TEXT, note TEXT, color TEXT, data TEXT, created INT, updated INT, chapter TEXT, block TEXT);CREATE INDEX idx_ann_book ON annotations(book);CREATE TABLE tags (book TEXT, tag TEXT, PRIMARY KEY(book,tag));CREATE INDEX idx_tag ON tags(tag);CREATE TABLE groups (book TEXT, gid TEXT, PRIMARY KEY(book,gid));CREATE INDEX idx_group ON groups(gid);CREATE TABLE settings (key TEXT PRIMARY KEY, val TEXT);`);
    return db;
  }

  private async save() {
    this.scheduleSave();
  }

  private async processQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;
    
    try {
      while (this.operationQueue.length > 0) {
        const operation = this.operationQueue.shift();
        if (operation) {
          await operation();
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private async queueOperation<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.operationQueue.push(async () => {
        try {
          const result = await operation();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.processQueue();
    });
  }

  private monitorMemory() {
    if (this.db && (this.db as any).memory) {
      const memory = (this.db as any).memory;
      const used = memory.buffer.byteLength;
      console.log(`SQL.js memory usage: ${(used / 1024 / 1024).toFixed(2)} MB`);
      
      if (used > 50 * 1024 * 1024) {
        console.warn('High memory usage detected, clearing cache');
        this.bookCache.clear();
      }
    }
  }

  private async scheduleSave() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.pendingSaves = true;
    this.saveTimeout = setTimeout(async () => {
      if (this.pendingSaves) {
        await this.performSave();
        this.pendingSaves = false;
      }
    }, 1000);
  }

  private async performSave() {
    this.saveLock = true;
    try {
      const data = this.db.export();
      if (data.byteLength > 10 * 1024 * 1024) {
        console.warn('Database size is large:', data.byteLength);
      }
      const form = new FormData();
      form.append('path', DB_PATH);
      form.append('file', new File([data], 'reader.db'));
      form.append('isDir', 'false');
      await fetch('/api/file/putFile', { method: 'POST', body: form });
    } catch (error) {
      console.error('Error saving database:', error);
    } finally {
      this.saveLock = false;
      if (this.saveQueue.length > 0) {
        const nextTask = this.saveQueue.shift();
        nextTask?.();
      }
    }
  }

  // ==================== 书籍 ====================

  async getBook(url: string) {
    try {
      // 先检查缓存
      if (this.bookCache.has(url)) {
        return this.bookCache.get(url)!;
      }
      
      return await this.queueOperation(async () => {
        await this.init();
        const r = this.db.exec('SELECT * FROM books WHERE url=?', [url]);
        if (!r[0]?.values[0]) return null;
        const b = this.toBook(r[0].values[0], r[0].columns);
        const tags = this.db.exec('SELECT tag FROM tags WHERE book=?', [url]);
        const groups = this.db.exec('SELECT gid FROM groups WHERE book=?', [url]);
        b.tags = tags[0] ? tags[0].values.map((v: any) => v[0]) : [];
        b.groups = groups[0] ? groups[0].values.map((v: any) => v[0]) : [];
        
        // 存入缓存
        this.bookCache.set(url, b);
        this.monitorMemory();
        return b;
      });
    } catch (error) {
      console.error('Error in getBook:', error);
      // 尝试恢复操作
      try {
        await this.init();
        return await this.getBook(url);
      } catch (retryError) {
        console.error('Retry failed:', retryError);
        return null;
      }
    }
  }

  async getBooks() {
    try {
      return await this.queueOperation(async () => {
        await this.init();
        
        // 检查内存使用
        this.monitorMemory();
        
        // 执行主查询
        const r = this.db.exec('SELECT * FROM books ORDER BY read DESC');
        if (!r[0]) return [];
        
        const books = [];
        const bookUrls = [];
        
        // 先收集所有书籍URL
        for (const row of r[0].values) {
          const b = this.toBook(row, r[0].columns);
          bookUrls.push(b.url);
          books.push(b);
        }
        
        // 批量查询标签和分组
        if (bookUrls.length > 0) {
          // 查询所有标签
          const tagsResult = this.db.exec(
            `SELECT book, tag FROM tags WHERE book IN (${bookUrls.map(() => '?').join(',')})`,
            bookUrls
          );
          
          // 查询所有分组
          const groupsResult = this.db.exec(
            `SELECT book, gid FROM groups WHERE book IN (${bookUrls.map(() => '?').join(',')})`,
            bookUrls
          );
          
          // 构建标签和分组映射
          const tagsMap = new Map<string, string[]>();
          const groupsMap = new Map<string, string[]>();
          
          if (tagsResult[0]) {
            tagsResult[0].values.forEach((row: any) => {
              const bookUrl = row[0];
              const tag = row[1];
              if (!tagsMap.has(bookUrl)) {
                tagsMap.set(bookUrl, []);
              }
              tagsMap.get(bookUrl)!.push(tag);
            });
          }
          
          if (groupsResult[0]) {
            groupsResult[0].values.forEach((row: any) => {
              const bookUrl = row[0];
              const gid = row[1];
              if (!groupsMap.has(bookUrl)) {
                groupsMap.set(bookUrl, []);
              }
              groupsMap.get(bookUrl)!.push(gid);
            });
          }
          
          // 为每本书添加标签和分组
          books.forEach(book => {
            book.tags = tagsMap.get(book.url) || [];
            book.groups = groupsMap.get(book.url) || [];
            // 存入缓存
            this.bookCache.set(book.url, book);
          });
        }
        
        this.monitorMemory();
        return books;
      });
    } catch (error) {
      console.error('Error in getBooks:', error);
      // 尝试清理缓存并重新初始化
      this.bookCache.clear();
      try {
        await this.init();
      } catch (initError) {
        console.error('Error reinitializing database:', initError);
      }
      return [];
    }
  }

  async saveBook(b: any) {
    try {
      await this.queueOperation(async () => {
        await this.init();
        
        // 验证必需参数
        if (!b.url || !b.title || !b.format) {
          console.error('Missing required book parameters:', b);
          return;
        }
        
        // 构建参数数组
        const p = [
          b.title, 
          b.author || '', 
          b.cover || '', 
          b.format, 
          b.path || '', 
          b.size || 0, 
          b.added || Date.now(), 
          b.read || Date.now(), 
          b.finished || 0, 
          b.status || 'unread', 
          b.progress || 0, 
          b.time || 0, 
          b.chapter || 0, 
          b.total || 0, 
          JSON.stringify(b.pos || {}), 
          JSON.stringify(b.source || {}), 
          b.rating || 0, 
          JSON.stringify(b.meta || {}), 
          b.bindDocId || '', 
          b.bindDocName || '', 
          b.autoSync ? 1 : 0, 
          b.syncDelete ? 1 : 0
        ];
        
        // 检查参数数量
        if (p.length !== 22) {
          console.error('Invalid parameter count:', p.length);
          return;
        }
        
        const r = this.db.exec('SELECT 1 FROM books WHERE url=?', [b.url]);
        
        if (r[0]?.values.length) {
          // 更新操作
          this.db.run(
            'UPDATE books SET title=?,author=?,cover=?,format=?,path=?,size=?,added=?,read=?,finished=?,status=?,progress=?,time=?,chapter=?,total=?,pos=?,source=?,rating=?,meta=?,bindDocId=?,bindDocName=?,autoSync=?,syncDelete=? WHERE url=?', 
            [...p, b.url]
          );
        } else {
          // 插入操作
          this.db.run(
            'INSERT INTO books VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', 
            [b.url, ...p]
          );
        }
        
        // 处理标签和分组
        this.db.run('DELETE FROM tags WHERE book=?', [b.url]);
        (b.tags || []).forEach((t: string) => this.db.run('INSERT INTO tags VALUES(?,?)', [b.url, t]));
        this.db.run('DELETE FROM groups WHERE book=?', [b.url]);
        (b.groups || []).forEach((g: string) => this.db.run('INSERT INTO groups VALUES(?,?)', [b.url, g]));
        
        await this.save();
        
        // 更新缓存
        const updatedBook = await this.getBook(b.url);
        if (updatedBook) {
          this.bookCache.set(b.url, updatedBook);
        }
        this.monitorMemory();
      });
    } catch (error) {
      console.error('Error in saveBook:', error);
    }
  }

  async deleteBook(url: string) { 
    try {
      await this.queueOperation(async () => {
        await this.init(); 
        this.db.run('DELETE FROM books WHERE url=?', [url]); 
        this.db.run('DELETE FROM annotations WHERE book=?', [url]);
        this.db.run('DELETE FROM tags WHERE book=?', [url]);
        this.db.run('DELETE FROM groups WHERE book=?', [url]);
        await this.save();
        
        // 从缓存中删除
        this.bookCache.delete(url);
        this.monitorMemory();
      });
    } catch (error) {
      console.error('Error in deleteBook:', error);
    }
  }

  async searchBooks(q: string) {
    try {
      return await this.queueOperation(async () => {
        await this.init();
        const r = this.db.exec('SELECT * FROM books WHERE title LIKE ? OR author LIKE ? ORDER BY read DESC', [`%${q}%`, `%${q}%`]);
        if (!r[0]) return [];
        const books = r[0].values.map((v: any) => {
          const b = this.toBook(v, r[0].columns);
          const tags = this.db.exec('SELECT tag FROM tags WHERE book=?', [b.url]);
          const groups = this.db.exec('SELECT gid FROM groups WHERE book=?', [b.url]);
          b.tags = tags[0] ? tags[0].values.map((v: any) => v[0]) : [];
          b.groups = groups[0] ? groups[0].values.map((v: any) => v[0]) : [];
          // 存入缓存
          this.bookCache.set(b.url, b);
          return b;
        });
        this.monitorMemory();
        return books;
      });
    } catch (error) {
      console.error('Error in searchBooks:', error);
      return [];
    }
  }

  // ==================== 标注 ====================

  async getAnnotations(book: string) {
    try {
      return await this.queueOperation(async () => {
        await this.init();
        const r = this.db.exec('SELECT * FROM annotations WHERE book=? ORDER BY created', [book]);
        const annotations = r[0] ? r[0].values.map((v: any) => this.toAnn(v, r[0].columns)) : [];
        this.monitorMemory();
        return annotations;
      });
    } catch (error) {
      console.error('Error in getAnnotations:', error);
      return [];
    }
  }

  async saveAnnotation(a: any) {
    try {
      await this.queueOperation(async () => {
        await this.init();
        const book = a.book;
        if (!book) throw new Error('book required');
        const r = this.db.exec('SELECT 1 FROM annotations WHERE id=?', [a.id]);
        const now = Date.now();
        const p = [book, a.type, a.loc||'', a.text||'', a.note||'', a.color, JSON.stringify(a.data||{}), a.created||now, now, a.chapter||'', a.block||''];
        r[0]?.values.length ? this.db.run('UPDATE annotations SET book=?,type=?,loc=?,text=?,note=?,color=?,data=?,created=?,updated=?,chapter=?,block=? WHERE id=?', [...p, a.id]) : this.db.run('INSERT INTO annotations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [a.id, ...p]);
        await this.save();
        this.monitorMemory();
      });
    } catch (error) {
      console.error('Error in saveAnnotation:', error);
    }
  }

  async deleteAnnotation(id: string) {
    try {
      await this.queueOperation(async () => {
        await this.init();
        this.db.run('DELETE FROM annotations WHERE id=?', [id]);
        await this.save();
        this.monitorMemory();
      });
    } catch (error) {
      console.error('Error in deleteAnnotation:', error);
    }
  }

  // ==================== 设置 ====================

  async getSetting<T = any>(key: string): Promise<T | null> {
    try {
      return await this.queueOperation(async () => {
        await this.init();
        const r = this.db.exec('SELECT val FROM settings WHERE key=?', [key]);
        if (!r[0]?.values[0]?.[0]) return null;
        try { return JSON.parse(r[0].values[0][0]); } catch { return r[0].values[0][0]; }
      });
    } catch (error) {
      console.error('Error in getSetting:', error);
      return null;
    }
  }

  async saveSetting(key: string, val: any) {
    try {
      await this.queueOperation(async () => {
        await this.init();
        const json = typeof val === 'string' ? val : JSON.stringify(val);
        const r = this.db.exec('SELECT 1 FROM settings WHERE key=?', [key]);
        r[0]?.values.length ? this.db.run('UPDATE settings SET val=? WHERE key=?', [json, key]) : this.db.run('INSERT INTO settings VALUES(?,?)', [key, json]);
        await this.save();
        this.monitorMemory();
      });
    } catch (error) {
      console.error('Error saving setting:', error);
    }
  }

  async batchSaveSettings(updates: Record<string, any>) {
    try {
      await this.queueOperation(async () => {
        await this.init();
        for (const [key, val] of Object.entries(updates)) {
          const json = typeof val === 'string' ? val : JSON.stringify(val);
          const r = this.db.exec('SELECT 1 FROM settings WHERE key=?', [key]);
          r[0]?.values.length ? this.db.run('UPDATE settings SET val=? WHERE key=?', [json, key]) : this.db.run('INSERT INTO settings VALUES(?,?)', [key, json]);
        }
        await this.save();
        this.monitorMemory();
      });
    } catch (error) {
      console.error('Error batch saving settings:', error);
    }
  }

  async getAllSettings() {
    try {
      return await this.queueOperation(async () => {
        await this.init();
        const r = this.db.exec('SELECT * FROM settings');
        if (!r[0]) return {};
        const s: Record<string, any> = {};
        r[0].values.forEach((v: any) => { try { s[v[0]] = JSON.parse(v[1]); } catch { s[v[0]] = v[1]; } });
        this.monitorMemory();
        return s;
      });
    } catch (error) {
      console.error('Error in getAllSettings:', error);
      return {};
    }
  }

  // ==================== 分组/标签 ====================

  async getGroups() { return await this.getSetting('book_groups') || []; }
  async saveGroups(g: any[]) { await this.saveSetting('book_groups', g); }
  async getBooksByGroup(gid: string) {
    try {
      return await this.queueOperation(async () => {
        await this.init();
        const r = this.db.exec('SELECT b.* FROM books b JOIN groups g ON b.url=g.book WHERE g.gid=?', [gid]);
        if (!r[0]) return [];
        const books = r[0].values.map((v: any) => {
          const b = this.toBook(v, r[0].columns);
          const tags = this.db.exec('SELECT tag FROM tags WHERE book=?', [b.url]);
          const groups = this.db.exec('SELECT gid FROM groups WHERE book=?', [b.url]);
          b.tags = tags[0] ? tags[0].values.map((v: any) => v[0]) : [];
          b.groups = groups[0] ? groups[0].values.map((v: any) => v[0]) : [];
          // 存入缓存
          this.bookCache.set(b.url, b);
          return b;
        });
        this.monitorMemory();
        return books;
      });
    } catch (error) {
      console.error('Error in getBooksByGroup:', error);
      return [];
    }
  }
  async getAllTags() {
    try {
      return await this.queueOperation(async () => {
        await this.init();
        const r = this.db.exec('SELECT tag, COUNT(*) as cnt FROM tags GROUP BY tag ORDER BY cnt DESC');
        const tags = r[0] ? r[0].values.map((v: any) => ({ tag: v[0], count: v[1] })) : [];
        this.monitorMemory();
        return tags;
      });
    } catch (error) {
      console.error('Error in getAllTags:', error);
      return [];
    }
  }

  // ==================== 高性能查询 ====================

  async filterBooks(opt: {
    status?: string[];
    rating?: number;
    formats?: string[];
    tags?: string[];
    hasUpdate?: boolean;
    sortBy?: string;
    reverse?: boolean;
  } = {}) {
    try {
      return await this.queueOperation(async () => {
        await this.init();
        let sql = 'SELECT DISTINCT b.* FROM books b';
        const params: any[] = [];
        const where: string[] = [];

        if (opt.tags?.length) {
          sql += ' JOIN tags t ON b.url = t.book';
          where.push(`t.tag IN (${opt.tags.map(() => '?').join(',')})`);
          params.push(...opt.tags);
        }
        if (opt.status?.length) {
          where.push(`b.status IN (${opt.status.map(() => '?').join(',')})`);
          params.push(...opt.status);
        }
        if (opt.rating) {
          where.push('b.rating >= ?');
          params.push(opt.rating);
        }
        if (opt.formats?.length) {
          where.push(`b.format IN (${opt.formats.map(() => '?').join(',')})`);
          params.push(...opt.formats);
        }
        if (opt.hasUpdate) {
          where.push("json_extract(b.source, '$.updateCount') > 0");
        }

        if (where.length) sql += ' WHERE ' + where.join(' AND ');

        const sortMap: Record<string, string> = {
          time: 'b.read', added: 'b.added', progress: 'b.progress',
          rating: 'b.rating', readTime: 'b.time', name: 'b.title',
          author: 'b.author', update: "json_extract(b.source, '$.updateCount')"
        };
        const col = sortMap[opt.sortBy || 'time'] || 'b.read';
        const dir = opt.reverse ? 'ASC' : 'DESC';
        sql += ` ORDER BY ${col} ${dir}`;

        const r = this.db.exec(sql, params);
        if (!r[0]) return [];
        const books = r[0].values.map((v: any) => {
          const b = this.toBook(v, r[0].columns);
          const tags = this.db.exec('SELECT tag FROM tags WHERE book=?', [b.url]);
          const groups = this.db.exec('SELECT gid FROM groups WHERE book=?', [b.url]);
          b.tags = tags[0] ? tags[0].values.map((v: any) => v[0]) : [];
          b.groups = groups[0] ? groups[0].values.map((v: any) => v[0]) : [];
          // 存入缓存
          this.bookCache.set(b.url, b);
          return b;
        });
        this.monitorMemory();
        return books;
      });
    } catch (error) {
      console.error('Error in filterBooks:', error);
      return [];
    }
  }

  async getStats() {
    try {
      return await this.queueOperation(async () => {
        await this.init();
        const statusR = this.db.exec('SELECT status, COUNT(*) as cnt FROM books GROUP BY status');
        const byStatus: Record<string, number> = { unread: 0, reading: 0, finished: 0 };
        statusR[0]?.values.forEach((v: any) => { byStatus[v[0]] = v[1]; });

        const formatR = this.db.exec('SELECT format, COUNT(*) as cnt FROM books GROUP BY format');
        const byFormat: Record<string, number> = { epub: 0, pdf: 0, mobi: 0, azw3: 0, online: 0 };
        formatR[0]?.values.forEach((v: any) => { byFormat[v[0]] = v[1]; });

        const updateR = this.db.exec("SELECT COUNT(*) FROM books WHERE json_extract(source, '$.updateCount') > 0");
        const withUpdate = updateR[0]?.values[0]?.[0] || 0;
        
        const annR = this.db.exec('SELECT COUNT(*) FROM annotations');
        const annotationCount = annR[0]?.values[0]?.[0] || 0;
        
        const ratingR = this.db.exec('SELECT rating, COUNT(*) as cnt FROM books WHERE rating > 0 GROUP BY rating ORDER BY rating DESC');
        const byRating: Record<number, number> = {};
        ratingR[0]?.values.forEach((v: any) => { byRating[v[0]] = v[1]; });

        this.monitorMemory();
        return { byStatus, byFormat, byRating, withUpdate, annotationCount };
      });
    } catch (error) {
      console.error('Error in getStats:', error);
      return { byStatus: { unread: 0, reading: 0, finished: 0 }, byFormat: { epub: 0, pdf: 0, mobi: 0, azw3: 0, online: 0 }, byRating: {}, withUpdate: 0, annotationCount: 0 };
    }
  }

  // ==================== 每日阅读 ====================

  async getTodayReading() {
    try {
      return await this.queueOperation(async () => {
        await this.init();
        const today = new Date().toISOString().split('T')[0];
        const r = this.db.exec(`SELECT SUM(json_extract(data,'$.duration')) FROM annotations WHERE type='daily_reading' AND json_extract(data,'$.date')=?`, [today]);
        const result = r[0]?.values[0]?.[0] || 0;
        this.monitorMemory();
        return result;
      });
    } catch (error) {
      console.error('Error in getTodayReading:', error);
      return 0;
    }
  }

  async getDailyReading(year: number, month?: number) {
    try {
      return await this.queueOperation(async () => {
        await this.init();
        const prefix = month ? `${year}-${String(month).padStart(2, '0')}` : `${year}`;
        const r = this.db.exec(`SELECT book,json_extract(data,'$.date') d,json_extract(data,'$.duration') t FROM annotations WHERE type='daily_reading' AND d LIKE ? ORDER BY d,t DESC`, [`${prefix}%`]);
        const daily: Record<string, { total: number; books: Array<{ url: string; duration: number }> }> = {};
        r[0]?.values.forEach((v: any) => {
          const date = v[1];
          if (!daily[date]) daily[date] = { total: 0, books: [] };
          daily[date].total += v[2];
          daily[date].books.push({ url: v[0], duration: v[2] });
        });
        this.monitorMemory();
        return daily;
      });
    } catch (error) {
      console.error('Error in getDailyReading:', error);
      return {};
    }
  }

  async saveDailyReading(bookUrl: string, duration: number) {
    if (!bookUrl || duration <= 0) return;
    try {
      await this.queueOperation(async () => {
        await this.init();
        const date = new Date().toISOString().split('T')[0];
        const id = `${bookUrl}_${date}`;
        const r = this.db.exec('SELECT json_extract(data,"$.duration") FROM annotations WHERE id=?', [id]);
        const now = Date.now();
        const newDuration = (r[0]?.values[0]?.[0] || 0) + duration;
        const data = JSON.stringify({ date, duration: newDuration });
        
        r[0]?.values[0] 
          ? this.db.run('UPDATE annotations SET data=?,updated=? WHERE id=?', [data, now, id])
          : this.db.run('INSERT INTO annotations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [id, bookUrl, 'daily_reading', '', '', '', '', data, now, now, '', '']);
        
        await this.save();
        this.monitorMemory();
      });
    } catch (error) {
      console.error('Error in saveDailyReading:', error);
    }
  }

  async getGroupCount(gid: string) {
    try {
      return await this.queueOperation(async () => {
        await this.init();
        const r = this.db.exec('SELECT COUNT(*) FROM groups WHERE gid = ?', [gid]);
        const result = r[0]?.values[0]?.[0] || 0;
        this.monitorMemory();
        return result;
      });
    } catch (error) {
      console.error('Error in getGroupCount:', error);
      return 0;
    }
  }

  async deleteGroup(gid: string) {
    try {
      await this.queueOperation(async () => {
        await this.init();
        this.db.run('DELETE FROM groups WHERE gid = ?', [gid]);
        const configs = await this.getGroups();
        await this.saveGroups(configs.filter(g => g.id !== gid));
        await this.save();
        this.monitorMemory();
      });
    } catch (error) {
      console.error('Error in deleteGroup:', error);
    }
  }

  async getGroupPreviewBooks(gid: string, limit = 4) {
    try {
      return await this.queueOperation(async () => {
        await this.init();
        const r = this.db.exec('SELECT b.* FROM books b JOIN groups g ON b.url=g.book WHERE g.gid=? ORDER BY b.read DESC LIMIT ?', [gid, limit]);
        if (!r[0]) return [];
        const books = r[0].values.map((v: any) => {
          const b = this.toBook(v, r[0].columns);
          const tags = this.db.exec('SELECT tag FROM tags WHERE book=?', [b.url]);
          const groups = this.db.exec('SELECT gid FROM groups WHERE book=?', [b.url]);
          b.tags = tags[0] ? tags[0].values.map((v: any) => v[0]) : [];
          b.groups = groups[0] ? groups[0].values.map((v: any) => v[0]) : [];
          // 存入缓存
          this.bookCache.set(b.url, b);
          return b;
        });
        this.monitorMemory();
        return books;
      });
    } catch (error) {
      console.error('Error in getGroupPreviewBooks:', error);
      return [];
    }
  }

  // ==================== 辅助 ====================

  private toBook(row: any, cols: string[]) {
    const get = (n: string) => {
      const index = cols.indexOf(n);
      if (index === -1 || !row || index >= row.length) {
        return undefined;
      }
      return row[index];
    };
    const parse = (v: any) => { try { return JSON.parse(v || '{}'); } catch { return {}; } };
    
    return { 
      url: get('url') || '', 
      title: get('title') || '', 
      author: get('author') || '', 
      cover: get('cover') || '', 
      format: get('format') || '', 
      path: get('path') || '', 
      size: get('size') || 0, 
      added: get('added') || Date.now(), 
      read: get('read') || Date.now(), 
      finished: get('finished') || 0, 
      status: get('status') || 'unread', 
      progress: get('progress') || 0, 
      time: get('time') || 0, 
      chapter: get('chapter') || 0, 
      total: get('total') || 0, 
      pos: parse(get('pos')), 
      source: parse(get('source')), 
      rating: get('rating') || 0, 
      meta: parse(get('meta')), 
      tags: [], 
      groups: [], 
      bindDocId: get('bindDocId') || '', 
      bindDocName: get('bindDocName') || '', 
      autoSync: !!get('autoSync'), 
      syncDelete: !!get('syncDelete') 
    };
  }

  private toAnn(row: any, cols: string[]) {
    const get = (n: string) => {
      const index = cols.indexOf(n);
      if (index === -1 || !row || index >= row.length) {
        return undefined;
      }
      return row[index];
    };
    const parse = (v: any) => { try { return JSON.parse(v || '{}'); } catch { return {}; } };
    return { 
      id: get('id') || '', 
      book: get('book') || '', 
      type: get('type') || '', 
      loc: get('loc') || '', 
      text: get('text') || '', 
      note: get('note') || '', 
      color: get('color') || '', 
      data: parse(get('data')), 
      created: get('created') || Date.now(), 
      updated: get('updated') || Date.now(), 
      chapter: get('chapter') || '', 
      block: get('block') || '' 
    };
  }
}

// ==================== 单例 ====================

let instance: ReaderDatabase | null = null;
export const getDatabase = async () => { if (!instance) { instance = new ReaderDatabase(); await instance.init(); } return instance; };
export const initDatabase = getDatabase;
