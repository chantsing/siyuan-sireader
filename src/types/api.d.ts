// ==================== 思源笔记基础类型 ====================
type DocumentId = string;
type BlockId = string;
type NotebookId = string;
type PreviousID = BlockId;
type ParentID = BlockId | DocumentId;

type Notebook = {
  id: NotebookId;
  name: string;
  icon: string;
  sort: number;
  closed: boolean;
};

type NotebookConf = {
  name: string;
  closed: boolean;
  refCreateSavePath: string;
  createDocNameTemplate: string;
  dailyNoteSavePath: string;
  dailyNoteTemplatePath: string;
};

type BlockType = "d" | "s" | "h" | "t" | "i" | "p" | "f" | "audio" | "video" | "other";

type BlockSubType = "d1" | "d2" | "s1" | "s2" | "s3" | "t1" | "t2" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "table" | "task" | "toggle" | "latex" | "quote" | "html" | "code" | "footnote" | "cite" | "collection" | "bookmark" | "attachment" | "comment" | "mindmap" | "spreadsheet" | "calendar" | "image" | "audio" | "video" | "other";

type Block = {
  id: BlockId;
  parent_id?: BlockId;
  root_id: DocumentId;
  hash: string;
  box: string;
  path: string;
  hpath: string;
  name: string;
  alias: string;
  memo: string;
  tag: string;
  content: string;
  fcontent?: string;
  markdown: string;
  length: number;
  type: BlockType;
  subtype: BlockSubType;
  ial?: string;
  sort: number;
  created: string;
  updated: string;
};

type doOperation = {
  action: string;
  data: string;
  id: BlockId;
  parentID: BlockId | DocumentId;
  previousID: BlockId;
  retData: null;
};

// ==================== API 类型定义 ====================
interface IResGetNotebookConf {
  box: string;
  conf: NotebookConf;
  name: string;
}

interface IReslsNotebooks {
  notebooks: Notebook[];
}

interface IResUpload {
  errFiles: string[];
  succMap: { [key: string]: string };
}

interface IResdoOperations {
  doOperations: doOperation[];
  undoOperations: doOperation[] | null;
}

interface IResGetBlockKramdown {
  id: BlockId;
  kramdown: string;
}

interface IResGetChildBlock {
  id: BlockId;
  type: BlockType;
  subtype?: BlockSubType;
}

interface IResGetTemplates {
  content: string;
  path: string;
}

interface IResReadDir {
  isDir: boolean;
  isSymlink: boolean;
  name: string;
}

interface IResExportMdContent {
  hPath: string;
  content: string;
}

interface IResBootProgress {
  progress: number;
  details: string;
}

interface IReqForwardProxy {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  payload?: any;
  contentType?: string;
  timeout?: number;
}

interface IResForwardProxy {
  body: string;
  contentType: string;
  elapsed: number;
  headers: { [key: string]: string };
  status: number;
  url: string;
}

interface IResExportResources {
  path: string;
}

// 全局类型扩展
declare global {
  interface Window {
    siyuan: {
      notebooks: any;
      menus: any;
      dialogs: any;
      blockPanels: any;
      storage: any;
      user: any;
      ws: any;
      languages: any;
    };
  }
}

// Vue 模块声明
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
