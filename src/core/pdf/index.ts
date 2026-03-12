/**
 * PDF模块统一导出
 */

// PDF查看器和搜索
export { PDFViewer } from './viewer'
export { PDFSearch } from './search'

// PDF元数据
export { getMetadata } from './metadata'
export type { PDFMetadata } from './metadata'

// PDF工具
export { printPDF } from './print'
export { downloadPDF } from './download'
export { exportAsImages } from './download'

// 墨迹和形状工具
export { createInkToolManager } from './ink'
export { createShapeToolManager } from './shape'
export type { InkToolManager } from './ink'
export type { ShapeToolManager } from './shape'

// PDF标注类型定义
export interface PdfAnnotation {
  id: string
  index: number
  coords: number[][]
  color: string
  content: string
  type: 'text' | 'border'
  mode: 'text' | 'rect'
}