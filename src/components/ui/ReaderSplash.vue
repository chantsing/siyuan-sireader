<template>
  <Transition name="opening-splash">
    <div v-if="visible" class="reader-opening" :class="openingClass">
      <div class="reader-opening__halo"></div>
      <div class="reader-opening__book" :style="coverStyle">
        <div class="reader-opening__veil"></div>
        <div class="reader-opening__shine"></div>
        <div class="reader-opening__page"></div>
        <div class="reader-opening__info">
          <div class="reader-opening__seal">{{ sealText }}</div>
          <div class="reader-opening__title">{{ title }}</div>
          <div v-if="author" class="reader-opening__author">{{ author }}</div>
          <div class="reader-opening__meta">{{ format }} · SiReader</div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const props = withDefaults(defineProps<{
  bookInfo?: { title?: string; author?: string; cover?: string; format?: string }
  fileName?: string
  status?: 'opening' | 'finished'
  phaseText?: string
}>(), {
  bookInfo: () => ({}),
  fileName: '',
  status: 'opening',
  phaseText: ''
})

const visible = ref(true)
const ready = ref(false)
let exitTimer: any

const title = computed(() => props.bookInfo?.title || props.fileName?.replace(/\.[^.]+$/, '') || '未命名书籍')
const author = computed(() => props.bookInfo?.author || '')
const format = computed(() => props.bookInfo?.format?.toUpperCase() || props.fileName?.split('.').pop()?.toUpperCase() || 'EPUB')
const sealText = computed(() => props.phaseText || (props.status === 'finished' ? '读毕有得' : '开卷有益'))
const coverStyle = computed(() => props.bookInfo?.cover ? { '--opening-cover': `url("${props.bookInfo.cover}")` } : {})
const openingClass = computed(() => ({
  'is-ready': ready.value,
  'is-finished': props.status === 'finished'
}))

const dismiss = () => {
  if (!visible.value || ready.value) return
  clearTimeout(exitTimer)
  ready.value = true
  exitTimer = setTimeout(() => visible.value = false, 1050)
}

const cleanup = () => {
  clearTimeout(exitTimer)
}

const isVisible = () => visible.value
defineExpose({ dismiss, cleanup, isVisible })
</script>

<style scoped lang="scss">
.reader-opening{position:absolute;inset:0;z-index:15;display:flex;align-items:center;justify-content:center;overflow:hidden;background:
  radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--b3-theme-primary) 18%, transparent), transparent 38%),
  radial-gradient(circle at 50% 120%, color-mix(in srgb, #f6d365 18%, transparent), transparent 42%),
  linear-gradient(145deg, color-mix(in srgb, var(--b3-theme-primary) 10%, var(--b3-theme-background)) 0%, var(--b3-theme-background) 52%, color-mix(in srgb, var(--b3-theme-primary) 16%, var(--b3-theme-surface)) 100%);
  pointer-events:none;padding:clamp(20px,4vw,56px);
  &.is-ready{
    .reader-opening__book{transform:perspective(1800px) rotateY(-24deg) scale(1.08);opacity:0}
    .reader-opening__halo{opacity:0;transform:scale(1.28)}
    .reader-opening__shine{animation:reader-opening-shine 1.6s ease .05s both}
    .reader-opening__page{animation:reader-opening-page 1.2s cubic-bezier(.2,.8,.2,1) both}
    .reader-opening__veil{opacity:1}
  }
  &.is-finished{
    background:
      radial-gradient(circle at 50% 25%, color-mix(in srgb, #22c55e 16%, transparent), transparent 34%),
      linear-gradient(145deg, color-mix(in srgb, #16a34a 12%, var(--b3-theme-background)) 0%, var(--b3-theme-background) 55%, color-mix(in srgb, #84cc16 14%, var(--b3-theme-surface)) 100%);
    .reader-opening__seal{background:#dcfce7cc;color:#14532d}
  }
}
.reader-opening__halo{position:absolute;width:min(110vw,1400px);aspect-ratio:1;border-radius:50%;background:radial-gradient(circle, color-mix(in srgb, #f6d365 40%, transparent), transparent 68%);filter:blur(48px);opacity:.8;transition:all .9s ease}
.reader-opening__book{--opening-cover:none;position:relative;width:min(72vw,620px);height:min(82vh,920px);max-width:100%;border-radius:28px;overflow:hidden;box-shadow:0 42px 120px #00000038, inset 0 0 0 1px #ffffff26;background:
  linear-gradient(135deg, #f6efe2 0%, #e2cba3 45%, #b98d52 100%);
  transform:perspective(1800px) rotateY(0deg) scale(1);
  transition:transform .95s cubic-bezier(.22,.61,.36,1),opacity .95s ease;
  &::before{content:'';position:absolute;inset:0;background:
    linear-gradient(180deg, #00000012 0%, transparent 24%, #00000020 100%),
    var(--opening-cover) center/cover no-repeat;
  }
  &::after{content:'';position:absolute;top:0;right:0;width:28px;height:100%;background:linear-gradient(180deg, #ffffffd0 0%, #fff8 18%, #00000018 100%);box-shadow:inset 1px 0 0 #ffffff80}
}
.reader-opening__veil{position:absolute;inset:0;background:radial-gradient(circle at 50% 35%, transparent 0%, #120d0866 58%, #120d08cc 100%);opacity:0;transition:opacity .55s ease}
.reader-opening__shine{position:absolute;inset:-20%;background:linear-gradient(115deg, transparent 35%, #ffffff90 50%, transparent 65%);transform:translateX(-85%) rotate(8deg)}
.reader-opening__page{position:absolute;top:2%;right:8px;width:48%;height:96%;border-radius:0 24px 24px 0;background:linear-gradient(180deg, #fffdf7f2 0%, #f4ebd8cc 100%);transform-origin:left center;box-shadow:inset 1px 0 0 #ffffffb0}
.reader-opening__info{position:absolute;left:0;right:0;bottom:0;padding:28px 28px 32px;color:#fff;background:linear-gradient(180deg, transparent 0%, #1a1308a8 34%, #120d08f2 100%)}
.reader-opening__seal{display:inline-flex;align-items:center;justify-content:center;padding:7px 16px;border-radius:999px;background:#f4d38cbf;color:#4a2c00;font-size:13px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;backdrop-filter:blur(8px)}
.reader-opening__title{margin-top:16px;font-size:clamp(28px,3.2vw,42px);line-height:1.12;font-weight:700;text-shadow:0 2px 14px #00000038;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.reader-opening__author,.reader-opening__meta{margin-top:10px;font-size:clamp(13px,1.15vw,16px);opacity:.84;letter-spacing:.08em}
.opening-splash-enter-active,.opening-splash-leave-active{transition:opacity .45s ease}
.opening-splash-enter-from,.opening-splash-leave-to{opacity:0}
@keyframes reader-opening-page{
  0%{transform:perspective(1200px) rotateY(0deg);opacity:1}
  100%{transform:perspective(1200px) rotateY(-88deg);opacity:.12}
}
@keyframes reader-opening-shine{
  0%{transform:translateX(-85%) rotate(8deg);opacity:0}
  25%{opacity:.9}
  100%{transform:translateX(95%) rotate(8deg);opacity:0}
}
</style>
