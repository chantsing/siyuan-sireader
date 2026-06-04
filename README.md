<div align="center">

# 📖 SiReader

**Professional eBook Reader · Smart Annotation · Flashcard Learning**

Transform SiYuan Notes into a professional eBook reader  
Support EPUB/PDF/TXT/Online novels with smart annotation, TTS, dictionary, AI translation, Anki flashcards

[![Version](https://img.shields.io/badge/version-1.3.5-blue.svg)](https://github.com/your-repo/siyuan-sireader)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![SiYuan](https://img.shields.io/badge/SiYuan-3.0+-orange.svg)](https://github.com/siyuan-note/siyuan)

[🌐 Website](https://sireader.745201.xyz) · [📖 Documentation](https://my.feishu.cn/wiki/Czp8wrf2NibwA9krhvmcHnbtnMc) · [💎 Purchase](https://pay.ldxp.cn/shop/J7MJJ8YR/lillyt) · [👥 QQ Group](https://qm.qq.com/q/wpHDtsfxCw) · [📝 Changelog](https://my.feishu.cn/wiki/XzefwHqz4inde7k7rJKce7shn8d)

</div>

---

## 📝 Latest Updates

### v1.3.5 (2026.6.4)

### Added

- Added a TTS background playback mini panel with voice, speed, auto page-turning, read-aloud highlight, pause, stop, previous paragraph, and next paragraph controls.
- Added an EPUB "Start Reading" animation switch, disabled by default to avoid extra loading work when opening books.
- Added one-click chapter copy from the table of contents for easier excerpting and organization.
- Added hover previews for book annotation links in documents, showing the original context including the annotated sentence and adjacent previous and next sentences, with on-demand preview loading when the book is not open.

### Improved

- PDF reader no longer shows the "Start Reading" animation and opens directly into content.
- Improved the TXT reading path with a new lightweight TXT parser, opening directly in the reader without converting to EPUB, improving open speed and reducing compatibility issues from format conversion.
- Improved annotation popup action tooltip placement so it expands leftward and avoids top-edge clipping.

### Fixed

- Fixed EPUB left/right keyboard page turning possibly failing after switching tabs, clearing search, or refreshing the view, unifying the page-turning entry for keyboard, mouse wheel, and mouse side buttons [#33](https://github.com/mm-o/siyuan-sireader/issues/33).
- Fixed the bottom search toolbar disappearing when clicking the reading body, and fixed the popped-up search bar still being affected by toolbar opacity [#32](https://github.com/mm-o/siyuan-sireader/issues/32).
- Fixed some EPUB built-in images or background images being covered by reader container and page backgrounds, causing incomplete display [#28](https://github.com/mm-o/siyuan-sireader/issues/28).
- Fixed some large scanned PDFs opening to blank pages, improving rendering compatibility for national-standard and specification-style PDFs.
- Fixed cloud-drive books being downloaded unexpectedly when added, keeping cloud-drive books added and read online as expected.
- Fixed the "Add custom book source" button being misaligned.
- Fixed bound-document auto-sync reverting book names to "Reading", now preferring the latest modified book name from the bookshelf.

### v1.3.1 (2026.6.2)

**Added**

- Added SiPan file-link import, and SiPan folder links can be added directly as bookshelf groups.
- Added reading and annotation support for cloud-drive files to reduce local storage usage.
- **Added private book-source search, add, and download entry for Z-Library (Easter egg).**
- Added batch organization after batch import.
- Added shortcut commands for PDF text selection, hand, ink annotation, and shape annotation tools, with in-reader T/H/I/S quick switching.

**Improved**

- Improved batch operation flow to reduce repeated clicks and duplicate processing.
- Improved the "Start Reading" animation trigger and wording, so it no longer repeats for books with progress or repeated opens in the same session.
- Kept the page navigation toolbar visible while the "Start Reading" animation is shown.
- PDF reading now always uses continuous scrolling and is no longer affected by single-page or double-page layout settings.
- PDF supports Ctrl + mouse wheel zooming.
- Removed the "fit page" zoom entry from the PDF toolbar; legacy settings fall back to fit width.
- Improved PDF shape annotation screenshot clarity for clearer inserted images.

**Fixed**

- Fixed the missing logout button on the membership card.
- Fixed PDFs with mixed portrait and landscape pages possibly freezing on landscape pages.
- Fixed bookshelf search in grid view, list view, and groups.
- Fixed bound-document search results showing but not being selectable.

### v1.3.0 (2026.5.23)

**Added**

- EPUB image copy/export and annotation browsing.
- Font weight controls for finer reading-text tuning.
- Custom reading background image selection.
- Header and footer display with chapter title, reading progress, and overall progress.
- Annotation tags with add/edit support in both the reader popup and annotation panel.
- Annotation tag filtering with multi-tag combinations and reuse of existing tags.
- Batch note import with block-ID binding detection.
- Open note documents from floating block windows, with automatic note creation and binding.
- Global "sync on add" and "sync on delete" settings, no longer tied to per-book configuration.
- Bilingual offline dictionary usage notes.

**Improved**

- Default startup now opens the bookshelf view.
- More compact settings layout with a more unified look.
- Clearer settings icons and visual hierarchy.
- Faster font and voice loading in settings, reducing wait time when opening settings.
- Faster font application in the reader, so font switching feels more immediate.
- Faster book loading and opening, including Docker environments.
- Removed settings preview so changes can be reviewed directly in the reader, reducing duplicated UI and maintenance cost.
- Offline dictionary import and lookup now use clearer file/folder selection, with multiple dictionaries shown separately.
- Better offline dictionary names and definitions, with simplified/traditional Chinese matching.
- Faster offline dictionary loading with the new storage location.
- Refactored annotation cards and panels for a unified presentation and editing experience across the reader popup, sidebar list, and PDF annotations.
- Unified PDF text, shape, and ink annotation logic, with shapes and ink also using the same annotation card for viewing and editing.
- Improved PDF text-box annotation display and export to fit text content and avoid oversized regions.
- Improved PDF ink annotation interaction so continuous writing merges into a single ink annotation, with unified display and export.
- Improved PDF toolbar and annotation saving logic to reduce flicker and page jumping after annotations.
- Unified table-of-contents styling in the reader and added the ability to show reading settings inside the TOC area.
- Improved continuous-scroll rendering for a cleaner reading state.
- Improved the readable translation logic for `sireader://open` links.
- Improved import-page grouping style, bookshelf cover four-grid layout, label stacking in list view, and element tooltips.
- Improved group navigation interaction to reduce switching flicker.

**Fixed**

- Fixed missing chapter anchors when copying exported outlines.
- Fixed low-contrast dark-mode titles in some places.
- Fixed occasional blank bookshelf sidebar after sync.
- Fixed custom reading backgrounds not applying.
- Fixed some offline dictionaries importing successfully but failing on lookup.
- Fixed incorrect offline dictionary names and result display.
- Fixed PDF text selection offset, half-character selection, and misselection of blank areas.
- Fixed unstable toolbar visibility on the reading page.
- Fixed invalid reading-layout settings.
- Fixed repeated note insertion when a quick-annotation selection area was not cleared.
- Fixed quick-annotation drops landing before drag end.
- Fixed local book-link import failures.
- Fixed confirmation issues when deleting books in tree view.

### v1.2.5 (2026.5.17)

**Added**

- Added mouse wheel page turning.
- Added mouse side-button page turning.

**Improved**

- Refactored the table-of-contents style and interaction for a smoother, more consistent experience.
- Refactored the settings page styling for a more compact layout.

**Fixed**

- Fixed note-insert search results not appearing.
- Fixed EPUB content collapsing into a single line in continuous-scroll mode.
- Fixed continuous-scroll mode failing to turn to the next chapter.

### v1.2.2 (2026.5.12)

**Added**

- Added a tree view for the bookshelf with expand/collapse support.
- Added drag-and-drop grouping for books, including moving books out of groups.
- Added a first-open "Start Reading" welcome effect for newly opened books.
- Added quick annotation-type switches for All, Highlights, Notes, and Bookmarks.
- Added a standalone annotation panel for centralized review and management.

**Improved**

- Improved the overall interaction across the three bookshelf views and refactored the related structure.
- Improved batch import flow and presentation so the import process is clearer.
- Improved bookshelf cover rendering stability and performance.
- Improved smart-grouping conditions to make organization easier.
- Improved the PDF toolbar layout and styling for a more compact, consistent UI.
- Refactored popup structures for bookshelf, search, and annotations to unify interaction patterns.
- Refactored the table of contents and annotation panel structure with clearer responsibility boundaries.
- Refactored annotation filtering to support type filters, combined filters, and sorting.
- Merged bookmarks into the annotation system for unified display and filtering across highlights, notes, and bookmarks.
- Added filtering support for text highlights, notes, bookmarks, ink, shapes, and other annotation types.
- Improved annotation card styling and interaction feedback for a cleaner interface.
- Improved the settings page and related UI structure for better stability.
- Improved book opening and reader-view mounting to reduce initialization coupling.
- Improved import, book storage, and migration code structure for better version compatibility.
- Added full mobile support, including both tap-to-turn and swipe page turning.
- Added full feature support for Docker deployments.

**Fixed**

- Fixed a shortcut conflict between PDF printing and SiYuan global search.
- Fixed an intermittent blank screen when opening a book for the first time.
- Fixed incorrect progress display caused by PDF reading-progress save failures.
- Fixed incomplete background rendering after resizing the EPUB reading window.
- Fixed misplaced toolbar positioning after selecting text in PDF.
- Fixed the repeated display of the "Start Reading" effect for books that already had reading progress.
- Fixed the mobile-side reading open event chain to improve entry stability.
- Fixed compatibility issues in some book import, storage, and migration scenarios.

---

### v1.1.3 (2026.4.30)

**Fixed**

- Fixed incorrect membership checks during book import.

**Added**

- Added a migration progress dialog to make the data migration process more visible.

---

### v1.1.2 (2026.4.28)

**Fixed**

- Fixed an issue where some migrated books could not be opened because of file naming.
- Fixed cover and book file loading failures after unified managed-file renaming.
- Fixed "New Tab" still opening on the right side.

**Added**

- Added pre-import parsing so books can be previewed before import.
- Added book link import.
- Added local file import as links.

**Improved**

- Reused parsed metadata during import to avoid duplicate parsing and speed up batch import.
- Unified open-position logic so all open behaviors follow the same setting.
- Simplified reader-tab opening logic and reused the same entry for bookshelf, document links, and external calls.

---

### v1.1.0 (2026.4.28)

**Highlights**

- Reworked the data read/write and storage pipeline to reduce overhead and improve overall responsiveness.
- Migrated books and covers into the `public` directory for a cleaner structure and more stable asset access.
- Bookshelf PDFs can now be opened directly with SiYuan's built-in PDF viewer, consistent with the related setting.

**Added**

- Open books directly from database resource fields.
- One-click expand/collapse for the table of contents.
- Quick export from table of contents to notes.
- Export the table of contents to a document and open it directly.
- More flexible note insertion targets: current document, notebook, child document, or `Daily Note`.
- Full-text search for annotations, including chapters, titles, body text, and note content.
- Annotation grouping by page number.
- One-click expand/collapse for annotation groups.
- Custom annotation sorting with drag-and-drop reordering.
- Text annotations for PDF.
- Annotation type filters for PDF, including ink and shape annotations.
- Drag-and-drop repositioning for PDF annotations.

**Improved**

- Preserved table-of-contents expansion state more reliably when switching views.
- Improved cross-page annotation behavior.
- Persisted PDF toolbar settings.
- Improved PDF annotation rerendering when pages change.
- Reduced PDF rendering flicker.
- Improved annotation position binding after window resize and page zoom changes.

**Changed**

- Removed automatic rating when importing books.

---

### v0.9.2 (2026.3.12)

**✨ New Features**

- **🔄 License Recovery** - Authorized accounts can quickly activate without re-entering activation code, just click "Recover License"

**📚 Drag & Drop Operations**
- **Drag to Add** - Drag files directly to bookshelf to add books, supports batch import
- **Drag to Group** - Drag books to group folders for quick organization
- **Visual Feedback** - Highlight display during dragging, intuitive and smooth operation

**🐛 Bug Fixes**

- **✅ Bookmark Operation** - Fixed bookmark toggle issue when clicking again (TOC and bottom toolbar)
- **✅ Keyboard Shortcut Conflict** - Fixed keyboard shortcuts triggering simultaneously in split-screen readers
- **✅ TXT Import** - Fixed slow TXT import conversion failure issue
- **✅ Progress Save** - Fixed progress save failure when opening multiple books
- **✅ PDF Color** - Fixed PDF color illustrations not displaying colors issue [#22](https://github.com/mm-o/siyuan-sireader/issues/22)
- **✅ Memory Leak** - Fixed potential memory leak from frequent database read/write operations with multiple books
- **✅ Annotation Display** - Fixed annotation content truncation issue when content is too long [#20](https://github.com/mm-o/siyuan-sireader/issues/20)

**⚙️ Improvements**

- **📚 Batch Import** - Optimized batch import logic methods to improve import efficiency
- **🔤 Encoding Detection** - Improved TXT encoding detection for better accuracy
- **📖 Status Logic** - Manual "finished" status won't be overridden by progress updates
- **🎨 License Interface** - Unified license panel layout and styling for better user experience

---

### v0.9.1 (2026.3.8)

**🎊 Membership System Launch**
- Website: [sireader.745201.xyz](https://sireader.745201.xyz)
- Authorization: Trial (7 days)/Monthly/Annual/Lifetime membership
- Online Activation: Enter activation code to activate, view status and remaining days
- Feature Tiers: Different features based on membership level
- **🎁 Limited Time Offer**: Lifetime membership ~~¥128~~ **¥108** (Until May 5th)

**🐛 Bug Fixes**
- Fixed bookshelf initialization failure due to lax file validation during database loading
- Fixed PDF text selection drift when dragging to annotated areas
- Fixed PDF cross-page text selection drift in blank areas

**⚙️ Improvements**
- Optimized reading control bar search and annotation menu display
- Search and annotation popups are mutually exclusive to avoid overlap
- Toolbar and secondary menu share opacity settings with responsive updates

---

## 📋 Complete Feature List

| Module | Feature | Description |
|--------|---------|-------------|
| **📚 Reading** | Format Support | EPUB/PDF/TXT/Online novels |
| | Themes | 8 preset themes (Default/Almond/Autumn/Green/Blue/Night/Dark/Gold) + Custom |
| | Reading Modes | Single/Double page/Continuous scroll |
| | Page Animation | Slide/Scroll/None |
| | Open Mode | New tab/Right tab/Bottom tab/New window |
| | Navigation Position | Left/Right/Top/Bottom, Custom modules and sorting |
| | TOC Navigation | TOC/Bookmarks/Marks, Search chapters, Reverse, Jump |
| | Footnote Recognition | Auto-recognize footnotes/endnotes/references/terms, Click to popup |
| | Text Settings | Font/Size/Letter spacing/Line height/Paragraph spacing/Text indent |
| | Layout Settings | Horizontal margin/Vertical margin/Column gap/Header footer height/Max content width |
| | Visual Enhancement | Brightness/Contrast/Sepia/Saturation/Invert |
| | Reading Statistics | Session/Daily/Total time, Reading calendar, Book distribution, Favorite books, Rating distribution, Format distribution |
| | PDF Toolbar | Zoom/Rotate/Search/Print/First page/Last page, Floating/Fixed style, Opacity adjustment |
| | Bottom Toolbar | TOC/Previous/Next/Settings/Search |
| | Full-text Search | Search book content, Highlight results, Jump support |
| **🖊️ Annotation** | Colors | 7 colors (Red🔴Orange🟠Yellow🟡Green🟢Pink🩷Blue🔵Purple🟣) |
| | Styles | Highlight/Underline/Border/Wavy |
| | Quick Annotate | Select color and style in toolbar, Select text to annotate |
| | PDF Advanced | Ink annotation, Shape annotation (Rectangle/Circle/Triangle), Fill function |
| | Note System | Add detailed notes, Real-time editing, Add tags |
| | Bookmarks | Add/Remove bookmarks, Bookmark list management |
| | Line Notes | Add line-level notes to paragraphs |
| | Annotation Management | Filter by color/chapter, Sort by time/date/chapter, Delete annotations |
| | Quick Send | Configure quick document list (max 5), One-click send annotations |
| | Auto Sync | Auto-sync annotations to bound SiYuan documents (Add/Delete/Modify) |
| | Undo Annotation | Ctrl+Z to undo recent annotation |
| | Copy Settings | Custom link format, Variables: Title/Author/Chapter/Position/Link/Text/Note/Screenshot |
| | Precise Location | Use CFI/Page number for precise positioning, Jump to original text |
| **🔊 TTS** | TTS Mode | Edge TTS (Online free), Local browser (Offline) |
| | Multi-voice | Hundreds of online and local voices, Favorite commonly used voices |
| | Smart Playback | Loop selected text, Play from selected paragraph, Play from current page, Read selected text |
| | Precise Highlighting | PDF highlights current text precisely, EPUB auto-scrolls to current paragraph |
| | Playback Control | Pause/Resume, Fast forward/backward 10s, Auto page turn, Auto stop |
| | Voice Parameters | Speed/Volume/Pitch adjustment |
| | Playback Options | Auto play, Highlight reading text, Auto page turn |
| **📚 Bookshelf** | Group Management | Folder groups, Smart groups (Auto-filter by tags/format/status/rating) |
| | Sorting | Recent read/Added time/Reading progress/Rating/Duration/Title/Author/Recent update |
| | View Modes | Grid/List/Compact |
| | Multi-filter | Status/Rating/Format/Tags/Update status |
| | Book Management | Edit book info (Title/Author/Cover/Rating/Status/Tags), Remove books |
| | Document Binding | Bind SiYuan documents, Auto-sync annotations |
| | Batch Operations | Batch convert EPUB styles, Batch adjust width |
| | Interface Settings | Cover size adjustment (80-160px), Toolbar opacity adjustment |
| | Update Check | Check online book updates |
| | Add Books | Local files (EPUB/PDF/TXT), HTTP(S) links, Absolute/Relative paths |
| **🔍 Search** | Online Sources | Multi-source concurrent search, Built-in Anna's Archive/Project Gutenberg/Standard Ebooks |
| | Custom Sources | Support JSONPath/CSS/XPath/JavaScript/Regex |
| | Rule Combination | Support `&&`/`||`/`%%` combination, `{$.path}` nesting, `@put/@get` data sharing |
| | Source Management | Import/Export/Enable/Disable/Edit/Delete sources |
| | Format Filter | Filter search results by format |
| | Quick Add | One-click add search results to bookshelf |
| | Chapter Search | Search book chapter content |
| **🎴 Flashcard** | Anki Import | Full .apkg file import, Preserve deck structure and card content |
| | SiYuan Sync | Import SiYuan flashcards, Real-time bidirectional sync (Add/Delete/Modify auto-sync) |
| | FSRS Algorithm | Advanced memory algorithm, Auto-calculate card stability and difficulty |
| | Template Editing | View and edit deck templates (Front/Back/CSS), Real-time preview |
| | Advanced Search | Support deck/tag/status/property multi-filter |
| | Special Cards | Image occlusion, LaTeX formula rendering, Cloze support |
| | Spaced Repetition | Four-level rating system, Smart learning queue, Custom learning steps |
| | Data Statistics | 11 visualization charts: Ring/Line/Bubble/Radar/Heatmap charts |
| | Comprehensive Settings | 30+ configurable parameters, Daily limits, Learning steps, Advanced options |
| **📖 Dictionary** | Online Dictionaries | 7 sources (Cambridge/Youdao/Haici/Character/Phrase/Zdic/Bing) |
| | Offline Dictionary | Support StarDict and dictd formats |
| | Smart Recognition | Auto-select the most suitable dictionary |
| | Dictionary Management | Add/Delete offline dictionaries |
| | Add to Deck | Add words to deck for review |
| **🌐 Translation** | Translation Services | Azure/Google/Yandex/AI Translation(Free)/AI Translation(SiYuan) |
| | Selected Translation | Translate selected text directly |
| | Translation Panel | Independent translation panel to display results |
| **⚙️ Others** | Authorization System | Trial/Monthly/Annual/Lifetime membership |
| | Shortcuts | Custom shortcuts (Previous/Next/Bookmark/PDF operations, etc.) |
| | Data Management | Managed book files, records, and settings storage |
| | Mobile Support | Support PDF reading (EPUB/TXT not supported yet) |

---

## 💎 Membership Features

### Feature Comparison

| Category | Feature | 🆓 Free | ⭐ Trial | 💎 Monthly | 👑 Annual | 🏆 Lifetime |
|----------|---------|---------|---------|-----------|----------|-----------|
| **📚 Reading** | Format Support | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Themes | Default | 8 + Custom | 8 + Custom | 8 + Custom | 8 + Custom |
| | Reading Modes | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Page Animation | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Text Settings | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Layout Settings | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Visual Enhancement | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Statistics | Simple | Full | Full | Full | Full |
| | TOC Navigation | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Footnote Recognition | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Full-text Search | ✓ | ✓ | ✓ | ✓ | ✓ |
| | PDF Toolbar | ✓ | ✓ | ✓ | ✓ | ✓ |
| **🖊️ Annotation** | Colors | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Styles | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Quick Annotate | - | - | - | ✓ | ✓ |
| | PDF Advanced | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Note System | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Bookmarks | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Line Notes | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Management | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Quick Send | - | - | - | ✓ | ✓ |
| | Auto-sync SiYuan | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Undo | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Custom Link Format | ✓ | ✓ | ✓ | ✓ | ✓ |
| **🔊 TTS** | TTS Function | - | ✓ | ✓ | ✓ | ✓ |
| | Online Voices | - | - | ✓ | ✓ | ✓ |
| | Local Voices | - | ✓ | ✓ | ✓ | ✓ |
| | Smart Playback | - | ✓ | ✓ | ✓ | ✓ |
| | Selected Text | - | ✓ | ✓ | ✓ | ✓ |
| | Precise Highlighting | - | ✓ | ✓ | ✓ | ✓ |
| | Playback Control | - | ✓ | ✓ | ✓ | ✓ |
| | Voice Parameters | - | ✓ | ✓ | ✓ | ✓ |
| **📚 Bookshelf** | Basic | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Folder Groups | - | ✓ | ✓ | ✓ | ✓ |
| | Smart Groups | - | - | ✓ | ✓ | ✓ |
| | Assets Sync | - | - | ✓ | ✓ | ✓ |
| | Sorting | ✓ | ✓ | ✓ | ✓ | ✓ |
| | View Modes | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Multi-filter | ✓ | ✓ | ✓ | ✓ | ✓ |
| | View Book Info | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Edit Book Info | - | ✓ | ✓ | ✓ | ✓ |
| | Document Binding | - | ✓ | ✓ | ✓ | ✓ |
| | Batch Operations | - | ✓ | ✓ | ✓ | ✓ |
| | Add Methods | Local files | Local/Link/Path | Local/Link/Path | Local/Link/Path | Local/Link/Path |
| **🔍 Search** | Online Sources | - | - | ✓ | ✓ | ✓ |
| | Custom Sources | - | - | ✓ | ✓ | ✓ |
| | Source Management | - | - | ✓ | ✓ | ✓ |
| | Format Filter | - | - | ✓ | ✓ | ✓ |
| | Chapter Search | - | - | ✓ | ✓ | ✓ |
| **🎴 Flashcard** | Basic | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Anki Import | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Spaced Repetition | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Deck Management | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Learning Settings | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Statistics Charts | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Template Editing | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Advanced Search | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Special Cards | ✓ | ✓ | ✓ | ✓ | ✓ |
| | SiYuan Sync | - | - | ✓ | ✓ | ✓ |
| | FSRS Algorithm | - | - | - | ✓ | ✓ |
| **📖 Dictionary** | Online | 2 (Youdao/Bing) | All 7 | All 7 | All 7 | All 7 |
| | Offline | - | ✓ | ✓ | ✓ | ✓ |
| | Smart Recognition | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Management | - | ✓ | ✓ | ✓ | ✓ |
| | Add to Deck | - | ✓ | ✓ | ✓ | ✓ |
| **🌐 Translation** | Services | - | ✓ | ✓ | ✓ | ✓ |
| | Selected Text | - | ✓ | ✓ | ✓ | ✓ |
| **⚙️ Others** | Custom Shortcuts | - | ✓ | ✓ | ✓ | ✓ |
| | Data Management | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Mobile Support | PDF | PDF | PDF | PDF | PDF |
| | Technical Support | Community | Community | Priority | Priority | Highest |
| | New Features | - | - | - | Priority | Highest Priority |
| | Updates | Free | Free | Free | Free | Lifetime Free |

### Membership Tiers

**🆓 Free** - Basic reading + Full annotation + Full flashcard  
**⭐ Trial (7 days)** - Full features (except Quick annotate/Quick send/Online search/SiYuan sync/FSRS)  
**💎 Monthly** - Full features (except Quick annotate/Quick send/FSRS)  
**👑 Annual** - Full features + Quick annotate + Quick send + FSRS + Priority support  
**🏆 Lifetime** - All features + Lifetime updates + Highest priority

---

## 💡 Tips

### Reading Tips
- **Theme Switch** - Use Default/Almond in daytime, Night/Dark at night
- **Shortcuts** - ← → for page turn, Space for page turn, PageUp/Down for page turn

### Annotation Tips
- **Color Classification** - Red for core concepts, Yellow for general points, Green for positive cases, Blue for supplementary, Purple for questions
- **Quick Annotate** - Select color in toolbar then select text to annotate, Ctrl+Z to undo

### Dictionary Tips
- **Quick Lookup** - Double-click to select and query
- **Offline Dictionary** - Download StarDict format dictionaries, Upload and use without network
- **Dictionary Sorting** - Adjust order in dictionary management, Prioritize frequently used dictionaries

### PDF Tips
- **PDF Shortcuts** - T for text selection, H for hand tool, I for ink annotation, S for shape annotation, Ctrl+wheel to zoom
- **Ink Annotation** - Suitable for handwritten notes and highlighting
- **Shape Annotation** - Rectangle selection, Circle marking, Triangle indication
- **Toolbar Drag** - Long press toolbar button to drag position

---

## ❓ FAQ

**Q: Can't open EPUB file?**  
A: Check if the file format is standard EPUB and not corrupted

**Q: Annotations not saved?**  
A: Check if notebook or parent document is correctly configured in annotation settings

**Q: Dictionary not responding?**  
A: Check network connection, some dictionaries require internet

**Q: AI translation failed?**  
A: SiYuan AI requires OpenAI API configuration in Settings → AI, or use "AI Translation (Free)" option

**Q: Offline dictionary not working?**  
A: Ensure complete dictionary files (.ifo/.idx/.dict.dz or .index/.dict.dz) are uploaded and enabled in dictionary management

**Q: Theme switch not working?**  
A: Refresh reader page or reopen the file

**Q: PDF annotations misaligned?**  
A: Try rescaling or rotating the page, annotations will auto re-render

---

## 🙏 Acknowledgments

- [SiYuan](https://github.com/siyuan-note/siyuan) - Excellent plugin development framework
- [Foliate.js](https://github.com/johnfactotum/foliate-js) - Powerful EPUB rendering engine
- [PDF.js](https://github.com/mozilla/pdf.js) - Mozilla's PDF rendering engine

---

## 📄 License

This project is licensed under the [MIT](LICENSE) License

---

<div align="center">

**Development Philosophy**: Simple · Efficient · Elegant · Perfect

Made with ❤️ by SiReader Team

</div>
