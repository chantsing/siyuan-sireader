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
            <span class="sr-bar" :style="{ background: getBarColor(mark) }"></span>
            <div class="sr-main">
              <div class="sr-head">
                <div v-if="mark.chapter && markSort === 'time'" class="sr-chapter">{{ mark.chapter }}</div>
                <div v-if="showTime(mark)" class="sr-time">{{ formatTime(mark.timestamp || Date.now()) }}</div>
                <button v-if="isVisualGroup(mark)" class="sr-expand-btn b3-tooltips b3-tooltips__nw" :aria-label="isExpanded(mark) ? '收起' : '展开'" @click.stop="toggleExpand(mark)">
                  <svg><use :xlink:href="isExpanded(mark) ? '#iconUp' : '#iconDown'" /></svg>
                </button>
              </div>

              <div
                v-if="isEditing(mark)"
                class="sr-title"
                contenteditable
                @input="editText = ($event.target as HTMLElement).textContent || ''"
              >{{ editText }}</div>
              <div v-else class="sr-title" :class="{ 'sr-title-bookmark': isBookmark(mark) }" @click="isVisualGroup(mark) ? null : goTo(mark)">
                {{ mainText(mark) }}
                <span v-if="isVisualGroup(mark)" class="sr-meta">第 {{ mark.page }} 页 · {{ (mark.inks || mark.shapes).length }} 条</span>
              </div>

              <textarea v-if="isEditing(mark)" ref="editNoteRef" v-model="editNote" placeholder="添加笔记…" class="sr-note-input" />
              <div v-else-if="mark.note" class="sr-note" @click.stop="startEdit(mark)">{{ mark.note }}</div>

              <canvas v-if="mark.type === 'ink-group'" :data-page="mark.page" class="sr-preview sr-group-preview" width="240" height="80"></canvas>

              <template v-if="isEditing(mark) && showEditOptions(mark)">
                <div class="sr-options">
                  <div class="sr-colors">
                    <button
                      v-for="color in getEditColorOptions(mark.type === 'shape')"
                      :key="color.key"
                      class="sr-color-btn"
                      :class="{ active: editColor === color.value }"
                      :style="{ background: color.bg }"
                      @click.stop="editColor = color.value"
                    />
                  </div>
                  <div v-if="mark.type === 'shape'" class="sr-styles">
                    <button
                      v-for="shape in shapeOptions"
                      :key="shape.type"
                      class="sr-style-btn"
                      :class="{ active: editShapeType === shape.type }"
                      :title="shape.label"
                      @click.stop="editShapeType = shape.type"
                    >
                      <svg><use :xlink:href="shape.icon" /></svg>
                    </button>
                  </div>
                  <div v-else class="sr-styles">
                    <button
                      v-for="style in STYLES.filter(item => !item.pdfOnly || isPdfMode)"
                      :key="style.type"
                      class="sr-style-btn"
                      :class="{ active: editStyle === style.type }"
                      @click.stop="editStyle = style.type"
                    >
                      <span class="sr-style-icon" :data-type="style.type">{{ style.text }}</span>
                    </button>
                  </div>
                </div>
                <div class="sr-actions">
                  <button class="sr-btn-primary" @click.stop="saveEdit(mark)">保存</button>
                  <button class="sr-btn-secondary" @click.stop="cancelEdit">取消</button>
                </div>
              </template>

              <Transition name="expand">
                <div v-if="isExpanded(mark)" class="sr-sub-list">
                  <div v-for="sub in mark.inks || mark.shapes" :key="sub.id" class="sr-sub-item" :class="{ 'sr-card-edit': isEditing(sub) }">
                    <canvas v-if="mark.type === 'ink-group'" :data-ink-id="sub.id" class="sr-preview" width="240" height="40" @click.stop="isEditing(sub) ? null : goTo(sub)"></canvas>
                    <canvas v-else :data-shape-id="sub.id" class="sr-preview" width="240" height="40" @click.stop="isEditing(sub) ? null : goTo(sub)"></canvas>
                    <textarea v-if="isEditing(sub)" ref="editNoteRef" v-model="editNote" placeholder="添加笔记…" class="sr-note-input" />
                    <div v-else-if="sub.note" class="sr-note" @click.stop="startEdit(sub)">{{ sub.note }}</div>
                    <template v-if="isEditing(sub)">
                      <div class="sr-options">
                        <div class="sr-colors">
                          <button
                            v-for="color in getEditColorOptions(sub.type === 'shape')"
                            :key="color.key"
                            class="sr-color-btn"
                            :class="{ active: editColor === color.value }"
                            :style="{ background: color.bg }"
                            @click.stop="editColor = color.value"
                          />
                        </div>
                        <div v-if="sub.type === 'shape'" class="sr-styles">
                          <button
                            v-for="shape in shapeOptions"
                            :key="shape.type"
                            class="sr-style-btn"
                            :class="{ active: editShapeType === shape.type }"
                            :title="shape.label"
                            @click.stop="editShapeType = shape.type"
                          >
                            <svg><use :xlink:href="shape.icon" /></svg>
                          </button>
                        </div>
                      </div>
                      <div class="sr-actions">
                        <button class="sr-btn-primary" @click.stop="saveEdit(sub)">保存</button>
                        <button class="sr-btn-secondary" @click.stop="cancelEdit">取消</button>
                      </div>
                    </template>
                    <div v-else class="sr-btns">
                      <button v-if="mark.type === 'shape-group'" class="b3-tooltips b3-tooltips__nw" :aria-label="props.i18n?.copy || '复制'" @click.stop="copyMark(sub)"><svg><use xlink:href="#iconCopy" /></svg></button>
                      <button v-if="mark.type === 'shape-group'" class="b3-tooltips b3-tooltips__nw" :aria-label="props.i18n?.edit || '编辑'" @click.stop="startEdit(sub)"><svg><use xlink:href="#iconEdit" /></svg></button>
                      <button v-if="sub.blockId" class="b3-tooltips b3-tooltips__nw" aria-label="打开块" @click.stop="openBlock(sub.blockId)" @mouseenter="onBlockEnter($event, sub.blockId)" @mouseleave="hideFloat"><svg><use xlink:href="#iconRef" /></svg></button>
                      <button v-else class="b3-tooltips b3-tooltips__nw" :aria-label="props.i18n?.import || '导入'" @click.stop="importMark(sub)"><svg><use xlink:href="#iconDownload" /></svg></button>
                      <button class="b3-tooltips b3-tooltips__nw" :aria-label="props.i18n?.delete || '删除'" @click.stop="deleteMark(sub)"><svg><use xlink:href="#iconTrashcan" /></svg></button>
                    </div>
                  </div>
                </div>
              </Transition>

              <div v-if="!isEditing(mark)" class="sr-btns">
                <button v-if="canCopy(mark)" class="b3-tooltips b3-tooltips__nw" :aria-label="props.i18n?.copy || '复制'" @click.stop="copyMark(mark)"><svg><use xlink:href="#iconCopy" /></svg></button>
                <button v-if="canEdit(mark)" class="b3-tooltips b3-tooltips__nw" :aria-label="props.i18n?.edit || '编辑'" @click.stop="startEdit(mark)"><svg><use xlink:href="#iconEdit" /></svg></button>
                <button v-if="mark.blockId && !isBookmark(mark)" class="b3-tooltips b3-tooltips__nw" aria-label="打开块" @click.stop="openBlock(mark.blockId)" @mouseenter="onBlockEnter($event, mark.blockId)" @mouseleave="hideFloat"><svg><use xlink:href="#iconRef" /></svg></button>
                <button v-else-if="canImport(mark)" class="b3-tooltips b3-tooltips__nw" :aria-label="props.i18n?.import || '导入'" @click.stop="importMark(mark)"><svg><use xlink:href="#iconDownload" /></svg></button>
                <button class="b3-tooltips b3-tooltips__nw" :aria-label="props.i18n?.delete || '删除'" @click.stop="deleteMark(mark)"><svg><use xlink:href="#iconTrashcan" /></svg></button>
              </div>
            </div>
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
import DockShell from './ui/DockShell.vue'
import { formatTime } from '@/core/MarkManager'
import { useReaderMarks } from '@/composables/useReaderMarks'

const props = withDefaults(defineProps<{ i18n?: any }>(), { i18n: () => ({}) })

const {
  MARK_SORT_OPTIONS,
  STYLES,
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
  markSort,
  showTime,
  isVisualGroup,
  isExpanded,
  toggleExpand,
  isEditing,
  editText,
  editNote,
  editNoteRef,
  startEdit,
  cancelEdit,
  showEditOptions,
  getEditColorOptions,
  editColor,
  shapeOptions,
  editShapeType,
  editStyle,
  isPdfMode,
  saveEdit,
  mainText,
  copyMark,
  canCopy,
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
  goTo,
} = useReaderMarks(props.i18n)
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
.sr-card{display:flex;gap:10px;padding:10px 8px;margin-bottom:6px;border:1px solid var(--b3-border-color);border-radius:10px;box-shadow:none;background:transparent;position:relative}
.sr-card:hover{background:var(--b3-list-hover)}
.sr-card-drag{cursor:grab}
.sr-card.is-dragging{opacity:.45}
.sr-card.is-drag-over{border-color:var(--b3-theme-primary);box-shadow:0 0 0 1px var(--b3-theme-primary) inset}
.sr-group{align-items:center;cursor:pointer;border-radius:10px;box-shadow:none;background:transparent}
.sr-group-content{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:1;min-width:0}
.sr-group-title,.sr-group-count{font-size:15px;line-height:1.35;font-weight:600}
.sr-group-count{opacity:.6}
.sr-bar{width:4px;border-radius:999px;background:var(--b3-theme-primary);flex-shrink:0}
.sr-bar.collapsed{opacity:.4}
.sr-main{flex:1;min-width:0}
.sr-head{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.sr-chapter{font-size:12px;font-weight:500;color:var(--b3-theme-primary);opacity:.85;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-time{font-size:11px;color:var(--b3-theme-on-surface-variant);opacity:.6;white-space:nowrap;flex-shrink:0}
.sr-title{font-size:13px;font-weight:600;line-height:1.5;word-break:break-word;cursor:pointer}
.sr-title-bookmark{color:var(--b3-theme-primary)}
.sr-note{font-size:12px;color:var(--b3-theme-on-surface-variant);line-height:1.5;margin-top:4px;font-style:italic;opacity:.85;cursor:text}
.sr-meta{margin-left:8px;font-size:11px;font-weight:400;color:var(--b3-theme-on-surface-variant)}
.sr-btns{display:flex;align-items:center;gap:4px;margin-top:8px}
.sr-btns button,.sr-expand-btn{display:flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:none;background:transparent;border-radius:6px;cursor:pointer}
.sr-btns button:hover,.sr-expand-btn:hover{background:var(--b3-list-hover)}
.sr-preview{width:100%;margin-top:8px;background:var(--b3-theme-background)}
.sr-group-preview{height:80px}
.sr-sub-list{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.sr-sub-item{padding:8px;border:1px solid var(--b3-border-color);border-radius:8px;box-shadow:none;background:transparent}
.sr-note-input{width:100%;min-height:72px;margin-top:8px;resize:vertical}
.sr-options{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.sr-colors,.sr-styles{display:flex;flex-wrap:wrap;gap:6px}
.sr-color-btn,.sr-style-btn{display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:1px solid var(--b3-border-color);background:var(--b3-theme-background);border-radius:8px;cursor:pointer}
.sr-color-btn.active,.sr-style-btn.active{border-color:var(--b3-theme-primary);box-shadow:0 0 0 1px var(--b3-theme-primary) inset}
.sr-style-btn svg{width:16px;height:16px}
.sr-style-icon{font-size:12px;font-weight:700}
.sr-actions{display:flex;gap:8px;margin-top:8px}
.sr-btn-primary,.sr-btn-secondary{height:28px;padding:0 10px;border:1px solid var(--b3-border-color);border-radius:8px;background:var(--b3-theme-background);cursor:pointer}
.sr-btn-primary{border-color:var(--b3-theme-primary);color:var(--b3-theme-primary)}
.fade-enter-active,.fade-leave-active{transition:opacity .2s}
.fade-enter-from,.fade-leave-to{opacity:0}
.expand-enter-active,.expand-leave-active{transition:all .2s ease}
.expand-enter-from,.expand-leave-to{opacity:0;max-height:0;overflow:hidden}
</style>
