declare module '@private-sources' {
  import type { HttpSourceConfig, HttpSourceManager } from '@/utils/HttpSources'

  export function registerPrivateSources(manager: HttpSourceManager): void
  export function createPrivateSearchAccess(context?: { reload?: () => void }): {
    isSourceVisible: (source: HttpSourceConfig) => boolean
    handleManagePanelClick: (event: MouseEvent) => void
  }
  export function extractReadableWebpage(url: string, snapshot?: string | {
    title?: string
    text?: string
    visibleText?: string
    shadowText?: string
    html?: string
  }): Promise<{
    title: string
    author?: string
    excerpt?: string
    text: string
    url: string
  }>
  export function createReadableWebpageTxtFile(url: string, snapshot?: string | {
    title?: string
    text?: string
    visibleText?: string
    shadowText?: string
    html?: string
  }): Promise<{
    page: {
      title: string
      author?: string
      excerpt?: string
      text: string
      url: string
    }
    file: File
  }>
}
