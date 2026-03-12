<template>
  <Teleport to="body">
    <div v-if="show" class="tr-overlay" @click="emit('close')"/>
    <div v-if="show" class="tr-popup" :style="pos" @click.stop>
      <div class="tr-section">
        <div class="tr-head">
          <span>原文</span>
          <div class="tr-select">
            <button @click.stop="showSrc=!showSrc">{{srcName}}</button>
            <div v-if="showSrc" class="tr-menu" @click.stop>
              <div :class="['tr-item',{on:src==='auto'}]" @click="src='auto';showSrc=false">自动检测</div>
              <div v-for="[c,n] in langs" :key="c" :class="['tr-item',{on:src===c}]" @click="src=c;showSrc=false">{{n}}</div>
            </div>
          </div>
        </div>
        <div class="tr-text tr-src">{{text}}</div>
      </div>
      <div class="tr-line"/>
      <div class="tr-section">
        <div class="tr-head">
          <span>译文</span>
          <div class="tr-select">
            <button @click.stop="showTgt=!showTgt">{{tgtName}}</button>
            <div v-if="showTgt" class="tr-menu" @click.stop>
              <div v-for="[c,n] in langs" :key="c" :class="['tr-item',{on:tgt===c}]" @click="tgt=c;showTgt=false;translate()">{{n}}</div>
            </div>
          </div>
        </div>
        <div class="tr-text tr-tgt">{{loading?'翻译中...':result||'翻译失败'}}</div>
      </div>
      <div class="tr-line"/>
      <div class="tr-section">
        <div class="tr-head">
          <span>翻译引擎</span>
          <div class="tr-select">
            <button @click.stop="showEng=!showEng">{{engines[eng].name}}</button>
            <div v-if="showEng" class="tr-menu tr-menu-up" @click.stop>
              <div v-for="(e,k) in engines" :key="k" :class="['tr-item',{on:eng===k}]" @click="eng=k;showEng=false;translate()">{{e.name}}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import {ref,computed,watch} from 'vue'
import {translators} from '@/services/translator'

const props=defineProps<{show:boolean;text:string;x:number;y:number}>()
const emit=defineEmits<{close:[]}>()

const langs=[['zh-CN','中文'],['en','English'],['ja','日本語'],['ko','한국어'],['fr','Français'],['de','Deutsch'],['es','Español'],['ru','Русский']]
const engines=translators
const src=ref('auto'),tgt=ref('zh-CN'),eng=ref<keyof typeof translators>('azure')
const result=ref(''),loading=ref(false)
const showSrc=ref(false),showTgt=ref(false),showEng=ref(false)

const srcName=computed(()=>src.value==='auto'?'自动检测':langs.find(l=>l[0]===src.value)?.[1]||'自动检测')
const tgtName=computed(()=>langs.find(l=>l[0]===tgt.value)?.[1]||'中文')
const pos=computed(()=>{const r=document.querySelector('.reader-container')?.getBoundingClientRect(),b=r?{left:r.left+16,right:r.right-16,top:r.top+16,bottom:r.bottom-16}:{left:16,right:innerWidth-16,top:16,bottom:innerHeight-16},w=400,h=400,p=10,x=Math.max(b.left+w/2+p,Math.min(props.x,b.right-w/2-p)),y=props.y+h+p*2>b.bottom?Math.max(b.top+p*2,props.y-h-p):props.y+p;return{left:`${x}px`,top:`${y}px`}})

const translate=async()=>{
  loading.value=true
  try{result.value=await engines[eng.value].translate(props.text,tgt.value)}
  catch{result.value=''}
  finally{loading.value=false}
}

watch(()=>props.show,v=>{if(v)showSrc.value=showTgt.value=showEng.value=false,translate()})
</script>

<style scoped>
.tr-overlay{position:fixed;inset:0;z-index:949;background:transparent}
.tr-popup{position:fixed;z-index:950;width:400px;background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);border-radius:8px;box-shadow:0 4px 12px #0001;transform:translate(-50%,0);display:flex;flex-direction:column;max-height:600px}
.tr-section{padding:16px;display:flex;flex-direction:column;gap:8px}
.tr-head{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--b3-theme-on-surface);font-weight:500}
.tr-text{font-size:14px;line-height:1.6;overflow-y:auto;color:var(--b3-theme-on-surface);padding:8px;background:var(--b3-theme-background);border-radius:4px;border:1px solid var(--b3-border-color)}
.tr-src{max-height:50px}
.tr-tgt{max-height:200px}
.tr-line{height:1px;background:var(--b3-border-color)}
.tr-select{position:relative}
.tr-select button{padding:4px 10px;font-size:12px;border:1px solid var(--b3-border-color);border-radius:4px;background:var(--b3-theme-background);color:var(--b3-theme-on-surface);cursor:pointer;transition:all .15s}
.tr-select button:hover{border-color:var(--b3-theme-primary);background:var(--b3-theme-surface)}
.tr-menu{position:absolute;right:0;top:calc(100% + 4px);background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);border-radius:6px;box-shadow:0 4px 12px #0002;z-index:20;min-width:120px;max-height:240px;overflow-y:auto}
.tr-menu-up{top:auto;bottom:calc(100% + 4px)}
.tr-item{padding:8px 12px;cursor:pointer;font-size:12px;transition:background .15s}
.tr-item:hover{background:var(--b3-list-hover)}
.tr-item.on{background:var(--b3-theme-primary-lightest);color:var(--b3-theme-primary);font-weight:500}
.tr-item:first-child{border-radius:6px 6px 0 0}
.tr-item:last-child{border-radius:0 0 6px 6px}
</style>
