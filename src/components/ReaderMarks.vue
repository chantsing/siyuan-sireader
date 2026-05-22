<template>
  <DockShell
    class="sr-marks"
    body-class="sr-body-pad-8"
    v-model:search-value="keyword"
    :search-placeholder="searchPlaceholder"
    :toolbar-menu-action="toolbarMenuAction"
    :toolbar-actions="toolbarActions"
    toolbar-tooltip-dir="sw"
    @click="showOrganize = false"
    @toolbar-action="handleToolbarAction"
  >
    <div class="sr-list">
      <div v-if="!list.length" class="sr-empty">{{ emptyText }}</div>
      <template v-else v-for="(item, i) in list" :key="item.key || item.groupId || item.id || item.page || i">
        <div v-if="item.isGroup" class="sr-card sr-group" @click="toggleGroup(item.key)">
          <span class="sr-bar" :class="{ collapsed: isCollapsed(item.key) }"></span>
          <div class="sr-group-content">
            <span class="sr-group-title">{{ item.key }}</span>
            <span class="sr-group-count">{{ item.items.length }}</span>
          </div>
        </div>
        <template v-for="(mark, index) in getMarkItems(item)" :key="mark?.id || index">
          <div
            class="sr-card"
            :class="{ 'sr-card-edit': isEditing(mark), 'sr-card-drag': canDragMarks, 'is-dragging': dragState.from === getDragKey(mark), 'is-drag-over': dragState.over === getDragKey(mark) }"
            :draggable="canDragMarks"
            @dragstart="startMarkDrag($event, mark)"
            @dragenter.prevent="dragState.over = getDragKey(mark)"
            @dragover.prevent
            @drop.prevent="dropMark(mark)"
            @dragend="endMarkDrag()"
          >
            <MarkCard
              :time="formatDateTime(mark.timestamp || Date.now())"
              :tags="getMarkTags(mark)"
              :tag-options="markTagOptions"
              :selected-tags="editTagList"
              :tag-input="editTags"
              :editing="isEditing(mark)"
              :editable="canEdit(mark)"
              :text="isEditing(mark) ? editText : mainText(mark)"
              :chapter="isEditing(mark) ? '' : mark.chapter"
              :note="isEditing(mark) ? editNote : mark.note"
              :mark-color="getBarColor(mark)"
              :color-value="editColor"
              :color-options="isEditing(mark) && showEditOptions(mark) ? getEditColorOptions(mark.type === 'shape') : []"
              :bookmark="isBookmark(mark)"
              @update:tag-input="editTags = $event"
              @update:text="editText = $event"
              @update:note="editNote = $event"
              @update:color-value="editColor = $event"
              @toggle-tag="toggleEditTag"
              @go="isVisualGroup(mark) ? null : goTo(mark)"
              @edit="startEdit(mark)"
              @cancel="cancelEdit"
              @save="saveEdit(mark)"
            >
              <template #actions>
                <div v-if="!isVisualGroup(mark)" class="sr-head-actions">
                  <button class="b3-tooltips b3-tooltips__nw" :aria-label="props.i18n?.copy || '复制'" @click.stop="copyMark(mark)"><svg><use xlink:href="#iconCopy" /></svg></button>
                  <button v-if="mark.blockId && !isBookmark(mark)" class="b3-tooltips b3-tooltips__nw" aria-label="打开块" @click.stop="openBlock(mark.blockId)" @mouseenter="onBlockEnter($event, mark.blockId)" @mouseleave="hideFloat"><svg><use xlink:href="#iconRef" /></svg></button>
                  <button v-else-if="canImport(mark)" class="b3-tooltips b3-tooltips__nw" :aria-label="props.i18n?.import || '导入'" @click.stop="importMark(mark)"><svg><use xlink:href="#iconDownload" /></svg></button>
                  <button class="b3-tooltips b3-tooltips__nw" :aria-label="props.i18n?.delete || '删除'" @click.stop="deleteMark(mark)"><svg><use xlink:href="#iconTrashcan" /></svg></button>
                </div>
                <button v-if="isVisualGroup(mark)" class="sr-expand-btn b3-tooltips b3-tooltips__nw" :aria-label="isExpanded(mark) ? '收起' : '展开'" @click.stop="toggleExpand(mark)">
                  <svg><use :xlink:href="isExpanded(mark) ? '#iconUp' : '#iconDown'" /></svg>
                </button>
              </template>
              <template #meta>
                <span v-if="isVisualGroup(mark)" class="sr-meta">第 {{ mark.page }} 页 · {{ (mark.inks || mark.shapes).length }} 条</span>
              </template>
              <template #extra>
                <canvas v-if="mark.type === 'ink-group'" :data-page="mark.page" class="sr-preview sr-group-preview" width="240" height="80"></canvas>

                <Transition name="expand">
                  <div v-if="isExpanded(mark)" class="sr-sub-list">
                    <div v-for="sub in mark.inks || mark.shapes" :key="sub.id" class="sr-sub-item">
                      <canvas v-if="mark.type === 'ink-group'" :data-ink-id="sub.id" class="sr-preview" width="240" height="40" @click.stop="goTo(sub)"></canvas>
                      <canvas v-else :data-shape-id="sub.id" class="sr-preview" width="240" height="40" @click.stop="goTo(sub)"></canvas>
                    </div>
                  </div>
                </Transition>
              </template>
            </MarkCard>
          </div>
        </template>
      </template>
    </div>

    <template #overlay>
      <Transition name="fade">
        <div v-if="showOrganize" class="sr-manage-panel" @click.stop>
          <header class="sr-modal__head">
            <span>筛选标注</span>
            <span class="block__icon block__icon--show sr-icon-btn" aria-label="关闭" @click="showOrganize = false"><svg><use xlink:href="#lucide-x" /></svg></span>
          </header>
          <div class="sr-modal__body">
            <label class="sr-form-item">
              <span class="ft__secondary">排序</span>
              <div class="sr-chips">
                <button v-for="opt in MARK_SORT_OPTIONS" :key="opt.value" class="sr-chip" :class="{ 'is-active': markFilter.sort === opt.value }" type="button" @click="markFilter.sort = opt.value">
                  {{ opt.label }}
                </button>
              </div>
              <div class="sr-chips">
                <button class="sr-chip" :class="{ 'is-active': markReverse }" type="button" @click="markReverse = !markReverse">反向排序</button>
              </div>
            </label>

            <label v-for="section in markFilterSections" :key="section.key" class="sr-form-item">
              <span class="ft__secondary">{{ section.label }}</span>
              <div class="sr-chips">
                <button
                  v-for="opt in section.options"
                  :key="`${section.key}-${opt.value}`"
                  class="sr-chip"
                  :class="{ 'is-active': isMarkFilterActive(section.key, opt.value) }"
                  type="button"
                  @click="toggleMarkFilterItem(section.key, opt.value)"
                >
                  {{ opt.label }}<template v-if="opt.count !== undefined"> ({{ opt.count }})</template>
                </button>
              </div>
            </label>

            <div class="sr-row sr-actions-end sr-section-line">
              <button class="b3-button b3-button--outline" type="button" @click="resetMarkOrganize">重置筛选</button>
              <button class="b3-button b3-button--outline" type="button" @click="showOrganize = false">完成</button>
            </div>
          </div>
        </div>
      </Transition>
    </template>
  </DockShell>
</template>

<script setup lang="ts">
import MarkCard from './MarkCard.vue'
import DockShell from './ui/DockShell.vue'
import { useReaderMarks } from '@/composables/useReaderMarks'

const props = withDefaults(defineProps<{ i18n?: any }>(), { i18n: () => ({}) })

const {
  MARK_SORT_OPTIONS,
  keyword,
  searchPlaceholder,
  toolbarMenuAction,
  toolbarActions,
  handleToolbarAction,
  showOrganize,
  list,
  emptyText,
  toggleGroup,
  isCollapsed,
  getMarkItems,
  canDragMarks,
  dragState,
  getDragKey,
  startMarkDrag,
  dropMark,
  endMarkDrag,
  getBarColor,
  isVisualGroup,
  isExpanded,
  toggleExpand,
  isEditing,
  editText,
  editNote,
  editTags,
  editTagList,
  startEdit,
  cancelEdit,
  showEditOptions,
  getEditColorOptions,
  editColor,
  markTagOptions,
  toggleEditTag,
  saveEdit,
  mainText,
  copyMark,
  canEdit,
  isBookmark,
  openBlock,
  onBlockEnter,
  hideFloat,
  canImport,
  importMark,
  deleteMark,
  markFilter,
  markReverse,
  markFilterSections,
  isMarkFilterActive,
  toggleMarkFilterItem,
  resetMarkOrganize,
  getMarkTags,
  goTo,
} = useReaderMarks(props.i18n)
const formatDateTime = (ts: number) => new Date(ts).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
</script>

<style scoped lang="scss">
.sr-marks{display:flex;flex-direction:column;height:100%;overflow:hidden;background:var(--b3-theme-background)}
.sr-list{height:100%;overflow:auto}
.sr-empty{display:flex;align-items:center;justify-content:center;height:100%;font-size:14px;opacity:.5}
.sr-manage-panel{position:absolute;top:44px;left:8px;right:8px;z-index:20;max-height:calc(100% - 56px);overflow:auto;padding:12px;background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);border-radius:10px;box-shadow:0 8px 24px #0002;box-sizing:border-box}
.sr-modal__head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding-bottom:12px;border-bottom:1px solid var(--b3-border-color);font-size:13px;font-weight:600}
.sr-modal__body{display:flex;flex-direction:column;gap:12px;padding-top:12px;box-sizing:border-box}
.sr-form-item{display:flex;flex-direction:column;gap:4px;padding-bottom:12px;border-bottom:1px solid var(--b3-border-color);font-size:12px}
.sr-form-item:last-child{border-bottom:none}
.sr-chips{display:flex;flex-wrap:wrap;gap:6px}
.sr-chip{display:inline-flex;align-items:center;justify-content:center;padding:3px 8px;border:1px solid var(--b3-border-color);border-radius:999px;background:var(--b3-theme-background);color:var(--b3-theme-on-surface);font-size:11px;font-weight:600;line-height:1.2;white-space:nowrap;cursor:pointer}
.sr-chip:hover{background:var(--b3-list-hover)}
.sr-chip.is-active{border-color:var(--b3-theme-primary);background:var(--b3-theme-primary-lightest);color:var(--b3-theme-primary)}
.sr-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.sr-actions-end{justify-content:flex-end}
.sr-section-line{padding-top:12px;border-top:1px solid var(--b3-border-color)}
.sr-card{--sr-gap:4px;--sr-line:19px;display:flex;gap:var(--sr-gap);padding:6px;margin-bottom:6px;border:1px solid #d8d8d8;border-radius:8px;background:#fff;position:relative;transform:none!important;box-shadow:none!important;transition:border-color .15s,background-color .15s}
.sr-card:hover{border-color:#9fb0c1;background:#fbfdff;transform:none!important;box-shadow:none!important}
.sr-card-drag{cursor:grab}
.sr-card.is-dragging{opacity:.45}
.sr-card.is-drag-over{border-color:var(--b3-theme-primary);box-shadow:0 0 0 1px var(--b3-theme-primary) inset}
.sr-group{align-items:center;cursor:pointer;border-radius:10px;background:transparent}
.sr-group-content{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:1;min-width:0}
.sr-group-title,.sr-group-count{font-size:15px;line-height:1.35;font-weight:600}
.sr-group-count{opacity:.6}
.sr-bar{width:4px;border-radius:999px;background:var(--b3-theme-primary);flex-shrink:0}
.sr-bar.collapsed{opacity:.4}
.sr-head-actions{display:flex;align-items:center;gap:4px;flex-shrink:0}
.sr-head-actions button,.sr-expand-btn{display:flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:none;background:transparent;border-radius:4px;line-height:1;cursor:pointer;color:#8a8a8a}
.sr-head-actions button:hover,.sr-expand-btn:hover{background:#f4f4f4;color:#555}
.sr-head-actions svg{width:14px;height:14px}
.sr-meta{margin-left:8px;font-size:11px;font-weight:400;color:var(--b3-theme-on-surface-variant)}
.sr-preview{width:100%;background:var(--b3-theme-background)}
.sr-group-preview{height:80px}
.sr-sub-list{display:flex;flex-direction:column;gap:var(--sr-gap)}
.sr-sub-item{padding:6px;border:1px solid #e2e2e2;border-radius:6px;box-shadow:none;background:#fafafa}
.fade-enter-active,.fade-leave-active{transition:opacity .2s}
.fade-enter-from,.fade-leave-to{opacity:0}
.expand-enter-active,.expand-leave-active{transition:all .2s ease}
.expand-enter-from,.expand-leave-to{opacity:0;max-height:0;overflow:hidden}
</style>
