# EmbedPDF Integration

SiReader uses EmbedPDF as the only PDF reader path.

- GitHub: https://github.com/embedpdf/embed-pdf-viewer
- Vue package: `@embedpdf/vue-pdf-viewer`
- License: MIT

## Runtime

PDF files open through [`src/components/EmbedPdfReader.vue`](../src/components/EmbedPdfReader.vue).

SiReader does not keep a built-in PDF.js reader, PDF toolbar, PDF search bridge, or PDF mark editing bridge. PDF behavior should come from EmbedPDF capabilities directly.

Current loading path:

- SiReader fetches/reads the PDF into an `ArrayBuffer`.
- EmbedPDF receives it through `documentManager.initialDocuments`.
- `worker: false` is intentional in SiYuan plugin runtime; the worker path can leave documents stuck in `loading`.
- `pdfium.wasm` and default stamp assets are bundled into plugin `assets/` at build time.

## Stored State

EmbedPDF state is stored at:

```txt
records/embedpdf/<bookHash>.bin
```

The file is a V8-serialized object:

```ts
{
  version: 1
  annotations: AnnotationTransferItem[]
  progress?: {
    pageNumber: number
    totalPages: number
    pageCoordinates?: { x: number; y: number }
    updatedAt: number
  }
}
```

Annotations are imported and exported only through EmbedPDF:

- `annotation.exportAnnotations()`
- `annotation.importAnnotations()`

SiReader filters exported annotations before saving so PDF-native link annotations are not duplicated into plugin storage. User annotations remain in EmbedPDF transfer format. Keep this direct round trip; do not add an adapter layer unless EmbedPDF changes its transfer shape.

Progress is saved from EmbedPDF scroll metrics and restored with `scrollToPage()`.

The annotation page reads exported EmbedPDF annotations and maps only UI fields needed by the shared mark card:

- `id`
- `page`
- `text`
- `note`
- `tags`
- `blockId`
- `color`
- `style`
- `created/modified`
- `chapter`

Fields not shown by current UI should stay out of `custom` unless they drive rendering or sync.

## Annotation Links

PDF annotation links use the same SiReader backlink entry as EPUB:

```txt
sireader://open?url=<bookUrl>&cfi=%23page-<page>&id=<annotationId>
```

For PDF, `cfi` is a page anchor (`#page-8`). `%23` is the normal URL encoding of `#`.

Click handling stays in the shared SiReader link flow:

- parse the `sireader://open` URL
- open or activate the book tab
- when `cfi` matches `#page-N`, route to EmbedPDF `goTo(page)` instead of EPUB CFI navigation
- use the annotation `id` only as the exact target/highlight identifier, not as the page source

Do not send `#page-N` into Foliate/EPUB `goTo()`.

## PDF Annotation Tooltip

The reading-page tooltip is only for PDF annotations that already have a comment or replies. Plain highlights without note content should not show a tooltip.

The trigger deliberately follows EmbedPDF's rendered hit area:

- read the element under the pointer through the `embedpdf-container` shadow root
- require `cursor: pointer`, which is EmbedPDF's own annotation hit signal
- match that rendered hit element against EmbedPDF annotation rects using screen-space overlap
- choose the annotation with the largest overlap

The tooltip content is built from:

- selected text: `annotation.custom.text`, normalized to one inline line for PDF line breaks
- comment: `annotation.custom.note` or `annotation.contents`
- replies: annotations whose `inReplyToId` points at the parent annotation

Keep this path small. Avoid timers, global mousemove logging, selected-annotation fallbacks, or distance-based guessing; those make hover unstable or show the wrong note.

## PDF Actions And Menus

PDF reader actions should reuse shared TypeScript helpers and keep [`src/components/EmbedPdfReader.vue`](../src/components/EmbedPdfReader.vue) as thin EmbedPDF glue.

Current helper split:

- [`src/utils/copy.ts`](../src/utils/copy.ts): shared mark copy/export/import and `sendMarkToDoc()`.
- [`src/utils/embedPdfActions.ts`](../src/utils/embedPdfActions.ts): EmbedPDF task conversion, PDF selection/annotation-to-mark conversion, quick-send license wrapper, screenshot blob clipboard write, menu item insertion, and bookmark-to-TOC mapping.
- [`src/utils/dictionary.ts`](../src/utils/dictionary.ts): dictionary popup.
- [`src/components/Translate.vue`](../src/components/Translate.vue): translation dialog content.

Quick send uses EmbedPDF's native UI model:

- selection and annotation menus get one first-level `发送到` command button
- that button opens a native EmbedPDF `menus` entry with the configured quick-send documents
- document rows call the shared `sendMarkToDoc()` path through `sendPdfMarkToDoc()`
- valid quick-send documents must have an `id`; the PDF menu only shows up to five

Do not build custom floating quick-send menus. EmbedPDF `selectionMenus` do not expose a stable submenu item shape; use `menus + openMenu()` instead.

Screenshot copy uses EmbedPDF capture state:

- the document menu gets a `复制截图` command
- the command starts marquee capture and closes SiReader side panels
- when EmbedPDF produces a capture blob, SiReader writes it through the shared PDF action helper
- the capture result footer also gets a copy button beside EmbedPDF's own download button

PDF outline/bookmarks are exposed through `Reader.vue` as `currentView.getBookmarks()` and rendered by the shared sidebar TOC via `bookmarkToc()`. Keep the hierarchy from EmbedPDF bookmark children; do not flatten it for the sidebar.

## Document Hover Preview

Backlinks inserted into SiYuan documents should preview PDF annotation context on hover.

Preview lookup order:

- live opened PDF annotations, when the book is already active
- stored EmbedPDF annotations from `records/embedpdf/<bookHash>.bin`
- fallback by page when the stored annotation id is stale

Context text comes from EmbedPDF text extraction:

- opened PDF: reuse the active EmbedPDF engine/document and cache per page
- unopened PDF: create one hidden EmbedPDF session for the book, extract only the requested page, cache the page text, and dispose/reuse the hidden session by book

Preview range should include text before and after the annotation. It should not stop at only the next sentence when the following paragraph still fits inside the context window.

Keep extraction lazy. Do not pre-extract the whole PDF for document hover.

## PDF Theme

PDF theme support is intentionally small.

EmbedPDF's `theme` config is used for viewer UI chrome only. It does not reliably recolor rendered PDF page pixels. SiReader therefore keeps page-content theming to two stable modes:

- light/default: no page filter
- dark-like themes: invert rendered PDF page blob images inside the EmbedPDF shadow root

The current implementation lives in:

- [`src/utils/embedPdfTheme.ts`](../src/utils/embedPdfTheme.ts): maps SiReader theme/custom theme to EmbedPDF UI theme preference and basic UI colors
- [`src/components/EmbedPdfReader.vue`](../src/components/EmbedPdfReader.vue): calls `setTheme()`, sets `data-sireader-page-mode`, and injects one small `style[data-sireader-page-theme]` into EmbedPDF's shadow root

Do not reintroduce PDFium/render `pageColors`, patched `@embedpdf` packages, or broad canvas filters. Those attempts previously caused blank pages, background covering text, blurred content, or annotations inheriting the page theme. If richer sepia/green/blue PDF page theming is needed later, treat it as a new feature with visual regression checks.

## Legacy Migration

Old SiReader PDF records may exist at:

```txt
records/<bookHash>.json
```

On first EmbedPDF open, if no EmbedPDF annotations exist, old PDF annotations are converted once into EmbedPDF transfer items:

- old `highlight` -> EmbedPDF highlight annotation
- old `ink` -> EmbedPDF ink annotation
- old `shape` textbox -> EmbedPDF free text annotation
- old `shape` rect/circle -> EmbedPDF square/circle annotation

After conversion, EmbedPDF owns the data. The old PDF mark compatibility layer is not used.

Legacy fields intentionally preserved:

- `id`
- `page/pageIndex`
- `text`
- `note/contents`
- `tags`
- `color`
- `created/updated`
- `block/blockId`
- `chapter`
- highlight geometry: `rects -> segmentRects`
- ink geometry: `paths -> inkList`
- shape geometry/style: `shapeType`, `rect`, `strokeWidth`, `opacity`
- reading progress: `chapter/total/read -> progress`

Legacy fields that do not currently show in the UI:

- `textOffset`
- `customOrder`
- old EPUB-only styles such as `outline`, `dotted`, `dashed`, `double`

If simplifying migration, keep visual/rendering fields and visible card fields first. Dropping `textOffset` and `customOrder` is safe for current PDF UI; dropping geometry, color, contents, dates, tags, note, or block binding is not.

When old annotations are migrated, show `pdfMigrated` from i18n with the migrated count.

## Rule

If EmbedPDF does not expose a stable capability, SiReader leaves that PDF feature to EmbedPDF's own UI instead of rebuilding it.

## New Chat Checklist

- Keep `buffer + worker:false + local wasm/assets`.
- Keep one-time legacy migration when `.bin` has no annotations.
- Keep EmbedPDF `exportAnnotations()` / `importAnnotations()` as the storage boundary.
- Keep PDF backlinks as `sireader://open?...&cfi=%23page-N&id=...`.
- Keep PDF click navigation on EmbedPDF page anchors, not EPUB CFI navigation.
- Keep PDF page theme support to default/light and dark inversion only.
- Keep EmbedPDF UI theme mapping small; avoid unused full-token color maps.
- Keep the PDF theme shadow style injected once with `data-sireader-page-theme`.
- Keep PDF tooltip tied to EmbedPDF rendered pointer hit areas and annotation overlap.
- Keep PDF quick send on native EmbedPDF `menus + openMenu()`, with shared send/copy helpers in `.ts` files.
- Keep PDF screenshot copy on EmbedPDF capture events; do not add a custom screenshot renderer.
- Keep PDF outline/bookmark hierarchy in the sidebar TOC.
- Keep document hover preview lazy, page-scoped, and available for unopened PDFs.
- Avoid restoring the old PDF.js shell, old toolbar, or compatibility card code.
- Avoid patched `@embedpdf` dependencies unless upstream exposes a stable API and the patch is unavoidable.
- Before changing annotation fields, verify both PDF rendering and the shared mark card.
