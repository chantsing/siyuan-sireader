declare module '@private-sources' {
  import type { HttpSourceConfig, HttpSourceManager } from '@/utils/HttpSources'

  export function registerPrivateSources(manager: HttpSourceManager): void
  export function createPrivateSearchAccess(context?: { reload?: () => void }): {
    isSourceVisible: (source: HttpSourceConfig) => boolean
    handleManagePanelClick: (event: MouseEvent) => void
  }
}
