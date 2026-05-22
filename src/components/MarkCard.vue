<template>
  <div class="sr-main" @click="!editing && emit('go')">
    <div class="sr-head">
      <div class="sr-time">{{ time }}</div>
      <slot name="actions" />
    </div>

    <div v-if="editing || tags.length" class="sr-tag-list" :class="{ 'sr-tag-editor': editing }">
      <template v-if="editing">
        <input
          :value="tagInput"
          class="sr-tag-input-inline"
      placeholder="输入标签，逗号分隔；下方点击选择"
          @click.stop
          @mousedown.stop
          @pointerdown.stop
          @input="emit('update:tagInput', ($event.target as HTMLInputElement).value)"
        />
        <div v-if="tagOptions.length" class="sr-tag-options">
          <button
            v-for="tag in tagOptions"
            :key="tag"
            class="sr-tag-chip"
            :class="{ active: selectedTags.includes(tag) }"
            @click.stop="emit('toggle-tag', tag)"
          >#{{ tag }}</button>
        </div>
      </template>
      <span v-else v-for="tag in tags" :key="tag" class="sr-tag-chip">#{{ tag }}</span>
    </div>

    <div v-if="editing" class="sr-title-edit">
      <div v-if="colorOptions.length" class="sr-color-picker">
        <button
          v-for="color in colorOptions"
          :key="color.key"
          class="sr-color-swatch"
          :class="{ active: colorValue === color.value }"
          :style="{ background: color.bg }"
          @click.stop="emit('update:colorValue', color.value)"
        />
      </div>
      <div
        class="sr-title"
        contenteditable
        :style="{ '--mark-color': markColor }"
        @input="emit('update:text', ($event.target as HTMLElement).textContent || '')"
      >{{ text }}</div>
    </div>
    <div v-else class="sr-title" :class="{ 'sr-title-bookmark': bookmark }" :style="{ '--mark-color': markColor }">
      <div v-if="chapter" class="sr-inline-chapter">{{ chapter }}</div>
      <div class="sr-title-text">{{ text || '无内容' }}</div>
      <slot name="meta" />
    </div>

    <textarea
      v-if="editing"
      ref="noteRef"
      :value="note"
      class="sr-note sr-note-edit"
      placeholder="添加笔记…"
      rows="1"
      @input="onNoteInput"
    />
    <div v-else-if="note" class="sr-note">{{ note }}</div>

    <slot name="extra" />

    <div v-if="editable" class="sr-card-foot">
      <template v-if="editing">
        <button class="sr-text-btn" @click.stop="emit('cancel')">取消</button>
        <button class="sr-text-btn sr-text-btn--primary" @click.stop="emit('save')">保存</button>
      </template>
      <template v-else>
        <button class="sr-text-btn" @click.stop="emit('edit')">
          <svg><use xlink:href="#iconTags" /></svg>
          <span>{{ tags.length ? '编辑标签' : '添加标签' }}</span>
        </button>
        <button class="sr-text-btn sr-text-btn--primary" @click.stop="emit('edit')">
          <svg><use xlink:href="#iconEdit" /></svg>
          <span>编辑笔记</span>
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

type ColorOption = { key: string; value: string; bg: string }

const props = withDefaults(defineProps<{
  time: string
  tags?: string[]
  tagOptions?: string[]
  selectedTags?: string[]
  tagInput?: string
  editing?: boolean
  editable?: boolean
  text?: string
  chapter?: string
  note?: string
  markColor?: string
  colorValue?: string
  colorOptions?: ColorOption[]
  bookmark?: boolean
}>(), {
  tags: () => [],
  tagOptions: () => [],
  selectedTags: () => [],
  tagInput: '',
  text: '',
  chapter: '',
  note: '',
  markColor: '#e0e0e0',
  colorValue: '',
  colorOptions: () => [],
})

const emit = defineEmits<{
  'update:tagInput': [value: string]
  'update:text': [value: string]
  'update:note': [value: string]
  'update:colorValue': [value: string]
  'toggle-tag': [tag: string]
  edit: []
  cancel: []
  save: []
  go: []
}>()

const noteRef = ref<HTMLTextAreaElement | null>(null)
const resizeNote = () => {
  const textarea = noteRef.value
  if (!textarea) return
  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight}px`
}
const onNoteInput = (event: Event) => {
  emit('update:note', (event.target as HTMLTextAreaElement).value)
  resizeNote()
}
watch(() => [props.editing, props.note], () => nextTick(resizeNote), { immediate: true })
</script>

<style scoped lang="scss">
.sr-main{display:flex;flex:1;flex-direction:column;gap:var(--sr-gap,4px)!important;min-width:0}
.sr-main>*{flex:0 0 auto;margin:0!important}
.sr-head{display:flex;align-items:center;justify-content:space-between;gap:var(--sr-gap,4px);min-height:18px}
.sr-time{font-size:12px;line-height:18px;color:#6b6b6b;white-space:nowrap;flex-shrink:0}
.sr-tag-list{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sr-gap,4px);min-height:var(--sr-line,19px)}
.sr-tag-editor{flex-direction:column;align-items:stretch}
.sr-tag-options{display:flex;flex-wrap:wrap;gap:var(--sr-gap,4px)}
.sr-tag-chip{display:inline-flex;align-items:center;height:18px;padding:0 6px;border:0;border-radius:2px;background:#eef5ff;color:#415c7a;font-size:12px;line-height:18px;cursor:default}
button.sr-tag-chip{cursor:pointer;opacity:.58}
button.sr-tag-chip.active{opacity:1;background:#dfeeff;color:#244966}
.sr-tag-input-inline{width:100%;height:20px;padding:0 4px;border:0;border-bottom:1px solid #d7d7d7;background:transparent;color:#333;font-size:12px;line-height:20px;outline:none;box-sizing:border-box}
.sr-title,.sr-note{flex:0 0 auto;min-height:var(--sr-line,19px);font-size:13px;line-height:var(--sr-line,19px);overflow:hidden}
.sr-title{display:flex;flex-direction:column;gap:var(--sr-gap,4px);padding:0 0 0 6px;border-left:3px solid var(--mark-color,#e0e0e0);background:#fff;color:#888;font-weight:500;cursor:pointer}
.sr-title[contenteditable="true"]{outline:none}
.sr-title-bookmark{color:var(--b3-theme-primary)}
.sr-title-text,.sr-inline-chapter{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-inline-chapter{color:#aaa;font-weight:500}
.sr-title-edit{display:flex;flex-direction:column;gap:var(--sr-gap,4px);min-width:0}
.sr-color-picker{display:flex;align-items:center;gap:5px}
.sr-color-swatch{width:18px;height:18px;padding:0;border:1px solid #0001;border-radius:5px;cursor:pointer;box-shadow:inset 0 0 0 1px #fff8}
.sr-color-swatch.active{border-color:#555;box-shadow:0 0 0 1px #555,inset 0 0 0 1px #fff}
.sr-note{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;color:#333;cursor:text;white-space:normal}
.sr-note-edit{width:100%;height:auto;min-height:var(--sr-line,19px);padding:0;border:0;background:transparent;box-sizing:border-box;resize:none;outline:none;overflow:hidden;font-family:inherit;field-sizing:content}
.sr-card-foot{display:flex;align-items:center;justify-content:space-between;gap:var(--sr-gap,4px)}
.sr-text-btn{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0;border:none;background:transparent;color:#777;font-size:12px;line-height:1;cursor:pointer}
.sr-text-btn svg{width:14px;height:14px;flex-shrink:0}
.sr-text-btn--primary{height:22px;padding:0 5px;border:1px solid #d7d7d7;border-radius:5px;background:#fff;color:#444}
.sr-meta{margin-left:8px;font-size:11px;font-weight:400;color:var(--b3-theme-on-surface-variant)}
</style>
