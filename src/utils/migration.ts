/**
 * 数据迁移工具 - 自动检测并迁移旧版本数据到新数据库
 */

import { getDatabase } from '@/core/database';
import { getFile, removeFile } from '@/api';
import { showMessage } from 'siyuan';

const OLD_DATA_PATH = '/data/storage/petal/siyuan-sireader';

// ==================== 工具函数 ====================

const getHash = (url: string) => Math.abs(url.split('').reduce((h, c) => (((h << 5) - h) + c.charCodeAt(0)) | 0, 0)).toString(36);

const sanitizeName = (name: string) => name
  .replace(/[<>:"/\\|?*\x00-\x1f《》【】「」『』（）()[\]{}]/g, '')
  .replace(/\s+/g, '_')
  .replace(/[._-]+/g, '_')
  .replace(/^[._-]+|[._-]+$/g, '')
  .slice(0, 50) || 'book';

const getBookFileName = (bookIndex: any) => `${sanitizeName(bookIndex.name)}_${getHash(bookIndex.bookUrl)}.json`;

const showConfirm = (message: string, onConfirm: () => void, onCancel?: () => void) => {
  showMessage(
    `${message}<div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
      <button class="b3-button b3-button--cancel" onclick="this.parentElement.parentElement.parentElement.remove();${onCancel ? 'window._migrationCancel()' : ''}">取消</button>
      <button class="b3-button b3-button--text" onclick="this.parentElement.parentElement.parentElement.remove();window._migrationConfirm()">确定</button>
    </div>`,
    0,
    'info'
  );
  (window as any)._migrationConfirm = onConfirm;
  if (onCancel) (window as any)._migrationCancel = onCancel;
};

// ==================== 迁移函数 ====================

/**
 * 检查是否需要迁移
 */
export async function needsMigration(): Promise<boolean> {
  try {
    const indexData = await getFile(`${OLD_DATA_PATH}/index.json`);
    if (!indexData || !Array.isArray(indexData) || indexData.length === 0) return false;
    
    const db = await getDatabase();
    const books = await db.getBooks();
    return books.length === 0;
  } catch {
    return false;
  }
}

/**
 * 迁移单本书籍
 */
async function migrateBook(bookIndex: any, bookData: any) {
  const now = Date.now();
  const data = bookData || {};
  const annotations: any[] = [];
  
  // 高亮和笔记
  data.annotations?.forEach((mark: any) => {
    const annData: any = { format: data.format };
    if (data.format === 'pdf') {
      if (mark.page !== undefined) annData.page = mark.page;
      if (mark.rects) annData.rects = mark.rects;
    } else if (data.format === 'epub' && mark.cfi) {
      annData.cfi = mark.cfi;
    }
    if (mark.style) annData.style = mark.style;
    if (mark.shapeType) annData.shapeType = mark.shapeType;
    if (mark.filled !== undefined) annData.filled = mark.filled;
    if (mark.paths) annData.paths = mark.paths;
    
    annotations.push({
      id: mark.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      book: bookIndex.bookUrl,
      type: mark.note ? 'note' : mark.shapeType ? 'shape' : mark.paths ? 'ink' : 'highlight',
      loc: mark.cfi || mark.value || (mark.page !== undefined ? `page-${mark.page}` : '') || (mark.section !== undefined ? `section-${mark.section}` : ''),
      text: mark.text || '',
      note: mark.note || '',
      color: mark.color || '#ffeb3b',
      data: annData,
      created: mark.timestamp || now,
      updated: mark.timestamp || now,
      chapter: mark.chapter || '',
      block: mark.blockId || ''
    });
  });
  
  // PDF 墨迹标注
  data.inkAnnotations?.forEach((ink: any) => {
    annotations.push({
      id: ink.id || `ink-${ink.page}-${ink.timestamp}`,
      book: bookIndex.bookUrl,
      type: 'ink',
      loc: `page-${ink.page}`,
      text: '',
      note: '',
      color: ink.paths?.[0]?.color || '#ff0000',
      data: { format: 'pdf', page: ink.page, paths: ink.paths },
      created: ink.timestamp || now,
      updated: ink.timestamp || now,
      chapter: '',
      block: ''
    });
  });
  
  // PDF 形状标注
  data.shapeAnnotations?.forEach((shape: any) => {
    annotations.push({
      id: shape.id || `shape-${shape.page}-${shape.timestamp}`,
      book: bookIndex.bookUrl,
      type: 'shape',
      loc: `page-${shape.page}`,
      text: '',
      note: shape.note || '',
      color: shape.color || '#ff0000',
      data: { format: 'pdf', page: shape.page, shapeType: shape.shapeType, filled: shape.filled, rect: shape.rect },
      created: shape.timestamp || now,
      updated: shape.timestamp || now,
      chapter: shape.chapter || '',
      block: ''
    });
  });
  
  // EPUB 书签
  data.epubBookmarks?.forEach((bm: any) => {
    annotations.push({
      id: `bookmark-${bm.cfi}-${bm.time}`,
      book: bookIndex.bookUrl,
      type: 'bookmark',
      loc: bm.cfi,
      text: bm.title || '',
      note: '',
      color: '#2196f3',
      data: { format: 'epub', cfi: bm.cfi, title: bm.title || '', progress: bm.progress || 0 },
      created: bm.time || now,
      updated: bm.time || now,
      chapter: bm.title || '',
      block: ''
    });
  });
  
  // EPUB 书签
  data.epubBookmarks?.forEach((bm: any) => {
    annotations.push({
      id: `bookmark-section-${bm.section}-${bm.time}`,
      book: bookIndex.bookUrl,
      type: 'bookmark',
      loc: `section-${bm.section}`,
      text: bm.title || '',
      note: '',
      color: '#2196f3',
      data: { format: 'epub', section: bm.section, title: bm.title || '' },
      created: bm.time || now,
      updated: bm.time || now,
      chapter: bm.title || '',
      block: ''
    });
  });
  
  const pos: any = {};
  if (data.epubCfi) pos.cfi = data.epubCfi;
  if (data.durChapterIndex !== undefined) pos.chapter = data.durChapterIndex;
  if (data.durChapterPos !== undefined) pos.position = data.durChapterPos;
  if (data.durChapterPage !== undefined) pos.page = data.durChapterPage;
  if (data.durChapterTitle) pos.chapterTitle = data.durChapterTitle;
  
  const source: any = {};
  if (data.tocUrl) {
    source.origin = data.origin || 'unknown';
    source.bookUrl = bookIndex.bookUrl;
    source.tocUrl = data.tocUrl;
    source.latestChapter = data.latestChapterTitle;
    source.latestTime = data.latestChapterTime;
    source.lastCheckTime = data.lastCheckTime;
    source.updateCount = bookIndex.lastCheckCount || 0;
  }
  
  const meta: any = {};
  if (data.publisher) meta.publisher = data.publisher;
  if (data.published) meta.publishDate = data.published;
  if (data.identifier) meta.isbn = data.identifier;
  if (data.language) meta.language = data.language;
  if (data.intro) meta.description = data.intro;
  if (data.totalChapterNum) meta.pageCount = data.totalChapterNum;
  if (data.series) meta.series = data.series;
  if (data.subjects) meta.subjects = data.subjects;
  
  const progress = bookIndex.epubProgress || data.epubProgress || 0;
  
  return {
    book: {
      url: bookIndex.bookUrl,
      title: bookIndex.name || data.name || '未知书名',
      author: bookIndex.author || data.author || '未知作者',
      cover: bookIndex.coverUrl || '',
      format: bookIndex.format || data.format || 'epub',
      path: data.filePath || '',
      size: data.fileSize || 0,
      added: bookIndex.addTime || data.addTime || now,
      read: bookIndex.durChapterTime || data.durChapterTime || now,
      finished: progress >= 100 ? now : 0,
      status: progress === 0 ? 'unread' : progress >= 100 ? 'finished' : 'reading',
      progress,
      time: 0,
      chapter: bookIndex.durChapterIndex || data.durChapterIndex || 0,
      total: bookIndex.totalChapterNum || data.totalChapterNum || 0,
      pos,
      source,
      rating: data.rating || 0,
      meta,
      tags: data.tags || [],
      groups: data.groups || ['default'],
      bindDocId: data.bindDocId || '',
      bindDocName: data.bindDocName || '',
      autoSync: data.autoSync || false,
      syncDelete: data.syncDelete || false
    },
    annotations
  };
}

/**
 * 执行迁移
 */
async function migrate() {
  const indexData = await getFile(`${OLD_DATA_PATH}/index.json`) as any[];
  if (!indexData?.length) return { success: 0, failed: 0, totalAnnotations: 0 };
  
  const db = await getDatabase();
  let success = 0, failed = 0, totalAnnotations = 0;
  
  for (const bookIndex of indexData) {
    try {
      const fileName = getBookFileName(bookIndex);
      const bookData = await getFile(`${OLD_DATA_PATH}/books/${fileName}`);
      const { book, annotations } = await migrateBook(bookIndex, bookData);
      
      await db.saveBook(book);
      for (const ann of annotations) await db.saveAnnotation(ann);
      
      totalAnnotations += annotations.length;
      success++;
    } catch (error) {
      failed++;
      console.error(`[Migration] ${bookIndex.name}:`, error);
    }
  }
  
  // 迁移设置
  try {
    const configData = await getFile(`${OLD_DATA_PATH}/config.json`);
    if (configData?.settings) await db.batchSaveSettings(configData.settings);
  } catch {}
  
  // 初始化默认分组
  await db.saveGroups([
    { id: 'default', name: '默认分组', icon: '📚', color: '#2196f3', order: 0, type: 'folder' },
    { id: 'reading', name: '正在阅读', icon: '📖', color: '#4caf50', order: 1, type: 'smart', rules: { status: ['reading'] } },
    { id: 'finished', name: '已完成', icon: '✅', color: '#9e9e9e', order: 2, type: 'smart', rules: { status: ['finished'] } }
  ]);
  
  return { success, failed, totalAnnotations };
}

/**
 * 获取目录下所有文件
 */
async function getAllFiles(basePath: string): Promise<string[]> {
  const files: string[] = [];
  
  async function scan(path: string) {
    try {
      const response = await fetch('/api/file/readDir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      });
      const data = await response.json();
      
      if (data.code === 0 && data.data) {
        for (const item of data.data) {
          const fullPath = `${path}/${item.name}`;
          if (item.isDir) {
            await scan(fullPath);
          } else {
            files.push(fullPath.replace(basePath + '/', ''));
          }
        }
      }
    } catch {}
  }
  
  await scan(basePath);
  return files;
}

/**
 * 检查文件是否在白名单中
 */
function isWhitelisted(filePath: string): boolean {
  // 白名单规则
  const rules = [
    /^deck-data\.db$/,                                    // 卡包数据库
    /^books\/[^/]+\.(epub|pdf)$/,                    // 书籍文件
    /^books\/[^/]+\.(jpg|jpeg|png|webp|gif)$/,           // 封面图片
    /^anki\/[^/]+\/collection\.anki21$/,                 // Anki集合数据库
    /^anki\/[^/]+\/source\.apkg$/,                       // Anki源文件
    /^dictionaries\//                                     // 词典目录
  ];
  
  return rules.some(rule => rule.test(filePath));
}

/**
 * 删除旧数据（白名单模式）
 */
async function deleteOldData() {
  const deleted: string[] = [];
  const failed: string[] = [];
  
  try {
    const allFiles = await getAllFiles(OLD_DATA_PATH);
    const filesToDelete = allFiles.filter(f => !isWhitelisted(f));
    
    for (const file of filesToDelete) {
      try {
        await removeFile(`${OLD_DATA_PATH}/${file}`);
        deleted.push(file);
      } catch {
        failed.push(file);
      }
    }
  } catch (error) {
    console.error('[Migration] 扫描文件失败:', error);
  }
  
  return { deleted, failed };
}

/**
 * 获取需要删除的文件列表（用于显示）
 */
async function getFilesToDelete(): Promise<{ files: string[], total: number }> {
  try {
    const allFiles = await getAllFiles(OLD_DATA_PATH);
    const filesToDelete = allFiles.filter(f => !isWhitelisted(f));
    return { files: filesToDelete.slice(0, 15), total: filesToDelete.length };
  } catch {
    return { files: [], total: 0 };
  }
}

/**
 * 自动迁移（插件启动时调用）
 */
export async function autoMigrate(): Promise<void> {
  try {
    if (!await needsMigration()) return;
    
    showConfirm(
      '检测到旧版本数据，是否进行数据迁移？<br><small style="color:var(--b3-theme-on-surface-light)">迁移不会删除原数据，建议先备份</small>',
      async () => {
        showMessage('正在迁移数据...', 3000, 'info');
        const result = await migrate();
        
        showMessage(
          result.failed > 0
            ? `迁移完成！成功 ${result.success} 本，失败 ${result.failed} 本，标注 ${result.totalAnnotations} 个`
            : `迁移成功！书籍 ${result.success} 本，标注 ${result.totalAnnotations} 个`,
          4000,
          'info'
        );
        
        setTimeout(async () => {
          const { files, total } = await getFilesToDelete();
          const fileList = files.length > 0
            ? files.join('<br>• ') + (total > files.length ? `<br>• ... 等共 ${total} 个文件` : '')
            : '无文件需要删除';
          
          showConfirm(
            `是否清理旧数据文件？<br><small style="color:var(--b3-theme-on-surface-light)">将删除：<br>• ${fileList}<br><br>保留：书籍、封面、deck-data.db、anki集合、词典</small>`,
            async () => {
              showMessage('正在清理旧数据...', 2000, 'info');
              const { deleted, failed } = await deleteOldData();
              setTimeout(() => {
                showMessage(
                  failed.length > 0
                    ? `已删除 ${deleted.length} 个，${failed.length} 个失败`
                    : `已清理 ${deleted.length} 个旧数据文件`,
                  3000,
                  failed.length > 0 ? 'error' : 'info'
                );
              }, 2000);
            }
          );
        }, 4000);
      }
    );
  } catch (error: any) {
    console.error('[Migration]', error);
    showMessage(`迁移失败: ${error.message}`, 4000, 'error');
  }
}

