/**
 * PDF 墨迹标注核心模块
 */
import type{Annotation}from'../database'
import { listAnnotations, removeAnnotation, replaceAnnotationsByType } from '../MarkManager'
import { compactNumber, compactRect, getCanvasPoint, getPdfLayerCanvas, getPdfViewport, pdfPointToScreenPoint, pdfRectToScreenRect, redrawPdfLayerPage, screenDeltaToPdfDelta, screenPointToPdfPoint, setPdfLayerInteractivity } from './annotation'

export interface InkPoint{x:number;y:number;pressure?:number}
export interface InkPath{points:InkPoint[];color:string;width:number;opacity:number}
export interface InkAnnotation{id:string;type:'ink';page:number;paths:InkPath[];timestamp:number;rect?:[number,number,number,number];text?:string;note?:string;color?:string;chapter?:string;blockId?:string;customOrder?:number}
export interface InkConfig{color:string;width:number;opacity:number;smoothing:boolean}

const isValidRect=(r:any):r is[number,number,number,number]=>Array.isArray(r)&&r.length===4
const isValidPaths=(p:any):p is InkPath[]=>Array.isArray(p)&&p.length>0
const compactPoint=(pt:InkPoint):InkPoint=>({x:compactNumber(pt.x),y:compactNumber(pt.y)})
const compactPath=(path:InkPath):InkPath=>({
  ...path,
  points:(path.points||[]).reduce<InkPoint[]>((list,point)=>{
    const next=compactPoint(point)
    const last=list[list.length-1]
    if(!last||last.x!==next.x||last.y!==next.y)list.push(next)
    return list
  },[])
})
const getScreenPath=(path:InkPath,viewport:any):InkPath=>({
  ...path,
  points:(path.points||[]).map(point=>{
    const next=pdfPointToScreenPoint(viewport,point.x,point.y)
    return point.pressure===undefined?next:{...next,pressure:point.pressure}
  })
})

/** 绘制墨迹到Canvas */
export const drawInk=(canvas:HTMLCanvasElement,paths:InkPath[],rect:[number,number,number,number])=>{
  const ctx=canvas.getContext('2d')
  if(!ctx||!isValidPaths(paths)||!isValidRect(rect))return
  const[x1,y1,x2,y2]=rect,w=x2-x1,h=y2-y1
  if(w<=0||h<=0)return
  ctx.clearRect(0,0,canvas.width,canvas.height)
  const s=Math.min(canvas.width/(w+10),canvas.height/(h+10)),ox=(canvas.width-w*s)/2-x1*s,oy=(canvas.height-h*s)/2-y1*s
  ctx.lineCap=ctx.lineJoin='round'
  paths.forEach(p=>{
    if(!p?.points?.length||p.points.length<2)return
    ctx.strokeStyle=p.color||'#000'
    ctx.globalAlpha=p.opacity??1
    ctx.lineWidth=(p.width||2)*s
    ctx.beginPath()
    ctx.moveTo(p.points[0].x*s+ox,p.points[0].y*s+oy)
    p.points.forEach(pt=>ctx.lineTo(pt.x*s+ox,pt.y*s+oy))
    ctx.stroke()
  })
}

/** 批量渲染墨迹Canvas */
export const renderInkCanvas=(list:any[],cache:Map<string,number>,draw=drawInk)=>{
  document.querySelectorAll('[data-page].sr-group-preview').forEach(el=>{
    const c=el as HTMLCanvasElement,p=+(c.dataset.page||0),k=`g${p}`
    if(cache.has(k))return
    const g=list.find(i=>i.type==='ink-group'&&i.page===p)
    if(!g?.inks)return
    let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity,paths:InkPath[]=[]
    g.inks.forEach((ink:any)=>{
      if(isValidRect(ink.rect)){
        const[a,b,c,d]=ink.rect
        x1=Math.min(x1,a);y1=Math.min(y1,b);x2=Math.max(x2,c);y2=Math.max(y2,d)
      }
      if(isValidPaths(ink.paths))paths.push(...ink.paths)
    })
    if(paths.length&&x1!==Infinity){draw(c,paths,[x1,y1,x2,y2]);cache.set(k,1)}
  })
  document.querySelectorAll('[data-ink-id]').forEach(el=>{
    const c=el as HTMLCanvasElement,id=c.dataset.inkId
    if(!id||cache.has(id))return
    const ink=list.find(i=>i.type==='ink-group'&&i.inks?.some((k:any)=>k.id===id))?.inks?.find((i:any)=>i.id===id)
    if(ink&&isValidPaths(ink.paths)&&isValidRect(ink.rect)){draw(c,ink.paths,ink.rect);cache.set(id,1)}
  })
}

/** 墨迹绘制器 */
export class InkDrawer{
  private ctx:CanvasRenderingContext2D
  private isDrawing=false
  private currentPath:InkPoint[]=[]
  private config:InkConfig
  public canvas:HTMLCanvasElement

  constructor(canvas:HTMLCanvasElement,config:InkConfig){
    this.canvas=canvas
    this.ctx=canvas.getContext('2d')!
    this.config=config
    this.ctx.lineCap=this.ctx.lineJoin='round'
  }

  setConfig(c:Partial<InkConfig>){this.config={...this.config,...c}}

  startDrawing(x:number,y:number,pressure=1){
    this.isDrawing=true
    this.currentPath=[{x,y,pressure}]
    this.ctx.beginPath()
    this.ctx.moveTo(x,y)
  }

  draw(x:number,y:number,pressure=1){
    if(!this.isDrawing)return
    const rx=Math.round(x),ry=Math.round(y),len=this.currentPath.length
    if(len>0){
      const last=this.currentPath[len-1]
      if(last.x===rx&&last.y===ry||Math.hypot(rx-last.x,ry-last.y)<3)return
    }
    this.currentPath.push({x:rx,y:ry,pressure})
    this.ctx.strokeStyle=this.config.color
    this.ctx.globalAlpha=this.config.opacity
    this.ctx.lineWidth=this.config.width*pressure
    if(this.config.smoothing&&len>1){
      const p1=this.currentPath[len-1]
      this.ctx.quadraticCurveTo(p1.x,p1.y,(p1.x+rx)/2,(p1.y+ry)/2)
    }else{
      this.ctx.lineTo(rx,ry)
    }
    this.ctx.stroke()
  }

  endDrawing():InkPath|null{
    if(!this.isDrawing||this.currentPath.length<2){this.isDrawing=false;return null}
    this.isDrawing=false
    const path:InkPath={points:[...this.currentPath],color:this.config.color,width:this.config.width,opacity:this.config.opacity}
    this.currentPath=[]
    return path
  }

  clear(){this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height)}

  renderAnnotation(ann:InkAnnotation){ann.paths.forEach(p=>this.renderPath(p))}

  private renderPath(p:InkPath){
    if(p.points.length<2)return
    this.ctx.strokeStyle=p.color
    this.ctx.globalAlpha=p.opacity
    this.ctx.lineWidth=p.width
    this.ctx.beginPath()
    this.ctx.moveTo(p.points[0].x,p.points[0].y)
    if(this.config.smoothing&&p.points.length>2){
      for(let i=1;i<p.points.length-1;i++){
        const p1=p.points[i],p2=p.points[i+1]
        this.ctx.quadraticCurveTo(p1.x,p1.y,(p1.x+p2.x)/2,(p1.y+p2.y)/2)
      }
    }else{
      p.points.forEach(pt=>this.ctx.lineTo(pt.x,pt.y))
    }
    this.ctx.stroke()
  }

  static calculateRect(paths:InkPath[]):[number,number,number,number]{
    let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity
    paths.forEach(p=>p.points.forEach(pt=>{x1=Math.min(x1,pt.x);y1=Math.min(y1,pt.y);x2=Math.max(x2,pt.x);y2=Math.max(y2,pt.y)}))
    return[x1,y1,x2,y2]
  }
}

/** 墨迹管理器 */
export class InkManager{
  private annotations=new Map<string,InkAnnotation>()
  private history:string[]=[]
  currentAnnotation:InkAnnotation|null=null

  constructor(private page:number){}

  startAnnotation(){this.currentAnnotation={id:`ink_${Date.now()}_${Math.random().toString(36).slice(2,11)}`,type:'ink',page:this.page,paths:[],timestamp:Date.now()}}
  addPath(path:InkPath){this.currentAnnotation?.paths.push(path)}
  endAnnotation():InkAnnotation|null{
    if(!this.currentAnnotation?.paths.length){this.currentAnnotation=null;return null}
    this.currentAnnotation.rect=InkDrawer.calculateRect(this.currentAnnotation.paths)
    this.annotations.set(this.currentAnnotation.id,this.currentAnnotation)
    this.history.push(this.currentAnnotation.id)
    const ann=this.currentAnnotation
    this.currentAnnotation=null
    return ann
  }
  undo():boolean{const id=this.history.pop();return id?this.annotations.delete(id):false}
  getAnnotations():InkAnnotation[]{return Array.from(this.annotations.values())}
  setAnnotation(annotation:InkAnnotation){this.annotations.set(annotation.id,annotation)}
  deleteAnnotation(id:string):boolean{return this.annotations.delete(id)}
  clear(){this.annotations.clear();this.history=[]}
  toJSON():InkAnnotation[]{return this.getAnnotations()}
  fromJSON(data:InkAnnotation[]){data.forEach(a=>{if(a.page===this.page)this.annotations.set(a.id,a)})}
}

/** 墨迹控制器 */
export class InkController{
  private managers=new Map<number,InkManager>()
  private drawers=new Map<number,InkDrawer>()
  private config:InkConfig={color:'#ff0000',width:2,opacity:1,smoothing:true}
  private currentPage=0
  private container?:HTMLElement
  private pdfViewer:any=null
  private listeners:Array<{el:HTMLElement;type:string;handler:any}>=[]

  constructor(private onSave?:()=>Promise<void>){}

  init(container:HTMLElement){this.container=container}
  setPdfViewer(viewer:any){this.pdfViewer=viewer}
  setConfig(c:Partial<InkConfig>){this.config={...this.config,...c};this.drawers.forEach(d=>d.setConfig(this.config))}
  private getLayerCanvas(page:number){
    return getPdfLayerCanvas('pdf-ink-layer',page)
  }
  private resetDrawing(){this.currentPage=0}
  private redrawPage(page:number,viewer=this.pdfViewer){
    return redrawPdfLayerPage(page,this.getLayerCanvas.bind(this),(targetPage,canvas)=>this.render(targetPage,canvas,viewer))
  }
  private bindPointerEvents(start:any,move:any,end:any){
    if(!this.container)return
    const c=this.container
    ;[
      ['mousedown',start],['mousemove',move],['mouseup',end],
      ['touchstart',start],['touchmove',move],['touchend',end]
    ].forEach(([type,handler])=>c.addEventListener(type as string,handler as EventListener,{passive:type.toString().startsWith('touch')}))
    this.listeners=[
      {el:c,type:'mousedown',handler:start},{el:c,type:'mousemove',handler:move},{el:c,type:'mouseup',handler:end},
      {el:c,type:'touchstart',handler:start},{el:c,type:'touchmove',handler:move},{el:c,type:'touchend',handler:end}
    ]
  }

  private getDrawer(page:number,canvas:HTMLCanvasElement):InkDrawer{
    let d=this.drawers.get(page)
    if(!d||d.canvas!==canvas){
      d=new InkDrawer(canvas,this.config)
      this.drawers.set(page,d)
    }else{
      d.setConfig(this.config)
    }
    return d
  }

  private getActiveDrawer(page:number){
    const canvas=this.getLayerCanvas(page)
    if(!canvas)return null
    return{canvas,drawer:this.getDrawer(page,canvas)}
  }

  private getCurrentViewport(viewer=this.pdfViewer){
    return this.currentPage?getPdfViewport(viewer,this.currentPage):null
  }

  getManager(page:number):InkManager{
    let m=this.managers.get(page)
    if(!m){m=new InkManager(page);this.managers.set(page,m)}
    return m
  }

  async startDrawing(e:MouseEvent|TouchEvent,canvas:HTMLCanvasElement,page:number){
    this.currentPage=page
    const{x,y}=getCanvasPoint(e,canvas.getBoundingClientRect())
    this.getDrawer(page,canvas).startDrawing(x,y)
  }

  draw(e:MouseEvent|TouchEvent){
    if(!this.currentPage)return
    const active=this.getActiveDrawer(this.currentPage)
    if(!active)return
    const{canvas:cv,drawer:d}=active
    const{x,y}=getCanvasPoint(e,cv.getBoundingClientRect())
    d.draw(x,y)
  }

  async endDrawing(viewer?:any){
    if(!this.currentPage)return
    const page=this.currentPage
    const active=this.getActiveDrawer(page)
    const path=active?.drawer.endDrawing()
    if(!path){this.resetDrawing();return}
    const viewport=this.getCurrentViewport(viewer)
    if(!viewport){this.resetDrawing();return}
    const pdfPath=compactPath({
      ...path,
      points:path.points.map(point=>{
        const next=screenPointToPdfPoint(viewport,point.x,point.y)
        return point.pressure===undefined?next:{...next,pressure:point.pressure}
      })
    })
    if(pdfPath.points.length<2){this.resetDrawing();return}
    const m=this.getManager(page)
    if(!m.currentAnnotation)m.startAnnotation()
    m.addPath(pdfPath)
    const annotation=m.endAnnotation()
    await this.onSave?.()
    const canvas=this.redrawPage(page,viewer)
    this.resetDrawing()
    if(annotation&&canvas&&isValidRect(annotation.rect)){
      const[x1,y1,x2,y2]=pdfRectToScreenRect(viewport,annotation.rect)
      const rectBox=canvas.getBoundingClientRect()
      const x=rectBox.left+(x1+x2)/2
      const y=rectBox.top+Math.max(y1,y2)+10
      setTimeout(()=>window.dispatchEvent(new CustomEvent('ink-created',{detail:{ink:annotation,x,y,edit:true}})),50)
    }
  }

  render(page:number,canvas:HTMLCanvasElement,viewer?:any){
    const d=this.getDrawer(page,canvas)
    d.clear()
    const m=this.managers.get(page)
    if(!m)return
    const viewport=getPdfViewport(viewer,page)
    if(!viewport)return
    m.getAnnotations().forEach(a=>d.renderAnnotation({
      ...a,
      rect:isValidRect(a.rect)?pdfRectToScreenRect(viewport,a.rect):a.rect,
      paths:(a.paths||[]).map(path=>getScreenPath(path,viewport))
    }))
  }

  findAnnotationAt(page:number,x:number,y:number,viewer?:any):InkAnnotation|null{
    const viewport=getPdfViewport(viewer,page)
    if(!viewport)return null
    const anns=this.managers.get(page)?.getAnnotations()||[]
    const pad=8
    for(let i=anns.length-1;i>=0;i--){
      const ann=anns[i],rect=ann.rect
      if(!rect)continue
      const[x1,y1,x2,y2]=pdfRectToScreenRect(viewport,rect)
      if(x>=x1-pad&&x<=x2+pad&&y>=y1-pad&&y<=y2+pad)return ann
    }
    return null
  }

  undo(page:number):boolean{
    const m=this.managers.get(page)
    if(!m||!m.undo())return false
    this.redrawPage(page,this.pdfViewer)
    return true
  }

  clear(page:number){this.managers.get(page)?.clear();this.drawers.get(page)?.clear()}
  toJSON():InkAnnotation[]{const all:InkAnnotation[]=[];this.managers.forEach(m=>all.push(...m.toJSON()));return all}
  fromJSON(data:InkAnnotation[]){data.forEach(ink=>this.getManager(ink.page).fromJSON([ink]))}

  async toggle(active:boolean){
    if(!this.container)return
    this.container.style.userSelect=active?'none':'text'
    this.container.style.cursor=active?'crosshair':'default'
    setPdfLayerInteractivity('pdf-ink-layer',active)
    active?this.bindEvents():this.unbindEvents()
  }

  private bindEvents(){
    if(!this.container)return
    const start=async(e:MouseEvent|TouchEvent)=>{if(this.container?.dataset.pdfDragAnnotation==='true')return;const t=e.target as HTMLElement;if(!t.classList.contains('pdf-ink-layer'))return;const cv=t as HTMLCanvasElement,p=+(cv.dataset.page||0);if(!p)return;await this.startDrawing(e,cv,p);e instanceof MouseEvent&&e.preventDefault()}
    const move=(e:MouseEvent|TouchEvent)=>{if(this.container?.dataset.pdfDragAnnotation==='true')return;this.draw(e);e instanceof MouseEvent&&e.preventDefault()}
    const end=async()=>{if(this.container?.dataset.pdfDragAnnotation==='true')return;await this.endDrawing(this.pdfViewer)}
    this.bindPointerEvents(start,move,end)
  }

  private unbindEvents(){this.listeners.forEach(({el,type,handler})=>el.removeEventListener(type,handler));this.listeners=[]}
  destroy(){this.unbindEvents();this.managers.clear();this.drawers.clear()}
}

/** 墨迹工具管理器 */
export class InkToolManager{
  private controller?:InkController
  private initialized=false

  constructor(private container:HTMLElement,_plugin:any,private bookUrl:string,_bookName:string,private viewer:any){}

  private get currentPage(){return this.viewer?.getCurrentPage?.()||0}
  private get controllerData(){return this.controller?.toJSON()||[]}
  private getLocalInk(id:string){return this.controllerData.find(ink=>ink.id===id)}
  private getPageCanvas(page:number){
    return getPdfLayerCanvas('pdf-ink-layer',page)
  }
  private renderPage(page:number){
    const canvas=this.getPageCanvas(page)
    if(canvas&&this.controller)this.controller.render(page,canvas,this.viewer)
  }
  private async getController(){
    return await this.init()
  }
  private async persistController(){if(this.controller)await this.saveData(this.controllerData)}
  private async updateInkState(ink:InkAnnotation,mutate:()=>void|Promise<void>){
    await mutate()
    this.renderPage(ink.page)
    await this.persistController()
    return true
  }
  private removeInk(id:string,page:number){
    this.controller?.getManager(page).deleteAnnotation(id)
    this.renderPage(page)
  }

  private async loadData(){
    const annotations=await listAnnotations(this.bookUrl,'ink')
    return annotations.map(a=>{
      const ink:any={
        id:a.id,type:'ink',page:a.data?.page||0,
        paths:(a.data?.paths||[]).map((path:InkPath)=>compactPath(path)),
        timestamp:a.created,text:a.text,note:a.note,color:a.color,chapter:a.chapter,blockId:a.block,customOrder:a.data?.customOrder
      }
      ink.rect=isValidRect(a.data?.rect)?a.data.rect:isValidPaths(ink.paths)?InkDrawer.calculateRect(ink.paths):undefined
      return ink
    })
  }

  private async saveData(inkAnnotations:any[]){
    if(!this.initialized)return
    await replaceAnnotationsByType(this.bookUrl,'ink',inkAnnotations.map((ink:any)=>{
      const paths=(ink.paths||[]).map((path:InkPath)=>{
        const next=compactPath(path)
        return { ...next,points:next.points.map(({x,y}:InkPoint)=>({x,y})) }
      })
      const rect=isValidRect(ink.rect)?compactRect(ink.rect):ink.rect
      const data:any={format:'pdf',page:ink.page,paths}
      rect&&(data.rect=rect)
      ink.customOrder!==undefined&&(data.customOrder=ink.customOrder)
      return{
        id:ink.id,book:this.bookUrl,type:'ink',loc:`page-${ink.page}`,text:ink.text||'',note:ink.note||'',color:ink.color||ink.paths?.[0]?.color||'',
        data,created:ink.timestamp||Date.now(),updated:Date.now(),chapter:ink.chapter||'',block:ink.blockId||''
      } as Annotation
    }))
  }

  async init(){
    if(this.controller)return this.controller
    this.controller=new InkController(async()=>await this.persistController())
    this.controller.init(this.container)
    this.controller.setPdfViewer(this.viewer)
    const data=await this.loadData()
    if(data.length)this.controller.fromJSON(data)
    this.initialized=true
    return this.controller
  }

  render(page:number){this.renderPage(page)}

  async toggle(active:boolean){await(await this.getController()).toggle(active)}
  async setConfig(config:any){(await this.getController()).setConfig(config)}
  async save(){await this.persistController()}
  toJSON(){return this.controllerData}
  
  async deleteInk(id:string):Promise<boolean>{
    if(!this.controller)return false
    const ink = this.getLocalInk(id)
    if(!ink)return false
    await removeAnnotation(id)
    this.removeInk(id,ink.page)
    return true
  }

  async updateInk(id:string,updates:any):Promise<boolean>{
    const ink=this.getLocalInk(id)
    if(!ink)return false
    return this.updateInkState(ink,()=>{
      Object.assign(ink,updates)
      if(updates?.color){
        ink.paths=(ink.paths||[]).map((path:InkPath)=>({ ...path,color:updates.color }))
        ink.color=updates.color
      }
    })
  }

  findInkAt(page:number,x:number,y:number):InkAnnotation|null{
    return this.controller?.findAnnotationAt(page,x,y,this.viewer)||null
  }

  moveInkPreview(id:string,dx:number,dy:number):boolean{
    const ink=this.getLocalInk(id)
    if(!ink)return false
    const viewport=getPdfViewport(this.viewer,ink.page)
    if(!viewport)return false
    const delta=screenDeltaToPdfDelta(viewport,dx,dy)
    ink.paths=(ink.paths||[]).map((path:InkPath)=>compactPath({
      ...path,
      points:(path.points||[]).map(pt=>({ ...pt,x:pt.x+delta.dx,y:pt.y+delta.dy }))
    }))
    if(ink.rect){
      const[x1,y1,x2,y2]=ink.rect
      ink.rect=compactRect([x1+delta.dx,y1+delta.dy,x2+delta.dx,y2+delta.dy])
    }else if(isValidPaths(ink.paths))ink.rect=InkDrawer.calculateRect(ink.paths)
    this.renderPage(ink.page)
    return true
  }

  async commitMove(){await this.persistController()}

  async moveInk(id:string,dx:number,dy:number):Promise<boolean>{
    if(!this.moveInkPreview(id,dx,dy))return false
    await this.commitMove()
    return true
  }
  
  async undo(){
    if(!this.controller)return false
    const page=this.currentPage
    if(!page)return false
    const success=this.controller.undo(page)
    if(success)await this.persistController()
    return success
  }
  
  async clear(){
    if(!this.controller)return
    const page=this.currentPage
    if(!page)return
    this.controller.clear(page)
    await this.persistController()
  }
  
  destroy(){this.controller?.destroy()}
}

export const createInkToolManager=(container:HTMLElement,plugin:any,bookUrl:string,bookName:string,viewer:any):InkToolManager=>new InkToolManager(container,plugin,bookUrl,bookName,viewer)
