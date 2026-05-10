# AGENTS.md

## Purpose

This repository is a SiYuan plugin named `siyuan-sireader` (`SiReader`).
It turns SiYuan into an ebook reader with annotation, bookshelf, PDF/EPUB/TXT reading, TTS, dictionary/translation, online sources, and flashcard/deck features.

Use this file as the first-stop summary before opening large files.

## Tech Stack

- Runtime: SiYuan plugin API
- Language: TypeScript
- UI: Vue 3 single-file components
- Build: Vite
- Storage: SiYuan plugin `loadData/saveData` plus files under `/public/siyuan-sireader`
- Local DB layer: custom `ReaderDatabase` abstraction in [`src/core/database.ts`](/e:/text/siyuan-sireader/src/core/database.ts)
- Flashcards: separate deck subsystem under [`src/components/deck`](/e:/text/siyuan-sireader/src/components/deck)

## Primary Entry Points

- Plugin lifecycle: [`src/index.ts`](/e:/text/siyuan-sireader/src/index.ts)
- App bootstrap and Vue mount: [`src/main.ts`](/e:/text/siyuan-sireader/src/main.ts)
- Root app shell: [`src/App.vue`](/e:/text/siyuan-sireader/src/App.vue)
- Main reader UI: [`src/components/Reader.vue`](/e:/text/siyuan-sireader/src/components/Reader.vue)
- Build config: [`vite.config.ts`](/e:/text/siyuan-sireader/vite.config.ts)
- Plugin manifest: [`plugin.json`](/e:/text/siyuan-sireader/plugin.json)

## High-Level Architecture

1. `src/index.ts`
   Initializes plugin environment flags, runs migration, mounts app, registers hotkeys, and enables deck autosync.
2. `src/main.ts`
   Stores the plugin singleton, initializes dictionary/mobile hooks, mounts the Vue app, and initializes deck database/pack logic.
3. `src/App.vue`
   Registers tabs, exposes `window.sireader` APIs, intercepts ebook links, and opens reader tabs.
4. `src/components/Reader.vue`
   Hosts the actual reading experience, including PDF toolbar, TOC, search, TTS, quick marking, and annotation panel.
5. `src/core/*`
   Contains reading engines, storage/database, bookshelf, PDF/EPUB/TXT logic, mark management, licensing, and online reading support.

## Directory Map

- [`src/components`](/e:/text/siyuan-sireader/src/components): Vue UI for reader, bookshelf, settings, search, stats, translate, annotations.
- [`src/components/deck`](/e:/text/siyuan-sireader/src/components/deck): flashcard/deck subsystem, with its own data layer and study logic.
- [`src/core`](/e:/text/siyuan-sireader/src/core): core logic.
- [`src/core/pdf`](/e:/text/siyuan-sireader/src/core/pdf): PDF viewer/search/annotation/ink/shape tooling.
- [`src/core/epub`](/e:/text/siyuan-sireader/src/core/epub): EPUB reader/search/types.
- [`src/core/txt`](/e:/text/siyuan-sireader/src/core/txt): TXT conversion/import helpers.
- [`src/core/online`](/e:/text/siyuan-sireader/src/core/online): online novel reading support.
- [`src/composables`](/e:/text/siyuan-sireader/src/composables): settings, stats, license, import hooks.
- [`src/services`](/e:/text/siyuan-sireader/src/services): TTS and translation services.
- [`src/utils`](/e:/text/siyuan-sireader/src/utils): helpers for copy, keyboard, jumping, sources, migration, mobile, book open/import flows.
- [`docs`](/e:/text/siyuan-sireader/docs): supplementary documentation.
- [`server`](/e:/text/siyuan-sireader/server): separate Cloudflare Worker based license service and admin panel, not needed for most plugin work.
- [`website`](/e:/text/siyuan-sireader/website): separate marketing/site assets, not part of plugin runtime.
- [`dist`](/e:/text/siyuan-sireader/dist): build output, do not hand-edit.

## Core Data Model

The plugin revolves around two main concepts:

- Books
  Stored/indexed via `ReaderDatabase` and managed by `BookshelfManager`.
- Annotations
  Includes highlights, notes, bookmarks, vocab, shapes, ink, and daily reading records.

Important files:

- Book and annotation schema/types: [`src/core/database.ts`](/e:/text/siyuan-sireader/src/core/database.ts)
- Bookshelf operations: [`src/core/bookshelf.ts`](/e:/text/siyuan-sireader/src/core/bookshelf.ts)
- Managed file storage helpers: [`src/core/bookStore.ts`](/e:/text/siyuan-sireader/src/core/bookStore.ts)

## Storage Model

There are two storage layers:

- Structured plugin data via `plugin.loadData/saveData/removeData`
  Keys include `bookshelf.json`, `settings.json`, `daily.json`, per-book records, and DB snapshots.
- Binary/public assets under `/public/siyuan-sireader`
  Used for stored book files and cover files.

Relevant code:

- [`src/core/bookStore.ts`](/e:/text/siyuan-sireader/src/core/bookStore.ts)
- [`src/core/database.ts`](/e:/text/siyuan-sireader/src/core/database.ts)
- [`src/utils/migration.ts`](/e:/text/siyuan-sireader/src/utils/migration.ts)

When modifying import/storage logic, preserve migration compatibility. Recent versions migrated managed files into `/public`.

## Reader Modes

The reader has multiple paths:

- EPUB-like flow via `src/core/epub`
- PDF flow via `src/core/pdf`
- TXT import/conversion via `src/core/txt`
- Online reading via `src/core/online`

Reader tab opening and activation logic is centralized in:

- [`src/utils/bookOpen.ts`](/e:/text/siyuan-sireader/src/utils/bookOpen.ts)

If a change affects opening behavior, check:

- bookshelf open
- document asset links
- `sireader://` custom links
- external calls through `window.sireader`

## Settings and Global State

- Settings composable: [`src/composables/useSetting.ts`](/e:/text/siyuan-sireader/src/composables/useSetting.ts)
- Stats composable: [`src/composables/useStats.ts`](/e:/text/siyuan-sireader/src/composables/useStats.ts)
- License composable: [`src/composables/useLicense.ts`](/e:/text/siyuan-sireader/src/composables/useLicense.ts)

Many UI behaviors depend directly on settings persistence. If you add a setting, verify:

- default value
- save/load
- UI binding
- runtime update behavior
- migration impact if old config shape changes

## Flashcard / Deck Subsystem

This is substantial and mostly separate from the reader core.

Start here:

- Deck exports: [`src/components/deck/index.ts`](/e:/text/siyuan-sireader/src/components/deck/index.ts)
- Deck DB: [`src/components/deck/database.ts`](/e:/text/siyuan-sireader/src/components/deck/database.ts)
- Pack logic: [`src/components/deck/pack.ts`](/e:/text/siyuan-sireader/src/components/deck/pack.ts)
- Study flow: [`src/components/deck/flash.ts`](/e:/text/siyuan-sireader/src/components/deck/flash.ts)
- FSRS logic: [`src/components/deck/fsrs.ts`](/e:/text/siyuan-sireader/src/components/deck/fsrs.ts)
- SiYuan sync hook: [`src/components/deck/siyuan-card.ts`](/e:/text/siyuan-sireader/src/components/deck/siyuan-card.ts)

Unless the task is deck-specific, avoid reading this subtree early because it is large.

## Build and Dev Commands

From repository root:

```powershell
pnpm build
pnpm dev
pnpm test
pnpm test:run
pnpm test:coverage
```

Notes:

- `pnpm dev` runs `vite build --watch`.
- In watch mode, output can target a SiYuan workspace plugin directory if `VITE_SIYUAN_WORKSPACE_PATH` is set in `.env`.
- Production build outputs to `dist/` and packs `package.zip`.

## Files Usually Safe to Ignore

- [`dist`](/e:/text/siyuan-sireader/dist): generated output
- [`node_modules`](/e:/text/siyuan-sireader/node_modules): dependencies
- [`package.zip`](/e:/text/siyuan-sireader/package.zip): generated package artifact
- [`server/.wrangler`](/e:/text/siyuan-sireader/server/.wrangler): worker cache

## Change Strategy

For most tasks, read in this order:

1. `AGENTS.md`
2. nearest entry point
3. directly referenced composable/core module
4. only then large UI/component files

Examples:

- Reader bug: `src/components/Reader.vue` -> `src/core/pdf/*` or `src/core/epub/*` -> `src/utils/jump.ts` / `src/utils/keyboard.ts`
- Import/open bug: `src/utils/bookOpen.ts` -> `src/core/bookshelf.ts` -> `src/core/bookStore.ts` / `src/utils/migration.ts`
- Settings bug: `src/composables/useSetting.ts` -> impacted component
- Annotation bug: `src/core/MarkManager.ts` -> `src/components/MarkPanel.vue` -> format-specific code
- Deck bug: `src/components/deck/index.ts` -> relevant deck module

## Risk Areas

- Storage and migration code: can break existing user libraries.
- Reader open-position logic: affects bookshelf, links, tabs, and resume behavior.
- PDF annotation code: tightly coupled with rendering and page state.
- Settings persistence: many features assume immediate runtime sync.
- License gating: some features intentionally depend on `useLicense`.
- Mobile behavior: mobile sidebar and reader behavior are partially separate from desktop.

## Conventions Observed

- Alias `@` points to `src/`.
- Many modules are lazily imported to reduce startup cost.
- Plugin-global access is provided through `usePlugin()`.
- Cleanup hooks are registered through `registerCleanup()`.
- Runtime events are used for hotkeys and reader actions, for example `sireader:*` custom events.

## Non-Plugin Subprojects

- `server/` is a standalone license backend/admin project using Cloudflare Workers, D1, and R2.
- `website/` is a standalone static website.

Do not assume changes in those folders affect plugin runtime unless the user explicitly asks for license or website work.

## Practical Advice for Future Agents

- Prefer targeted reads with `rg` before opening large files.
- Avoid opening `Reader.vue` and deck files unless the task clearly touches them; they are among the largest/highest-context files.
- If a task mentions import, migration, managed files, or `/public`, inspect `bookStore.ts` and `migration.ts` early.
- If a task mentions "cannot open book", inspect `bookOpen.ts`, `bookshelf.ts`, and the format-specific core module together.
- Preserve backward compatibility for stored data whenever possible.
