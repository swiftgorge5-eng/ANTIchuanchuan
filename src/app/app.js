
'use strict';
// Replace this adapter with the team's photo service. Inputs remain local until run() is called.
// Contract: run({photos:[{id,mimeType,dataUrl}], signal}) returns a structured photo report.
window.HomeSafePhotoService = window.HomeSafePhotoService || null;
const SAMPLE_IMAGE='samples/sample-01.jpg';
const corpus=JSON.parse(document.getElementById('knowledge').textContent);
const $=id=>document.getElementById(id);
const icon=(name,cls='')=>`<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean=value=>String(value??'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
const formatTime=value=>new Date(value).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const uid=()=>globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
const state={tab:'photo',page:'photo',confirmingPhotos:false,photos:[],uploadInitialized:false,uploadRoom:'',photoCommunity:'',photoPlace:null,photoError:'',reading:false,job:null,photoReport:null,city:'上海',query:'',searchDistrict:'',districtExpanded:false,searched:false,results:[],searchSession:uid(),searchReports:new Map(),records:[],recordsLoading:true,recordError:'',filter:'all',report:null,origin:null,scroll:{photo:0,search:0,records:0},saveStates:new Map()};
let dbPromise,toastTimer,toastCallback,zoom=1,searchSequence=0;
function db(){if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{if(!window.indexedDB){reject(new Error('当前浏览器不支持本机记录'));return;}const request=indexedDB.open('homesafe-mobile-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('reports',{keyPath:'id'});request.onsuccess=()=>{const result=request.result;result.onversionchange=()=>{result.close();dbPromise=null;};resolve(result);};request.onerror=()=>{dbPromise=null;reject(request.error);};request.onblocked=()=>{dbPromise=null;reject(new Error('请关闭其他打开的本页面后重试'));};});return dbPromise;}
async function storage(mode,operation){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('reports',mode);let result;const request=operation(tx.objectStore('reports'));request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||new Error('存储操作未完成'));tx.onerror=()=>reject(tx.error||new Error('存储失败'));});}
async function loadRecords(){state.recordsLoading=true;state.recordError='';if(state.page==='records')render();try{state.records=await storage('readonly',store=>store.getAll());}catch(error){state.recordError='本机记录读取失败，请确认浏览器允许保存站点数据后重试。';}finally{state.recordsLoading=false;if(state.page==='records'||state.page==='photo')render();}}
async function saveReport(report){const existing=state.saveStates.get(report.id);if(existing==='saving'||existing==='saved')return;state.saveStates.set(report.id,'saving');updateSave();try{await storage('readwrite',store=>store.put(report));state.records=state.records.filter(r=>r.id!==report.id);state.records.push(report);state.saveStates.set(report.id,'saved');}catch(error){state.saveStates.set(report.id,'error');}updateSave();}
function saveMarkup(report){const status=state.saveStates.get(report.id);if(status==='error')return `<div class="error save-error" role="alert">报告暂未保存，请确认浏览器存储可用。<button class="btn text" data-action="save">重试保存</button></div>`;return `<div class="saved">${status==='saved'?icon('check'):'<span class="spinner"></span>'}${status==='saved'?'已保存到看过的房':'正在保存报告…'}</div>`;}
function updateSave(){const target=$('save-state');if(target&&state.report)target.innerHTML=state.report.type==='community'?communitySaveMarkup(state.report):photoSaveMarkup(state.report);}
function toast(message,action,actionLabel='撤销'){clearTimeout(toastTimer);$('toast-text').textContent=message;$('toast-action').hidden=!action;$('toast-action').textContent=actionLabel;toastCallback=action;$('toast').hidden=false;toastTimer=setTimeout(()=>{$('toast').hidden=true;toastCallback=null;},action?9000:4200);}
$('toast-action').onclick=()=>{const action=toastCallback;toastCallback=null;$('toast').hidden=true;if(action)action();};
function header(title){if(title)return `<button class="icon-button page-back" data-action="back" aria-label="返回上一页">${icon('back')}</button><span class="top-title">${title}</span><button class="icon-button" data-action="help" aria-label="使用说明">${icon('info')}</button>`;return `<div class="brand"><span class="brand-logo">${icon('house')}</span>房小查</div><button class="icon-button" data-action="help" aria-label="使用说明">${icon('info')}</button>`;}
function dismissNotice(){if(!toastCallback){clearTimeout(toastTimer);$('toast').hidden=true;}}
function focusPage(){ $('main').focus({preventScroll:true}); }
function navigate(tab){dismissNotice();if(state.page===state.tab)state.scroll[state.tab]=window.scrollY;state.tab=tab;state.page=tab;state.report=null;state.origin=null;render();window.scrollTo(0,state.scroll[tab]||0);focusPage();}
function openReport(report,shouldSave=true){dismissNotice();state.origin={page:state.page,tab:state.tab,scroll:window.scrollY};if(state.page===state.tab)state.scroll[state.tab]=window.scrollY;state.report=report;state.page='report';Object.assign(paRoute,{id:report.id,view:'overview',room:0,scroll:0,trigger:null,other:false,roomPhoto:0,overviewPhoto:0});render();window.scrollTo(0,0);focusPage();if(shouldSave)saveReport(report);}
function back(){dismissNotice();const origin=state.origin||{page:state.tab,tab:state.tab,scroll:0};state.page=origin.page;state.tab=origin.tab;state.report=null;state.origin=null;render();window.scrollTo(0,origin.scroll);focusPage();}
function render(){
 const isReport=state.page==='report';
 $('app').classList.toggle('report-view',isReport);
 const isCommunity=isReport&&state.report.type==='community';
 $('app').classList.toggle('community-redesign',isCommunity);
 $('app').classList.toggle('photo-risk-report',isReport&&!isCommunity);
 $('header').classList.toggle('cr-header',isCommunity);
 const isPhotoAnalysis=isReport&&!isCommunity&&paRoute.view!=='full';
 $('app').classList.toggle('pa-view',isPhotoAnalysis);
 $('app').classList.toggle('pa-detail',isPhotoAnalysis&&paRoute.view==='room');
 $('header').classList.toggle('pa-header',isPhotoAnalysis);
 const isConfirm=state.page==='photo'&&(state.confirmingPhotos||!!state.job);
 const isHome=state.page==='photo'&&!isConfirm;
 $('app').classList.toggle('confirm-view',isConfirm);
 $('app').classList.toggle('home-view',isHome);
 const isSearch=state.page==='search';
 $('app').classList.toggle('search-view',isSearch);
 $('header').classList.toggle('location-header',isSearch);
 $('header').innerHTML=header(isReport?(state.report.type==='photo'?'照片分析报告':'小区历史问题'):'');
 $('header').classList.toggle('sub',isReport);
 if(isPhotoAnalysis)$('header').innerHTML=paHeader(state.report);
 if(isHome){$('header').innerHTML='<div class="brand"><span class="brand-logo">'+icon('house')+'</span><span class="home-name">房小查</span><span class="brand-subtitle">租房看房助手</span></div><button type="button" class="icon-button home-bell" data-action="home-notices" aria-label="消息通知">'+icon('home-bell')+'</button>';}
 if(isConfirm){
  $('header').classList.add('sub');
  $('header').innerHTML=`<button class="icon-button page-back" data-action="close-photo-confirm" aria-label="返回首页" ${state.reading||state.job?'disabled':''}>${icon('back')}</button><span class="top-title">上传照片</span><span></span>`;
 }
 if(isSearch){
  $('header').innerHTML=`<button class="icon-button page-back" data-tab="photo" aria-label="返回首页">${icon('back')}</button><h1>小区查询</h1><span></span>`;
 }
 $('nav').hidden=isReport||isConfirm;
 $('nav').innerHTML=[['photo',isHome?'home-nav-camera':'camera','照片分析'],['search','search','小区查询'],['records','record','看过的房']].map(([key,i,label])=>`<button type="button" data-tab="${key}" ${state.tab===key?'aria-current="page"':''}><span class="nav-icon">${icon(i)}</span>${label}</button>`).join('');
 $('main').innerHTML=isReport?reportPage(state.report):state.page==='search'?searchPage():state.page==='records'?recordsPage():photoPage();
 paRestoreGallery();
}
function openMapPicker(){
 const picker=window.HomeSafeLocationPicker;
 if(!picker){toast('定位服务尚未接入，请先搜索小区名称或地址');return;}
 picker.open({initial:state.query,onPick(place){
  const name=(place&&(place.name||place.address))||'';
  if(!name)return;
  state.query=name;state.city='上海';
  if(state.page!=='search')navigate('search');
  runSearch();
 }});
}
function openTagMapPicker(){
 const picker=window.HomeSafeLocationPicker;
 if(!picker){toast('地图选点尚未准备好');return;}
 const input=$('photo-tag-name');
 picker.open({initial:input?input.value:'',onPick(place){
  if(!input)return;
  input.value=(place&&(place.name||place.address))||'';
  photoTag.place={lng:place.lng,lat:place.lat,address:place.address||''};
  updatePhotoTagSave();
  showPhotoTag('idle');
  document.querySelector('[data-action="tag-map"]')?.focus({preventScroll:true});
 }});
}
function analysisButton(){
 const sample=state.photos.some(photo=>photo.sample);
 const label=state.reading?'<span class="spinner" aria-hidden="true"></span> 正在读取照片':(sample?'开始示例分析':'开始分析')+(state.photos.length?' · '+state.photos.length+' 张':'');
 return `<button type="button" id="analyze-button" class="btn confirm-primary" data-action="analyze" ${!state.photos.length||state.reading?'disabled':''}>${label}</button>`;
}

function homeRecordScore(r){return r.demo?68:(typeof r.score==='number'&&Number.isFinite(r.score)&&r.score>=0&&r.score<=100?r.score:null);}
const homeExamples=[
 {id:'home-example-one',title:'松庭里 · 5 个空间',date:'2026-11-07',score:68,risks:2,pending:7,thumb:'example-one'},
 {id:'home-example-two',title:'巴黎花园 · 5 个空间',date:'2026-11-06',score:82,risks:1,pending:3,thumb:'example-two'}
];

function homeRecentCard(report,example=false){
 const photo=report.type==='photo';
 const model=photo?paModel(report):null;
 const cover=example
  ? `<span class="home-record-thumb ${report.thumb}" aria-hidden="true"></span>`
  : photo&&report.photos?.[0]?.dataUrl
   ? `<img src="${escapeHtml(report.photos[0].dataUrl)}" alt="">`
   : `<span class="home-record-thumb">${icon('house')}</span>`;
 const score=example?report.score:model?.score;
 const tags=(example||photo)?`${score==null?'':`<span class="home-score">${score}分</span>`}<span class="home-risks">${example?report.risks:model.counts[0]} 个风险项</span><span class="home-pending">${example?report.pending:model.counts[2]} 项待核实</span>`:`<span class="home-pending">${report.items?.length||0} 条历史记录</span>`;
 const date=example?report.date:new Date(report.createdAt).toLocaleDateString('sv-SE');
 const title=report.title||report.name||'照片分析';
 const action=example?`data-home-example="${report.id}"`:`data-open-record="${escapeHtml(report.id)}"`;
 return `<button type="button" class="home-record" ${action}>${cover}<div class="home-record-copy"><h3>${escapeHtml(title)}${report.demo?' <small class="home-example-label">示例</small>':''}</h3><p>${example||photo?'分析时间':'查询时间'}：${escapeHtml(date)}</p><div class="home-record-meta">${tags}</div></div>${icon('arrow','home-record-arrow')}</button>`;
}

function homePage(){
 const features=[['shield','住房风险评估','结构化识别隐患'],['layers','空间品质分析','采光 · 通风 · 功能'],['home-doc','小区历史问题','真实事件与记录']].map(([glyph,title,detail])=>`<div class="home-feature"><span class="home-feature-icon">${glyph==='home-doc'?icon(glyph):paIcon(glyph)}</span><span><strong>${title}</strong><small>${detail}</small></span></div>`).join('');
 const recent=state.records.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,2);
 const examples=!state.recordsLoading&&!state.recordError&&!recent.length;
 const recentContent=state.recordsLoading?'<div class="home-loading" role="status"><span class="spinner"></span>正在读取…</div>'
  :state.recordError?'<div class="error" role="alert">读取失败<button class="btn text" data-action="reload-records">重试</button></div>'
  :`<div class="home-recent">${(examples?homeExamples:recent).map(report=>homeRecentCard(report,examples)).join('')}</div>`;
 return `<section class="home-hero"><span class="home-hero-art" aria-hidden="true"></span><h1>租房之前，<br>先查一查</h1><p>看照片 · 查小区 · 识风险</p></section>
 <div class="home-features">${features}</div>
 <button class="home-primary" type="button" data-action="open-photo-confirm">${icon('home-camera')}<span><strong>上传房源照片分析${icon('home-forward')}</strong><small>支持多空间 · AI 评估房屋风险与品质</small></span></button>
 <div class="home-shortcuts">
  <button class="home-shortcut home-secondary" type="button" data-tab="search">${icon('house')}<span><strong>查询小区</strong><small>查看历史问题与配套</small></span>${icon('arrow')}</button>
  <button class="home-shortcut" type="button" data-tab="records">${icon('home-doc')}<span><strong>历史报告</strong><small>查看过往分析结果</small></span>${icon('arrow')}</button>
 </div>
 <div class="home-section-title"><h2>最近分析的房源</h2>${examples?'<small class="home-example-label">示例</small>':''}<button class="home-all" type="button" data-tab="records">查看全部${icon('arrow')}</button></div>
 ${recentContent}`;
}

function openHomeExample(id){
 const example=homeExamples.find(item=>item.id===id);
 if(!example)return;
 const report={id,createdAt:example.date+'T12:00:00+08:00',type:'photo',demo:true,title:example.title,sampleRooms:paSampleRooms.map(room=>room.name),homeExample:example};
 openReport(report,false);
}

const photoSpaces = ['客厅', '卧室', '厨房', '卫生间', '阳台', '其他'];

function photoPage(){
 return (state.confirmingPhotos || state.job) ? uploadPage() : homePage();
}

function uploadPage(){
 const count = state.photos.length;
 const busy = state.reading || !!state.job;
 const disabled = count < 6 && !busy ? '' : 'disabled';
 const spaceButtons = ['', ...photoSpaces].map(space => `<button type="button" data-action="album" data-room="${space}" aria-pressed="${space===state.uploadRoom}" aria-label="${space ? '添加'+space+'照片' : '不限空间：添加照片'}" ${disabled}>${icon('plus')}${space || '不限空间'}</button>`).join('');
 const thumbs = state.photos.map(photo => `
  <div class="thumb">
   <button type="button" class="view-thumb" data-view="${photo.id}" aria-label="预览${escapeHtml(photo.name)}"><img src="${photo.dataUrl}" alt="${escapeHtml(photo.name)}"></button>
   <button type="button" class="icon-button remove" data-remove="${photo.id}" aria-label="移除${escapeHtml(photo.name)}" ${busy ? 'disabled' : ''}>${icon('close')}</button>
   ${photo.room ? `<span class="confirm-room">${escapeHtml(photo.room)}${photo.sample?' · 示例':''}</span>` : ''}
  </div>`).join('');
 const addTile = count < 6 ? `<button type="button" class="confirm-add" data-action="album" ${disabled}>${icon('plus')}${state.photos.some(photo=>photo.sample)?'上传自己的照片':'继续上传'}</button>` : '';
 const photoArea = count ? `<div class="thumbs confirm-grid">${thumbs}${addTile}</div>` : `
  <section class="confirm-drop" aria-labelledby="confirm-drop-heading">
   <span class="confirm-drop-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h18v16H3z M3 16l5-5 4 4 3-3 6 6 M17 8h.01"/></svg></span>
   <h2 id="confirm-drop-heading">添加房屋照片</h2>
   <p>每次最多 6 张，支持 JPG、PNG、WebP</p>
   <button type="button" class="btn confirm-primary" data-action="album" ${disabled}>选择照片</button>
  </section>`;
 return `
  <button class="jt-entry" type="button" data-action="tag-open" ${busy?'disabled':''}><span class="jt-icon">${icon('pin')}</span><span class="jt-entry-copy">${state.photoCommunity?'<small>小区标签'+(state.photoPlace?' · 已记录位置':'')+'</small>'+escapeHtml(state.photoCommunity):'小区标签'}</span><span class="jt-action">${state.photoCommunity?'修改':'添加'}${photoTagArrow}</span></button>
  ${photoArea}
  <section class="confirm-spaces" aria-labelledby="confirm-spaces-heading">
   <div class="row between"><h2 id="confirm-spaces-heading">按空间添加</h2><button type="button" class="btn text confirm-camera" data-action="camera" ${disabled}>${icon('camera')}拍照</button></div>
   <div class="confirm-tags">${spaceButtons}</div>
  </section>
  ${state.photoError ? `<div class="error" role="alert">${escapeHtml(state.photoError)}<button class="btn text" data-action="clear-photo-error">知道了</button></div>` : ''}
  ${state.job ? `<div class="progress" role="status"><div class="row"><span class="spinner"></span><strong>${state.job.demo ? '正在生成示例报告' : '正在分析照片'}</strong></div><button class="btn text" data-action="cancel">取消${state.job.demo ? '演示' : '分析'}</button></div>` : `<div class="confirm-dock">${analysisButton()}</div>`}`;
}
const photoTagArrow='<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
const photoTag={allowed:false,controller:null,status:'idle',candidates:[],selected:-1,sample:false,place:null};
const photoTagExamples=[
 {name:'松庭里',address:'普陀区 · 松庭路 18 弄',distance:90},
 {name:'松庭里东区',address:'普陀区 · 松庭路 36 弄',distance:160},
 {name:'青溪苑',address:'普陀区 · 青溪路 27 弄',distance:320}
];

function stopPhotoTagLookup(){
 photoTag.controller?.abort();
 photoTag.controller=null;
}

function updatePhotoTagSave(){
 $('photo-tag-save').disabled=!$('photo-tag-name').value.trim()&&!state.photoCommunity;
}

function showPhotoTag(status){
 photoTag.status=status;
 const busy=status==='loading';
 $('photo-tag-locate-title').textContent=busy?'正在定位…':['list','failed','empty'].includes(status)?'重新定位':'使用当前位置';
 $('photo-tag-locate-end').innerHTML=busy?'<span class="jt-spinner"></span>':photoTagArrow;
 document.querySelector('[data-action="tag-locate"]').disabled=busy;
 const result=$('photo-tag-result');
 if(status==='list'){
  const placeNote=photoTag.place?'已记录位置 · 高德地图':(photoTag.sample?'高德地图 · 示例':'高德地图');
  const rows=photoTag.candidates.map((candidate,index)=>{
   const selected=index===photoTag.selected;
   return `<button type="button" class="jt-row" data-action="tag-pick" data-tag-index="${index}" aria-pressed="${selected}"><div><strong>${escapeHtml(candidate.name)}</strong>${candidate.address?'<small>'+escapeHtml(candidate.address)+'</small>':''}</div>${Number.isFinite(candidate.distance)?'<span class="jt-distance">约 '+Math.round(candidate.distance)+' 米</span>':''}<span class="jt-circle" aria-hidden="true">${selected?icon('check'):''}</span></button>`;
  });
  result.innerHTML=`<section class="jt-section" aria-label="附近小区"><div class="jt-section-title"><strong>附近小区</strong><span class="jt-muted">${placeNote}</span></div>${rows.join('')}</section>`;
  return;
 }
 const messages={
  denied:['未开启定位权限','可在浏览器设置中开启，也可以手动填写。'],
  failed:['暂时无法获取位置','可以重新定位，或直接手动填写。'],
  empty:['附近暂未找到小区','位置已经记下来了，可以手动填写名称。'],
  unavailable:['定位服务尚未接入','可以手动填写小区名称。'],
  loading:['正在查找附近小区','']
 };
 const message=messages[status];
 result.innerHTML=message?`<div class="jt-section jt-status"><div role="status"><strong>${message[0]}</strong>${message[1]?'<p>'+message[1]+'</p>':''}</div>${busy?'<button type="button" class="jt-text" data-action="tag-cancel">取消定位</button>':''}</div>`:'';
}

function openPhotoTag(){
 photoTag.selected=-1;
 photoTag.place=state.photoPlace?{...state.photoPlace}:null;
 $('photo-tag-name').value=state.photoCommunity;
 updatePhotoTagSave();
 showPhotoTag('idle');
 $('photo-tag-sheet').showModal();
}

async function lookupPhotoTag(){
 stopPhotoTagLookup();
 const picker=window.HomeSafeLocationPicker;
 const sample=state.photos.some(photo=>photo.sample)&&!picker;
 if(!sample&&!picker){showPhotoTag('unavailable');return;}
 const controller=new AbortController();
 photoTag.controller=controller;
 photoTag.sample=sample;
 showPhotoTag('loading');
 try{
  let candidates=[];
  if(sample){
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(resolve,650);
    controller.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('已取消','AbortError'));},{once:true});
   });
   candidates=photoTagExamples;
  }else{
   const located=await picker.locate();
   candidates=Array.isArray(located.candidates)?located.candidates:[];
   photoTag.place={lng:located.lng,lat:located.lat,address:located.address||'',accuracy:located.accuracy};
  }
  if(photoTag.controller!==controller||!$('photo-tag-sheet').open)return;
  photoTag.candidates=candidates.filter(item=>typeof item?.name==='string'&&item.name.trim()).slice(0,3)
   .map(item=>({...item,name:item.name.trim().slice(0,60)}));
  const input=$('photo-tag-name');
  const suggestion=(photoTag.candidates[0]&&photoTag.candidates[0].name)||(photoTag.place&&photoTag.place.address)||'';
  if(!input.value.trim()&&suggestion)input.value=suggestion;
  photoTag.selected=photoTag.candidates.length?0:-1;
  updatePhotoTagSave();
  showPhotoTag(photoTag.candidates.length?'list':'empty');
 }catch(error){
  if(photoTag.controller!==controller||!$('photo-tag-sheet').open)return;
  const denied=error?.code===1||error?.code==='PERMISSION_DENIED'||error?.name==='NotAllowedError';
  showPhotoTag(denied?'denied':'failed');
 }finally{
  if(photoTag.controller===controller)stopPhotoTagLookup();
 }
}

function pickPhotoTag(index){
 const candidate=photoTag.candidates[index];
 if(!candidate)return;
 photoTag.selected=index;
 $('photo-tag-name').value=candidate.name;
 updatePhotoTagSave();
 showPhotoTag('list');
 document.querySelector(`[data-tag-index="${index}"]`)?.focus({preventScroll:true});
}

$('photo-tag-name').addEventListener('input',()=>{
 if(photoTag.selected!==-1){
  photoTag.selected=-1;
  showPhotoTag('list');
 }
 updatePhotoTagSave();
});
$('photo-tag-form').addEventListener('submit',event=>{
 event.preventDefault();
 const tagLabel=$('photo-tag-name').value.trim();
 state.photoCommunity=tagLabel;
 state.photoPlace=tagLabel&&photoTag.place?{...photoTag.place}:null;
 stopPhotoTagLookup();
 $('photo-tag-sheet').close();
 render();
 document.querySelector('[data-action="tag-open"]')?.focus({preventScroll:true});
});
$('photo-tag-sheet').addEventListener('close',()=>{
 if(!$('photo-tag-sheet').open)stopPhotoTagLookup();
});

async function readPhoto(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('读取失败'));reader.onload=()=>{const image=new Image();image.onerror=()=>reject(new Error('照片无法解码'));image.onload=()=>{try{const scale=Math.min(1,1600/Math.max(image.width,image.height));const canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);resolve({id:uid(),name:file.name,mimeType:'image/jpeg',dataUrl:canvas.toDataURL('image/jpeg',.86)});}catch(error){reject(error);}};image.src=reader.result;};reader.readAsDataURL(file);});}
async function addPhotos(files,room){if(!files.length||state.reading||state.job)return;state.confirmingPhotos=true;state.reading=true;state.photoError='';render();const errors=[];for(const file of files){if(state.photos.length>=6&&!state.photos.some(photo=>photo.sample)){errors.push('最多可选 6 张，超出的照片未添加。');break;}if(!['image/jpeg','image/png','image/webp'].includes(file.type)){errors.push(file.name+' 格式不支持，请选择 JPG、PNG 或 WebP。');continue;}if(file.size>15*1024*1024){errors.push(file.name+' 超过 15 MB，请压缩后重试。');continue;}try{const photo=await readPhoto(file);if(photoSpaces.includes(room))photo.room=room;state.photos=state.photos.filter(item=>!item.sample);state.photos.push(photo);}catch{errors.push(file.name+' 读取失败，请重新选择。');}}state.reading=false;state.photoError=[...new Set(errors)].join(' ');if(state.page==='photo')render();}
const sampleObservation={title:'沙发背后的墙脚看不清',phenomenon:'沙发遮挡了部分墙面，照片无法显示被遮挡区域的情况。',limitation:'遮挡本身无法判断墙面是否受潮，需要到现场查看。',advice:'查看沙发背后和墙脚有无水印、起皮，询问是否发生过漏水或维修。',photoIndex:0,marker:{x:.22,y:.71}};
async function analyze(demo=false,sampleRooms=null){if(state.job||state.reading)return;if(!demo&&!state.photos.length)return;if(!demo&&!window.HomeSafePhotoService){state.photoError='照片分析服务尚未接入，已选照片已保留。';if(state.page==='photo'){render();requestAnimationFrame(()=>document.querySelector('[role="alert"]')?.scrollIntoView({block:'nearest',behavior:'smooth'}));}return;}const controller=new AbortController();const job={id:uid(),demo,controller};const community=state.confirmingPhotos?state.photoCommunity:'';
 const communityPlace=state.confirmingPhotos&&state.photoPlace?{...state.photoPlace,label:community}:null;state.job=job;state.photoError='';if(state.page==='photo')render();try{let result;if(demo){await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,1600);controller.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('已取消','AbortError'));},{once:true});});result=sampleRooms?paFullReportData({type:'photo',demo:true,title:'房屋照片分析 · 示例',summary:'照片分析示例 · '+sampleRooms.join('、'),sampleRooms}):{type:'photo',demo:true,title:'客厅照片分析 · 示例',summary:'1 处建议现场核实，1 项照片中可见的信息。',photos:[{id:'sample',name:'客厅全景 · 示例',mimeType:'image/jpeg',dataUrl:SAMPLE_IMAGE}],observations:[sampleObservation],visible:[{title:'客厅右侧有落地窗',text:'可以看到窗户与自然光。全天采光仍需结合朝向、楼层及实际看房时间判断。'}]};}else{result=await window.HomeSafePhotoService.run({photos:state.photos.map(p=>({...p})),signal:controller.signal});if(!result||!Array.isArray(result.observations))throw new Error('服务返回的报告格式不完整');result={...result,type:'photo',demo:false,photos:state.photos.map(p=>({...p}))};}if(controller.signal.aborted||state.job!==job)return;const spaces=[...new Set(demo?(sampleRooms||['客厅']):(result.photos||[]).map(photo=>photo.room).filter(Boolean))];
const report={...result,communityLabel:community,location:communityPlace,spaceCount:spaces.length,title:(community||'未标注小区')+' · '+spaces.length+' 个空间',summary:result.summary||spaces.join('、'),id:uid(),createdAt:new Date().toISOString()};state.job=null;state.photoReport=report;if(state.page==='photo')openReport(report);else{saveReport(report);toast('报告已生成，可在记录中查看');}}catch(error){if(state.job!==job)return;state.job=null;if(error.name!=='AbortError')state.photoError=error&&error.message?'分析未完成：'+error.message:'分析未完成，照片已保留。请检查服务连接后重试。';if(state.page==='photo')render();}}
function cancelJob(){if(!state.job)return;const job=state.job;state.job=null;job.controller.abort();if(state.page==='photo')render();toast('已取消，已选照片保留');}
function districtLabel(group){
 return group.district?.trim() || '区属未注明';
}

function districtFilter(){
 const counts = new Map();
 for(const group of state.results){
  const district = districtLabel(group);
  counts.set(district,(counts.get(district)||0)+1);
 }
 const options = [['',state.results.length],...Array.from(counts).sort(([a],[b])=>a.localeCompare(b,'zh-CN'))];
 return `<section class="loc-filter-panel" id="district-filter-panel" aria-labelledby="district-filter-heading" ${state.districtExpanded?'':'hidden'}>
  <h3 id="district-filter-heading">按行政区筛选</h3>
  <div class="loc-districts">${options.map(([district,count])=>{
   const selected = district===state.searchDistrict;
   return `<button type="button" data-search-district="${escapeHtml(district)}" aria-pressed="${selected}">
    <span>${escapeHtml(district||'全部区')}</span>
    <span class="loc-district-count">${count}${selected?' <span aria-hidden="true">✓</span>':''}</span>
   </button>`;
  }).join('')}</div>
 </section>`;
}

function searchResults(){
 if(state.searching){
  return '<div class="progress" role="status"><div class="row"><span class="spinner"></span>正在匹配小区名称…</div></div>';
 }
 if(!state.searched){
  return `<div class="section-title"><h2>从已收录的小区开始</h2></div><div class="examples">${['中远两湾城','浦江颐城尚院','荻泾花园'].map(name=>`<button data-example="${name}">${name}</button>`).join('')}</div>`;
 }
 const cards = state.results.flatMap((group,index)=>{
  if(state.searchDistrict && districtLabel(group)!==state.searchDistrict)return [];
  return `<button class="loc-card" data-candidate="${index}">
   <span class="loc-building">${icon('house')}</span>
   <span class="loc-label"><strong>${escapeHtml(group.name)}</strong><small>${escapeHtml(group.city.replace(/市$/,'')+' · '+districtLabel(group))}${group.address?' · '+escapeHtml(group.address):''}</small>${group.joint?'<small class="loc-joint">联合项目，请核对范围</small>':''}</span>
   <span class="loc-card-side"><span>${group.records.length} 条历史记录</span>${icon('arrow')}</span>
  </button>`;
 });
 return `<div class="loc-section">
  <h2 aria-live="polite">小区搜索结果 <span>${cards.length}</span></h2>
  <button class="loc-filter-trigger" id="district-filter-toggle" data-action="toggle-district-filter" aria-expanded="${state.districtExpanded}" aria-controls="district-filter-panel" ${state.results.length?'':'disabled'}>上海 · ${escapeHtml(state.searchDistrict||'全部区')} <span aria-hidden="true">${state.districtExpanded?'▴':'▾'}</span></button>
 </div>${districtFilter()}${cards.length?`<div class="loc-results">${cards.join('')}</div>`:'<div class="empty"><h3>没有找到匹配的小区</h3><p>试试完整名称、别名或地址。</p></div>'}`;
}

function searchPage(){
 const target = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg>';
 return `<form id="search-form" class="loc-search">
  <input id="city" name="city" type="hidden" value="上海">
  <div class="loc-field">${icon('search')}<input id="query" name="query" aria-label="搜索小区名称或地址" value="${escapeHtml(state.query)}" placeholder="搜索小区名称或地址" autocomplete="off" maxlength="100" required><button type="button" data-action="clear-community-search" aria-label="清空搜索">${icon('close')}</button></div>
  <button type="submit" class="btn loc-submit">搜索</button>
 </form>
 <button class="loc-nearby" data-action="location-status"><span class="loc-target">${target}</span><span class="loc-label"><strong>定位找小区</strong><small>从附近的小区中选择</small></span>${icon('arrow')}</button>
 ${searchResults()}`;
}

function setDistrictFilter(expanded){
 state.districtExpanded=expanded;
 render();
 $('district-filter-toggle')?.focus({preventScroll:true});
}

function groupMatches(query,city){if(clean(city).replace(/市$/,'')!=='上海')return [];const q=clean(query);if(!q)return [];const grouped=new Map();for(const item of corpus){const names=[item.entity_name,...(item.entity_aliases||[]),...(item.entity_members||[]),item.address].filter(Boolean);if(!names.some(n=>clean(n).includes(q)))continue;const key=[item.city,item.district,item.entity_name,item.address||''].join('|');if(!grouped.has(key))grouped.set(key,{key,name:item.entity_name,city:item.city,district:item.district,address:item.address,joint:!!item.entity_members?.length,records:[]});grouped.get(key).records.push(item);}return [...grouped.values()].sort((a,b)=>(clean(b.name)===q)-(clean(a.name)===q)||a.name.localeCompare(b.name,'zh-CN'));}
async function runSearch(){const query=state.query.trim(),city=state.city.trim();if(!query||!city)return;const sequence=++searchSequence;state.searched=true;state.searching=true;state.searchDistrict='';state.districtExpanded=false;state.searchSession=uid();state.searchReports.clear();if(state.page==='search')render();await new Promise(resolve=>setTimeout(resolve,260));if(sequence!==searchSequence)return;state.results=groupMatches(query,city);state.searching=false;if(state.page==='search')render();}
function chooseCandidate(index){const group=state.results[index];if(!group)return;let report=state.searchReports.get(group.key);if(!report){report={id:uid(),type:'community',title:group.name+' · 历史问题',name:group.name,city:group.city,district:group.district,address:group.address,items:structuredClone(group.records),createdAt:new Date().toISOString(),summary:group.records[0].issue_summary};state.searchReports.set(group.key,report);}openReport(report);}
function sourceUrl(raw){try{const url=new URL(raw);return ['https:','http:'].includes(url.protocol)?escapeHtml(url.href):'';}catch{return '';}}
const paAssets={"living":"samples/sample-02.jpg","bed":"samples/sample-03.jpg","kitchen":"samples/sample-04.jpg","bath":"samples/sample-05.jpg","balcony":"samples/sample-06.jpg","livingFull":"samples/sample-07.jpg","kitchenFull":"samples/sample-08.jpg"};
const paOverviewThumbs={"living":"samples/sample-09.jpg","bed":"samples/sample-10.jpg","kitchen":"samples/sample-11.jpg","bath":"samples/sample-12.jpg","balcony":"samples/sample-13.jpg"};
const paGlyphs={
 layers:'m2 8 10-6 10 6-10 6z M2 12l10 6 10-6 M2 16l10 6 10-6',
 alert:'M10.5 3.8 2.8 18a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.5 3.8a1.7 1.7 0 0 0-3 0Z M12 9v5m0 3v.1',
 like:'M7 21H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3m0 11V10l4-6c.8-1.2 3-.5 2.6 1.2L13 9h5.5a2.4 2.4 0 0 1 2.3 3l-1.7 7a2.5 2.5 0 0 1-2.4 2H7Z',
 cube:'m12 2 9 5v10l-9 5-9-5V7Zm-9 5 9 5 9-5m-9 5v10',
 sun:'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19m12-7a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z',
 sparkle:'M12 2c1 6 3 8 10 10-7 2-9 4-10 10-2-6-4-8-10-10C8 10 10 8 12 2Z',
 shield:'M12 2c2.6 2 5.2 3 9 4v5c0 5.5-4 9-9 11-5-2-9-5.5-9-11V6c3.8-1 6.4-2 9-4Zm-4 10 3 3 5-6',
 star:'m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z',
 drop:'M12 2C9 7 5 10.8 5 15a7 7 0 1 0 14 0c0-4.2-4-8-7-13Zm3.5 14.5c-.4 1.4-1.6 2.4-3 2.5',
 wind:'M2 9h12c5 0 4-6 1-6-1 0-2 .5-2.5 1.5M2 13h17c4 0 4-5 1-5M2 17h12c4 0 4 5 1 5-1 0-2-.4-2.5-1.5',
 sofa:'M5 12V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4m-13 6H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 4 0v2h12v-2a2 2 0 0 1 4 0v3a2 2 0 0 1-2 2h-2M5 18v2m14-2v2M6 18h12',
 leaf:'M21 3C9 2 4 8 5 16c7 5 15-3 16-13ZM3 22c4-7 8-10 13-13',
 grid:'M3 3h7v7H3z m11 0h7v7h-7z M3 14h7v7H3z m11 0h7v7h-7z',
 boxes:'M3 4h12v7H3z M3 13h7v7H3z m9-2h9v9h-9z',
 forward:'M3 12h17m-7-7 7 7-7 7'
};
const paIcon=(name,cls='')=>paGlyphs[name]?`<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="${paGlyphs[name]}"/></svg>`:icon(name,cls);
const paScore=value=>Number.isFinite(value)&&value>=0&&value<=100?value:null;

const paSampleRooms=[
 {name:'客厅',score:84,thumb:'living',asset:'livingFull',summary:'空间开阔明亮，布局合理，整体状态良好。',detail:'整体表现良好，采光充足、整洁度高，空间舒适且维护状态较好。',
  metrics:[["sun","日间采光",93],["sparkle","可见整洁度",86],["cube","布局便利度",84],["shield","可见维护状态",73]],
  features:['采光通透，日间自然光充足','空间布局规整，动线顺畅','整体干净整洁，风格简约温馨'],
  preview:['面积适中，采光良好，动线顺畅，功能齐全。','墙面局部有轻微使用痕迹，建议复核是否需要翻新。','采光通风佳，视野开阔，空间利用率高。'],
  risks:[['drop','潜在渗水风险','窗户周边未见明显渗水，但建议关注雨季的密封与防水情况。','现场查看窗框接缝与窗台是否有水印或起皮。'],['wind','通风效率一般','以自然通风为主，空气流通尚可，若对通风要求较高可考虑加强换气或配置新风。','现场打开窗户，观察是否能形成对流。']],
  highlights:[['sun','采光条件优越','大面积窗户，光线充足，空间更明亮通透。'],['sofa','使用舒适度高','面积适中，布局合理，适合家庭日常起居与会客。'],['leaf','居住氛围温馨','色调柔和、搭配简约，整体氛围舒适宜居。']]},
 {name:'卧室',score:83,asset:'bed',summary:'采光充足，空间规整，居住舒适。',metrics:[["sun","采光",89],["sparkle","整洁度",85],["shield","维护状态",75],["cube","空间舒适度",83]],features:['布局规整','光线柔和','地面整洁'],risks:[['drop','窗框待核实','可现场查看窗框密封和窗台状态。','查看窗边有没有水印。']],highlights:[['sun','自然采光','窗边采光开阔。']]},
 {name:'厨房',score:80,thumb:'kitchen',asset:'kitchenFull',summary:'功能完整，台面整洁，需关注橱柜五金使用状况。',detail:'功能完整，台面整洁，动线顺畅，但收纳空间略有不足，整体使用良好。',
  metrics:[["sparkle","整洁度",82],["layers","功能完整性",83],["shield","维护状态",75],["like","使用便利度",80]],
  features:['功能分区合理','台面整洁干净','设备状态良好','采光通风较好'],
  risks:[['drop','油烟排放风险','未见清晰的油烟机工作状态，建议确认排烟效果及清洁维护情况。','现场开启油烟机并确认排烟。'],['boxes','收纳空间不足','吊柜与地柜容量一般，如烹饪频率较高，可能存在收纳压力。','打开柜门，确认内部容量、五金与受潮情况。']],
  highlights:[['sun','采光通风良好','靠窗设计，自然采光充足，通风条件较好，有助于保持空气清新。'],['grid','功能配置齐全','配备灶台、油烟机、洗槽及充足台面，满足日常烹饪需求。'],['leaf','动线高效顺畅','操作区、清洗区与备餐区衔接自然，使用流畅便捷。']]},
 {name:'卫生间',score:78,asset:'bath',summary:'干湿分离，整体整洁，建议复核防水及排水情况。',metrics:[["sparkle","整洁度",85],["layers","功能完整性",80],["shield","维护状态",69],["like","使用便利度",78]],features:['干湿分离','台面整洁'],risks:[['drop','排水待核实','照片无法验证防水和排水速度。','现场放水检查地漏及积水情况。']],highlights:[['grid','功能分区清楚','洗漱区与淋浴区分隔。']]},
 {name:'阳台',score:85,asset:'balcony',summary:'采光通风良好，可满足日常晾晒与收纳。',metrics:[["sun","采光",95],["sparkle","整洁度",85],["shield","维护状态",75],["cube","空间舒适度",85]],features:['视野开阔','晾晒空间充足'],risks:[['shield','护栏待核实','可现场确认护栏固定情况。','查看固定点有无明显松动或锈蚀。']],highlights:[['wind','通风开阔','阳台与室外连通。']]}
];
const paRoute={id:null,view:'overview',room:0,scroll:0};
const paVisitChecks=new Map();

function paRoomsForSample(report){
 return Array.isArray(report.sampleRooms)?paSampleRooms.filter(room=>report.sampleRooms.includes(room.name)):paSampleRooms;
}
function paSamplePhotos(rooms){
 return rooms.map(room=>({id:'example-room-'+room.asset,name:room.name+' · 示例',room:room.name,mimeType:'image/jpeg',dataUrl:paAssets[room.asset],sample:true}));
}

function paModel(report){
 if(report.demo){
  const rooms=paRoomsForSample(report);
  if(rooms.length===paSampleRooms.length)return {rooms,score:report.homeExample?.score??82,summary:'整体房屋采光充足、通风良好，空间整洁有序，功能布局较为完善，居住舒适度较高；但在细节上仍有少量需要关注的事项，如局部墙面痕迹、部分设施的维护状况等，建议进一步核实确认。',counts:report.homeExample?[report.homeExample.risks,4,report.homeExample.pending]:[2,4,1]};
  const score=rooms.length?Math.round(rooms.reduce((sum,room)=>sum+room.score,0)/rooms.length):null;
  return {rooms,score,summary:rooms.map(room=>room.name).join('、')+'的照片分析示例。',counts:[0,rooms.reduce((sum,room)=>sum+room.highlights.length,0),rooms.reduce((sum,room)=>sum+room.risks.length,0)]};
 }
 const photos=Array.isArray(report.photos)?report.photos:[];
 const findings=Array.isArray(report.observations)?report.observations.filter(Boolean):[];
 const visible=Array.isArray(report.visible)?report.visible.filter(Boolean):[];
 const rooms=new Map();
 function roomFor(name){
  if(!rooms.has(name))rooms.set(name,{name,score:paScore(report.spaceScores?.[name]),summary:'',metrics:[],features:[],risks:[],highlights:[]});
  return rooms.get(name);
 }
 const names=photos.map(photo=>photo?.room||'未分类');
 photos.forEach((photo,i)=>{const room=roomFor(names[i]);room.photoIndex??=i;});
 findings.forEach(item=>{
  const room=roomFor(names[item.photoIndex]||'未分类');
  room.risks.push(['alert',item.title||'待现场核实',item.phenomenon||'请核对照片所示情况。',[item.advice,item.limitation].filter(Boolean).join(' ')]);
 });
 visible.forEach(item=>{
  const room=roomFor(names[item.photoIndex]||'未分类');
  room.features.push(item.title||'照片可见信息');
  room.highlights.push(['check',item.title||'照片可见信息',item.text||'']);
 });
 for(const room of rooms.values())room.summary=room.risks[0]?.[1]||room.features[0]||'查看照片及该空间的分析详情。';
 return {rooms:[...rooms.values()],score:paScore(report.overallScore),summary:report.summary||'查看照片线索与各空间分析。',counts:[findings.filter(item=>item.type==='risk').length,visible.length,findings.filter(item=>item.type!=='risk').length]};
}

function paVisitCard(report,rooms){
 const items=report.demo
  ? [['卫生间','排水'],['厨房','排烟']].flatMap(([name,label])=>{
     const advice=rooms.find(room=>room.name===name)?.risks[0]?.[3];
     return advice?[[name+' · '+label,advice]]:[];
    })
  : rooms.flatMap(room=>room.risks.filter(risk=>risk[3]).map(([,title,,advice])=>[room.name+' · '+title,advice])).slice(0,2);
 if(!items.length)return '';
 const checked=paVisitChecks.get(report.id);
 const rows=items.map(([label,advice],index)=>`<li><label class="pa-visit-row"><input type="checkbox" data-pa-visit="${index}" ${checked?.has(index)?'checked':''}><strong>${escapeHtml(label)}</strong><span>${escapeHtml(advice)}</span></label></li>`).join('');
 return `<ul class="pa-visit-list" aria-label="现场核实重点">${rows}</ul>`;
}
$('main').addEventListener('change',event=>{
 const input=event.target;
 if(!input.matches('[data-pa-visit]')||state.page!=='report'||!state.report)return;
 const id=state.report.id,index=Number(input.dataset.paVisit);
 if(!paVisitChecks.has(id))paVisitChecks.set(id,new Set());
 const checked=paVisitChecks.get(id);
 if(input.checked)checked.add(index);
 else checked.delete(index);
});

const paReferenceAngles={客厅:"samples/sample-14.jpg",卧室:"samples/sample-15.jpg",卫生间:"samples/sample-16.jpg",阳台:"samples/sample-17.jpg"};
const paReferenceSummaries={
 客厅:'大窗采光，窗边与墙脚待查',卧室:'布局规整，床侧通道待量',厨房:'台面连贯，水槽下方待查',卫生间:'淋浴有隔断，排水待试',阳台:'视野开阔，护栏固定点待查'
};
const paReferenceWholeCopy=[
 '从日间照片看，客厅和卧室都能接收到自然光，厨房转角台面连贯，卫生间用玻璃隔断分开淋浴区和洗手台。阳台视野开阔，靠外侧的地面和玻璃护栏可见。',
 '看房时，可以先查看客厅的窗边与被沙发挡住的墙脚，再量一量卧室床侧的净宽。厨房水槽下柜、卫生间排水和阳台护栏固定点，适合结合近景逐一核实。'
];
const paReferenceLivingCopy='照片中，左侧大窗让窗边和起居区显得明亮。电视柜与沙发相对，茶几居中，家具之间留有通行空间。沙发遮住了部分墙脚，照片只能看清外露的墙面。';

function paHeader(){
 const detail=paRoute.view==='room';
 return `<div class="pa-headline"><button type="button" class="icon-button page-back" data-action="pa-back" aria-label="${detail?'返回整屋报告':'返回上一页'}">${icon('back')}</button><h1>${detail?'房间分析':'整屋分析'}</h1></div>`;
}

function paGalleryPhotos(report,rooms){
 if(!report.demo)return (report.photos||[]).filter(photo=>photo?.dataUrl).map(photo=>({src:photo.dataUrl,room:photo.room||'未分类',caption:photo.name||'空间照片'}));
 return rooms.flatMap(room=>{
  const main=paAssets[room.asset];
  const alternate=paReferenceAngles[room.name];
  return [
   {src:main,room:room.name,caption:'整体视角'},
   {src:alternate||main,room:room.name,caption:alternate?(room.name==='阳台'?'护栏近景':'另一视角'):'局部视角',crop:!alternate}
  ];
 });
}

function paGallery(photos,detail){
 if(!photos.length)return '<p class="pa-no-items">暂无空间照片</p>';
 const key=detail?'roomPhoto':'overviewPhoto';
 const index=Math.min(paRoute[key]||0,photos.length-1);
 const active=photos[index],e=escapeHtml;
 const image=(photo,thumb=false)=>`<img ${photo.crop?'class="pa-crop"':''} src="${e(photo.src)}" alt="${thumb?'':e(photo.room+' · '+photo.caption)}" draggable="false">`;
 const slides=photos.map((photo,i)=>`<button class="pa-gallery-slide" type="button" data-action="pa-photo" data-caption="${e(photo.caption)}" tabindex="${i===index?0:-1}" aria-label="放大${e(photo.room)}照片，第 ${i+1} 张">${image(photo)}<span class="pa-gallery-badge pa-gallery-room">${icon('camera')}${e(photo.room)}</span><span class="pa-gallery-badge pa-gallery-counter">${i+1} / ${photos.length}</span></button>`).join('');
 const thumbnails=photos.map((photo,i)=>`<button class="pa-thumb" type="button" data-action="pa-thumb" data-photo-index="${i}" aria-pressed="${i===index}" aria-label="${e(photo.room)}，第 ${i+1} 个视角">${image(photo,true)}</button>`).join('');
 return `<div class="pa-gallery">
  <div class="pa-gallery-main" role="group" aria-label="照片相册" data-photo-key="${key}" data-active="${index}">${slides}</div>
  <div class="pa-gallery-foot"><div class="pa-gallery-thumbs" role="group" aria-label="照片视角">${thumbnails}</div>${detail?`<div class="pa-gallery-side"><strong>${e(active.caption)}</strong><span>轻点缩略图或滑动大图</span></div>`:''}</div>
  ${detail?'':`<p class="pa-gallery-caption">${e(active.caption)}</p>`}
 </div>`;
}

function paUpdateGallery(track,index){
 const gallery=track.closest('.pa-gallery');
 const strip=gallery.querySelector('.pa-gallery-thumbs');
 const active=track.children[index];
 if(!active)return;
 paRoute[track.dataset.photoKey]=index;
 track.dataset.active=index;
 Array.from(track.children).forEach((slide,i)=>{slide.tabIndex=i===index?0:-1;});
 Array.from(strip.children).forEach((button,i)=>{button.setAttribute('aria-pressed',String(i===index));});
 const caption=gallery.querySelector('.pa-gallery-caption,.pa-gallery-side strong');
 caption.textContent=active.dataset.caption;
 const rect=strip.children[index].getBoundingClientRect(),visible=strip.getBoundingClientRect();
 if(rect.right>visible.right)strip.scrollLeft+=rect.right-visible.right;
 if(rect.left<visible.left)strip.scrollLeft-=visible.left-rect.left;
}

function paRestoreGallery(){
 paGalleryResize.disconnect();
 const track=document.querySelector('.pa-gallery-main');
 if(!track)return;
 const index=Number(track.dataset.active);
 track.dataset.width=track.clientWidth;
 track.scrollLeft=track.children[index].offsetLeft;
 paUpdateGallery(track,index);
 paGalleryResize.observe(track);
}

const paGalleryResize=new ResizeObserver(entries=>{
 for(const {target:track} of entries){
  if(!track.clientWidth||Number(track.dataset.width)===track.clientWidth)continue;
  const index=Number(track.dataset.active);
  track.dataset.width=track.clientWidth;
  track.scrollLeft=track.children[index].offsetLeft;
  paUpdateGallery(track,index);
 }
});

function paSelectPhoto(index,focus){
 const track=document.querySelector('.pa-gallery-main');
 const slide=track?.children[index];
 if(!slide)return;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 track.scrollTo({left:slide.offsetLeft,behavior:reduced?'instant':'smooth'});
 if(focus==='main')slide.focus({preventScroll:true});
 else if(focus==='thumb')track.closest('.pa-gallery').querySelectorAll('.pa-thumb')[index].focus({preventScroll:true});
}

$('main').addEventListener('scroll',event=>{
 const track=event.target;
 if(!track.matches('.pa-gallery-main')||!track.clientWidth||Number(track.dataset.width)!==track.clientWidth)return;
 const index=Math.min(track.children.length-1,Math.max(0,Math.round(track.scrollLeft/track.clientWidth)));
 if(index!==Number(track.dataset.active))paUpdateGallery(track,index);
 },{capture:true,passive:true});
$('main').addEventListener('keydown',event=>{
 const gallery=event.target.closest('.pa-gallery');
 if(!gallery||!['ArrowLeft','ArrowRight'].includes(event.key))return;
 const track=gallery.querySelector('.pa-gallery-main');
 const thumb=event.target.closest('.pa-thumb');
 const slide=event.target.closest('.pa-gallery-slide');
 const index=thumb?Number(thumb.dataset.photoIndex):slide?Array.from(track.children).indexOf(slide):Number(track.dataset.active);
 event.preventDefault();
 paSelectPhoto(index+(event.key==='ArrowRight'?1:-1),thumb?'thumb':'main');
});

function paBar(score,extra=''){
 return `<span class="pa-bar ${extra}" role="meter" aria-valuenow="${score}" aria-valuemin="0" aria-valuemax="100" aria-label="评分"><span style="--score:${score}%"></span></span>`;
}

function paFindings(advantages,risks,checklist=''){
 const e=escapeHtml;
 function row(item,isRisk,extras=''){
  if(!item)return '';
  const text=`<strong>${e(item[0])}</strong>${item[1]?`<p>${e(item[1])}</p>`:''}`;
  return `<div class="pa-finding${isRisk?' is-risk':''}"><span class="pa-finding-tag">${paIcon(isRisk?'alert':'check')}${isRisk?'待核实':'优势'}</span><div class="pa-finding-content">${extras?`<details><summary>${text}</summary>${extras}</details>`:text}</div></div>`;
 }
 return advantages.length||risks.length?`<section class="pa-report-section"><h2 class="pa-section-title">优势与风险</h2><div class="pa-findings">${advantages.map(item=>row(item,false)).join('')}${risks.map((item,index)=>row(item,true,index===0?checklist:'')).join('')}</div></section>`:'';
}

function photoLocationCard(report){
 const location=report.location;
 const label=report.communityLabel||(location&&location.label)||'';
 if(!label&&!location)return '';
 const hasPin=!!(location&&Number.isFinite(location.lng)&&Number.isFinite(location.lat));
 return `<section class="pa-location-card">
  <div class="pa-location-head"><span class="pa-location-icon">${icon('pin')}</span><div><small>小区标签</small><strong>${escapeHtml(label||'未命名标签')}</strong></div></div>
  <p class="pa-location-note">${hasPin?'已记录位置，可以在地图上回看':'只打了标签，没有记录位置'}</p>
  ${hasPin?`<button type="button" class="pa-location-btn" data-action="show-location">在地图上查看${icon('arrow')}</button>`:''}
 </section>`;
}

function paOverview(report,model){
 const e=escapeHtml,rooms=model.rooms,photos=paGalleryPhotos(report,rooms);
 const fullExample=report.demo&&rooms.length===paSampleRooms.length;
 const evaluation=fullExample?paReferenceWholeCopy:[model.summary];
 const firstAdvantage=rooms.find(room=>room.highlights.length)?.highlights[0];
 const firstRisk=rooms.find(room=>room.risks.length)?.risks[0];
 const findings=paFindings(
  fullExample?[['主要活动区日间光线较好','客厅窗边及起居区较亮，卧室靠窗位置也有自然光。']]:firstAdvantage?[firstAdvantage.slice(1)]:[],
  fullExample?[['优先核实遮挡处与用水部位','看窗边和墙脚有无水印，查看水槽下柜并试放水检查地漏。']]:firstRisk?[[firstRisk[1],firstRisk[3]||firstRisk[2]]]:[],
  paVisitCard(report,rooms)
 );
 const rows=rooms.map((room,index)=>{
  const src=room.asset?paAssets[room.asset]:report.photos?.[room.photoIndex]?.dataUrl;
  return `<button type="button" class="pa-room-row" data-action="pa-detail" data-room-index="${index}" aria-label="查看${e(room.name)}分析详情">${src?`<img src="${e(src)}" alt="">`:`<span class="pa-row-placeholder">${icon('house')}</span>`}<span><strong>${e(room.name)}</strong><small>${e((report.demo&&paReferenceSummaries[room.name])||room.summary)}</small></span>${icon('arrow')}</button>`;
 }).join('');
 return `<section class="pa-wrap pa-whole-score">
  <div class="pa-report-heading"><h2 class="pa-display-title">整屋分析结果</h2><span class="pa-report-meta">${rooms.length} 个空间 / ${photos.length} 个照片视角</span></div>
  <div class="pa-total"><div class="pa-total-value"><b>${model.score??'—'}</b>${model.score==null?'':'<span>/ 100</span>'}</div><div class="pa-total-copy"><strong>综合评分</strong><span>${model.score==null?'暂无评分':rooms.length+' 个空间的综合评分'}</span></div></div>
  ${model.score==null?'':paBar(model.score,'pa-total-bar')}
 </section>
 ${photoLocationCard(report)}
 <div class="pa-wrap">
  <section class="pa-photo-block"><div class="pa-title-row"><h2 class="pa-section-title">整屋照片</h2>${photos.length>1?'<span class="pa-hint">点缩略图或滑动大图</span>':''}</div>${paGallery(photos,false)}</section>
  <section class="pa-report-section"><h2 class="pa-section-title">整屋评价</h2><div class="pa-text">${evaluation.map(text=>'<p>'+e(text)+'</p>').join('')}</div></section>
  ${findings}
  <section class="pa-report-section pa-spaces"><div class="pa-title-row"><h2 class="pa-section-title">查看房间</h2><span class="pa-hint">选择一个空间</span></div>${rows?`<div class="pa-rooms-list">${rows}</div>`:'<p class="pa-no-items">暂无可分组的空间资料。</p>'}</section>
 </div>`;
}

function paRoomDetail(report,room,rooms){
 const e=escapeHtml;
 const photos=paGalleryPhotos(report,rooms).filter(photo=>photo.room===room.name);
 const living=report.demo&&room.name==='客厅';
 const metrics=room.metrics.map(([,label,value,max])=>[label,max===10&&Number.isFinite(Number(value))?Math.round(Number(value)*10):value]);
 const rows=metrics.map(([label,value])=>`<div class="pa-metric"><span>${e(label)}</span>${Number.isFinite(value)?paBar(value)+`<b>${value}</b>`:`<b class="pa-qualitative">${e(value)}</b>`}</div>`).join('');
 const findings=paFindings(
  living?[['窗边自然光充足','大窗与浅色墙面让起居区显得明亮，白天看房时可留意远离窗户的位置。']]:room.highlights.map(item=>item.slice(1)),
  living?[['窗边与沙发后墙脚','到现场查看窗框接缝和窗台有无水印，再看沙发后墙脚有无起皮或返潮痕迹。']]:room.risks.map(([,title,description,advice])=>[title,[description,advice].filter(Boolean).join(' ')])
 );
 const description=living?paReferenceLivingCopy:room.detail||room.risks[0]?.[2]||room.summary;
 return `<div class="pa-wrap">
  <nav class="pa-room-tabs" aria-label="切换空间">${rooms.map((item,index)=>`<button type="button" data-action="pa-room-tab" data-room-index="${index}" aria-pressed="${item===room}">${e(item.name)}</button>`).join('')}</nav>
  ${paGallery(photos,true)}
  <div class="pa-room-heading"><h2 class="pa-display-title">${e(room.name)}</h2><div class="pa-room-score"><span>空间评分</span><b>${room.score??'—'}</b>${room.score==null?'':'<span>/ 100</span>'}</div></div>
  <section class="pa-room-description"><h3>空间整体说明</h3><p class="pa-text">${e(description)}</p></section>
  ${rows?`<section class="pa-report-section"><div class="pa-title-row"><h2 class="pa-section-title">分项评分</h2><span class="pa-hint">满分 100</span></div><div class="pa-metrics">${rows}</div></section>`:''}
  ${findings}
 </div>`;
}

function paPage(report){
 const model=paModel(report);
 return paRoute.view==='room'&&model.rooms[paRoute.room]?paRoomDetail(report,model.rooms[paRoute.room],model.rooms):paOverview(report,model);
}

function paFullReportData(report){
 if(!report.demo)return report;
 const rooms=paRoomsForSample(report);
 return {...report,
  photos:paSamplePhotos(rooms),
  observations:rooms.flatMap((room,photoIndex)=>room.risks.map(([,title,phenomenon,advice])=>({title:room.name+' · '+title,phenomenon,advice,photoIndex}))),
  visible:rooms.flatMap(room=>room.highlights.map(([,title,text])=>({title:room.name+' · '+title,text})))
 };
}

function paAction(target){
 const report=state.report;
 if(state.page!=='report'||report?.type!=='photo')return;
 const action=target.dataset.action;
 if(action==='pa-back'||action==='pa-other'){
  if(paRoute.view==='overview'){back();return;}
  paRoute.other=action==='pa-other';
  history.back();
  return;
 }
 if(action==='pa-thumb'){
  paSelectPhoto(Number(target.dataset.photoIndex),'thumb');
  return;
 }
 if(action==='pa-room-tab'){
  const room=Number(target.dataset.roomIndex);
  if(paRoute.view!=='room'||room===paRoute.room||!paModel(report).rooms[room])return;
  paRoute.room=room;
  paRoute.roomPhoto=0;
  history.replaceState({photoReport:report.id,view:'room',room},'');
  render();
  document.querySelector('.pa-room-tabs [aria-pressed="true"]')?.focus({preventScroll:true});
  return;
 }
 if(action==='pa-photo'){
  const image=target.querySelector('img');
  if(image)openViewer(image.src,image.alt);
  return;
 }
 paRoute.scroll=window.scrollY;
 paRoute.trigger=target.getAttribute('aria-label');
 if(action==='pa-detail'){paRoute.room=Number(target.dataset.roomIndex);paRoute.roomPhoto=0;}
 paRoute.view=action==='pa-detail'?'room':'full';
 history.pushState({photoReport:report.id,view:paRoute.view,room:paRoute.room},'');
 render();window.scrollTo(0,0);focusPage();
}

window.addEventListener('popstate',event=>{
 if(state.page!=='report'||state.report?.type!=='photo'||state.report.id!==paRoute.id)return;
 const route=event.state?.photoReport===paRoute.id?event.state:null;
 if(!route&&paRoute.view==='overview')return;
 paRoute.view=route?.view||'overview';
 if(route)paRoute.room=route.room;
 render();
 if(route){window.scrollTo(0,0);focusPage();return;}
 window.scrollTo(0,paRoute.scroll);
 const trigger=[...document.querySelectorAll('[data-action="pa-detail"]')].find(button=>button.getAttribute('aria-label')===paRoute.trigger);
 if(paRoute.other)document.querySelector('.pa-spaces')?.scrollIntoView({block:'start'});
 (trigger||document.querySelector('.pa-room-row'))?.focus({preventScroll:true});
 paRoute.other=false;
});

function reportPage(report){
 return report.type==='community'?communityReport(report):paRoute.view==='full'?photoReport(paFullReportData(report)):paPage(report);
}

function riskTier(score){
 if(score===null)return 'unscored';
 if(score<30)return 'low';
 return score<=60?'mid':'high';
}

function photoSaveMarkup(report){
 if(state.saveStates.get(report.id)==='saved')return `<span class="pr-saved">${icon('check')} 已保存</span>`;
 return saveMarkup(report);
}

function scorePanel(report,photoCount,issueCount){
 const score=homeRecordScore(report);
 const tier=riskTier(score);
 const label={low:'低风险',mid:'中风险',high:'高风险',unscored:'暂无评分'}[tier];
 const number=score===null?'—':String(score);
 const ranges=[['low','低于 30'],['mid','30–60'],['high','高于 60']];
 const arc='M 22 108 A 90 90 0 0 1 202 108';
 return `<section class="pr-score pr-${tier}" aria-label="${score===null?'风险指数暂无评分':'风险指数 '+number+' 分，'+label}">
  <div class="pr-score-heading"><h2>风险指数</h2><span>${label}</span></div>
  <div class="pr-gauge"><svg viewBox="0 0 224 122" aria-hidden="true"><path class="pr-track" d="${arc}" pathLength="100"/>${score>0?`<path class="pr-fill" d="${arc}" pathLength="100" stroke-dasharray="${score} 100"/>`:''}</svg><div class="pr-number${number.length>6?' pr-long-score':''}">${number}<small>/ 100</small></div></div>
  <div class="pr-legend" aria-label="风险指数分档">${ranges.map(([key,text])=>`<span${key===tier?' class="pr-legend-active"':''}><i></i>${text}</span>`).join('')}</div>
  <div class="pr-score-meta"><span>已分析 ${photoCount} 张照片</span><span>${issueCount} 项待核实</span></div>
 </section>`;
}

function reportPhotoButton(photo,index,marker,issueNumber){
 if(!photo?.dataUrl)return '';
 const name=photo.room||photo.name||('照片 '+(index+1));
 const validMarker=marker&&Number.isFinite(marker.x)&&Number.isFinite(marker.y)&&marker.x>=0&&marker.x<=1&&marker.y>=0&&marker.y<=1;
 return `<button class="pr-photo" data-report-photo="${index}" aria-label="放大${escapeHtml(name)}">
  <span class="pr-thumb"><img src="${escapeHtml(photo.dataUrl)}" alt="${escapeHtml(name)}">${validMarker?`<span class="pr-marker" style="left:${marker.x*100}%;top:${marker.y*100}%">${issueNumber}</span>`:''}</span>
  <span class="pr-photo-copy"><strong>${issueNumber?'对应照片':'照片 '+(index+1)}</strong><small>${escapeHtml(name)} · 点击放大</small></span>${icon('expand')}
 </button>`;
}

function photoIssue(report,observation,index,photos){
 const photoIndex=Number.isInteger(observation.photoIndex)?observation.photoIndex:-1;
 const exampleAdvice=report.demo&&observation.advice===sampleObservation.advice;
 const advice=exampleAdvice?'<ol><li>查看沙发背后和墙脚有没有水印、起皮。</li><li>询问这里是否漏过水或做过维修。</li></ol>':`<p>${escapeHtml(observation.advice||'结合现场情况进一步核实。')}</p>`;
 return `<article class="pr-issue" id="issue-${index}">
  <div class="pr-issue-heading"><span class="pr-numbered">${index+1}</span><h3>${escapeHtml(observation.title||'待核实事项')}</h3></div>
  <p class="pr-phenomenon">${escapeHtml(observation.phenomenon)}</p>
  ${reportPhotoButton(photos[photoIndex],photoIndex,observation.marker,index+1)}
  <div class="pr-checklist"><h4>到现场怎么查</h4>${advice}</div>
  <details class="pr-detail"><summary>判断局限 ${communityChevron}</summary><p>${escapeHtml(observation.limitation||'需结合现场情况进一步核实。')}</p></details>
 </article>`;
}

function photoReport(report){
 const observations=Array.isArray(report.observations)?report.observations:[];
 const photos=Array.isArray(report.photos)?report.photos:[];
 const visible=Array.isArray(report.visible)?report.visible:[];
 const related=new Set(observations.map(observation=>observation.photoIndex));
 const otherPhotos=photos.flatMap((photo,index)=>related.has(index)||!photo?.dataUrl?[]:[reportPhotoButton(photo,index)]);
 return `
  <div class="pr-title"><div>${report.demo?'<span class="pr-kicker">示例报告</span>':''}<h1>${escapeHtml(report.demo?(report.sampleRooms?'房屋照片分析':'客厅照片分析'):report.title||'照片分析报告')}</h1></div><div id="save-state" aria-live="polite">${photoSaveMarkup(report)}</div></div>
  ${scorePanel(report,photos.length,observations.length)}
  ${!report.demo&&report.summary?`<p class="pr-phenomenon">${escapeHtml(report.summary)}</p>`:''}
  <div class="pr-section-title"><h2>现场核实清单</h2><span>${observations.length} 项</span></div>
  ${observations.length?observations.map((observation,index)=>photoIssue(report,observation,index,photos)).join(''):'<p class="pr-empty">本次照片未识别到明确待核实项。</p>'}
  ${otherPhotos.length?`<details class="pr-other"><summary><span>其他分析照片 <small>${otherPhotos.length} 张</small></span>${communityChevron}</summary><div class="pr-gallery">${otherPhotos.join('')}</div></details>`:''}
  ${visible.length?`<details class="pr-other"><summary><span>照片中可见 <small>${visible.length} 项</small></span>${communityChevron}</summary>${visible.map(item=>`<div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.text)}</p></div>`).join('')}</details>`:''}
  <button class="btn secondary pr-followup" data-action="continue-search">${icon('search')} 继续查小区历史问题</button>
  <details class="pr-more"><summary>更多操作 ${communityChevron}</summary><div><button class="btn secondary" data-action="download">导出 JSON</button><button class="btn secondary" data-action="print">打印 / PDF</button></div></details>`;
}

const communityChevron = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

function communitySaveMarkup(report){
 if(state.saveStates.get(report.id)==='saved')return `<span class="cr-saved">${icon('check')} 已保存</span>`;
 return saveMarkup(report);
}

function elevatorScope(record){
 // The reviewed SH043 excerpt distinguishes the building case from the community tally.
 const verifiedProgress = '截至2024-08-12公开资料，报道记载241号楼两部电梯一部已更换、一部更换中；全小区188部启动更换，其中142部完成、46部施工。';
 if(record.id!=='SH043'||record.record_date!=='2024-08-12'||record.handling_progress!==verifiedProgress)return '';
 return `<div class="cr-scope">
  <h3>电梯更换进展</h3>
  <p class="cr-asof">截至 ${escapeHtml(record.record_date)} 的公开报道</p>
  <div class="cr-scope-row">
   <div class="cr-scope-name"><span class="cr-scope-icon">${icon('house')}</span><strong>241 号楼</strong><span>报道涉及 2 部电梯</span></div>
   <div class="cr-scope-metrics"><span><b>1 部</b> 已更换</span><span><b>1 部</b> 更换中</span></div>
  </div>
  <div class="cr-scope-row">
   <div class="cr-scope-name"><span class="cr-scope-icon">${icon('record')}</span><strong>全小区</strong><span>188 部已启动更换</span></div>
   <div class="cr-scope-metrics"><span><b>142 部</b> 已完成</span><span><b>46 部</b> 施工中</span></div>
  </div>
  <p class="cr-asof cr-asof-note">现场现状未核验。</p>
 </div>`;
}

function communityDetails(record){
 const fields = [
  ['涉及主体',record.entity_name],
  ['涉及范围',record.affected_scope],
  ['当事人或代表反映',record.reported_claims?.join('\n')||'本条未单列当事人主张。'],
  ['发布材料记载或回应',record.official_findings?.join('\n')||record.evidence_nature||'资料未说明'],
  ['当时处理进展',record.handling_progress],
  ['状态原文',record.status_label],
  ['记录时点说明',record.record_date_note],
  ['资料适用范围',record.limitations],
  ['原文标题',record.source_title],
  ['来源定位',record.source_locator],
  ['资料性质',[record.source_type,record.evidence_nature].filter(Boolean).join(' · ')],
  ['记录编号',record.id],
 ];
 return `<details class="cr-disclosure"><summary><span>${icon('record')} 事件详情</span>${communityChevron}</summary><dl class="cr-field-list">${fields.filter(([,value])=>value).map(([label,value])=>`<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl></details>`;
}

function communityIssue(record){
 const e=escapeHtml;
 const progress=elevatorScope(record);
 const title=progress?'电梯老化与更换进展':record.tags?.filter(tag=>tag!=='历史问题').slice(0,3).join('、')||'历史问题记录';
 const date=record.record_date||record.published_at;
 const dateLabel=record.record_date?'记录时间':'发布日期';
 const quotes=record.quotes||[];
 const link=sourceUrl(record.source_url);
 const provenance=[['资料来源',record.source_name],['资料收集日期',record.collected_at]];
 if(record.record_date&&record.published_at&&record.record_date!==record.published_at)provenance.push(['发布日期',record.published_at]);
 return `<article class="cr-card">
  <div class="cr-meta-line"><span class="cr-record-date">${date?dateLabel+' '+e(date):'记录时间未明示'}</span>${record.status_label?`<span class="cr-status${progress?'':' cr-status-neutral'}">${e(progress?'部分完成':record.status_label)}</span>`:''}</div>
  <h2>${e(title)}</h2>
  <p class="cr-lead">${e(record.issue_summary)}</p>
  ${progress||(record.affected_scope?`<div class="cr-scope"><h3>涉及范围</h3><p class="cr-scope-text">${e(record.affected_scope)}</p></div>`:'')}
  ${communityDetails(record)}
  ${quotes.length?`<section class="cr-evidence" aria-label="原文证据"><div class="cr-section-title"><h3><span class="cr-quote-mark" aria-hidden="true">“</span>原文证据</h3><span>共 ${quotes.length} 段</span></div>${quotes.map(quote=>`<blockquote>${e(quote)}</blockquote>`).join('')}</section>`:''}
  <section class="cr-provenance" aria-label="资料记录"><h3>资料记录</h3><dl>${provenance.map(([label,value])=>`<div><dt>${label}</dt><dd>${e(value||'未注明')}</dd></div>`).join('')}</dl></section>
  ${link?`<a class="btn cr-source" href="${link}" target="_blank" rel="noopener noreferrer">打开来源原文 ${icon('arrow')}</a>`:'<p class="cr-source-missing">来源链接暂缺，可按资料名称继续查找。</p>'}
 </article>`;
}

function communityReport(report){
 const illustration = `<svg class="cr-skyline" viewBox="0 0 176 120" aria-hidden="true">
        <defs><linearGradient id="cr-building" x2="0" y2="1"><stop stop-color="#D6E9F3"/><stop offset="1" stop-color="#F3F8FB"/></linearGradient></defs>
        <g fill="url(#cr-building)" stroke="#9BBBCB" stroke-width="1.1" stroke-linejoin="round">
         <path d="M18 114V78l28-10 17 8v38z"/><path d="M47 114V54l33-12 19 8v64z"/><path d="M83 114V29l37-14 21 9v90z"/><path d="M128 114V52l28-10 17 8v64z"/>
        </g>
        <g fill="none" stroke="#ADC9D7" stroke-width="1" stroke-linecap="round">
         <path d="M46 68v46m34-72v72m40-99v99m36-72v72M18 114h155"/>
         <path d="m25 87 14-5m-14 14 14-5m-14 14 14-5m16-32 17-6m-17 16 17-6m-17 16 17-6m-17 16 17-6m20-54 20-7m-20 18 20-7m-20 18 20-7m-20 18 20-7m-20 18 20-7m-20 18 20-7m22-35 14-5m-14 15 14-5m-14 15 14-5m-14 15 14-5"/>
        </g>
       </svg>`;
 return `<section class="cr-hero">${illustration}<div class="cr-hero-copy">
  <span class="cr-kicker">公开资料 · 历史记录</span>
  <h1>${escapeHtml(report.name)}</h1>
  <p>${escapeHtml([report.city,report.district,report.address].filter(Boolean).join(' · '))}</p>
  <div class="cr-hero-meta"><span>${report.items.length} 条历史问题记录</span><span class="cr-save-state" id="save-state" aria-live="polite">${communitySaveMarkup(report)}</span></div>
  <button type="button" class="btn secondary cr-map" data-action="show-community-location">${icon('pin')}在地图上查看小区</button>
 </div></section>
 ${report.items.map(communityIssue).join('')}
 <details class="cr-more"><summary>更多操作 ${communityChevron}</summary><div><button class="btn secondary" data-action="download">导出 JSON</button><button class="btn secondary" data-action="print">打印 / PDF</button></div></details>`;
}

function recordsPage(){const items=state.records.filter(r=>state.filter==='all'||r.type===state.filter).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));return `<div class="intro"><h1>看过的房</h1></div><div class="filters" role="group" aria-label="按报告类型筛选">${[['all','全部'],['photo','照片分析'],['community','小区查询']].map(([value,label])=>`<button aria-pressed="${state.filter===value}" data-filter="${value}">${label}</button>`).join('')}</div>${state.recordsLoading?'<div class="progress" role="status"><span class="spinner"></span> 正在读取记录…</div>':state.recordError?`<div class="error" role="alert">${state.recordError}<button class="btn text" data-action="reload-records">重试读取</button></div>`:items.length?items.map(r=>`<article class="record"><button class="record-open" data-open-record="${r.id}"><span class="chip ${r.demo?'warn':'neutral'}">${r.type==='photo'?(r.demo?'照片分析 · 示例':'照片分析'):'小区查询'}</span><h3>${escapeHtml(r.title)}</h3>${r.type==='photo'?'<time class="jt-date">'+icon('clock')+formatTime(r.createdAt)+'</time>':'<p class="small muted">'+formatTime(r.createdAt)+'</p>'}<p class="record-summary">${escapeHtml(r.summary||'打开查看完整报告')}</p></button><button class="icon-button record-delete" data-delete="${r.id}" aria-label="删除${escapeHtml(r.title)}">${icon('trash')}</button></article>`).join(''):`<div class="empty"><span class="empty-icon">${icon('record')}</span><h2>${state.filter==='all'?'还没有保存的报告':'还没有这类报告'}</h2><p>生成报告后会自动保存在这里，<br>方便下次看房时重新打开。</p><button class="btn" data-tab="${state.filter==='community'?'search':'photo'}">${state.filter==='community'?'去查询小区':'去分析照片'}</button></div>`}`;}
async function deleteRecord(id){const report=state.records.find(r=>r.id===id);if(!report||state.deleting?.has(id))return;state.deleting??=new Set();state.deleting.add(id);try{await storage('readwrite',store=>store.delete(id));state.records=state.records.filter(r=>r.id!==id);state.saveStates.delete(id);if(state.page==='records')render();const restore=async()=>{try{await storage('readwrite',store=>store.put(report));state.records=state.records.filter(r=>r.id!==id);state.records.push(report);state.saveStates.set(id,'saved');if(state.page==='records')render();toast('报告已恢复');}catch{toast('恢复失败，请检查存储后重试',restore,'重试恢复');}};toast('已删除「'+report.title+'」',restore);}catch{toast('删除失败，报告已保留，请重试');}finally{state.deleting.delete(id);}}
function openViewer(src,title){zoom=1;$('viewer-image').src=src;$('viewer-image').alt=title;$('viewer-title').textContent=title;updateZoom();$('viewer').showModal();}
function updateZoom(){$('viewer-image').style.width=zoom*100+'%';$('zoom-label').textContent=Math.round(zoom*100)+'%';$('zoom-out').disabled=zoom<=1;$('zoom-in').disabled=zoom>=3;}
$('zoom-in').onclick=()=>{zoom=Math.min(3,zoom+.5);updateZoom();};$('zoom-out').onclick=()=>{zoom=Math.max(1,zoom-.5);updateZoom();};
function download(){const report=state.report;if(!report)return;const copy=structuredClone(report.type==='photo'?paFullReportData(report):report);copy.exportedAt=new Date().toISOString();const blob=new Blob([JSON.stringify(copy,null,2)],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='房小查-'+report.title.replace(/[\\/:*?"<>|]/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已导出 JSON 报告，可用于留存');}
document.addEventListener('click',async event=>{const target=event.target.closest('button,a');if(!target||target.disabled)return;if(target.dataset.action?.startsWith('pa-')){paAction(target);return;}if(target.hasAttribute('data-close')){target.closest('dialog').close();return;}if(target.dataset.tab){navigate(target.dataset.tab);return;}if(target.dataset.remove){if(state.job){toast('请先取消分析再调整照片');return;}state.photos=state.photos.filter(p=>p.id!==target.dataset.remove);render();return;}if(target.dataset.view){const photo=state.photos.find(p=>p.id===target.dataset.view);if(photo)openViewer(photo.dataUrl,photo.name);return;}if(target.dataset.reportPhoto!==undefined){const p=state.report&&paFullReportData(state.report).photos?.[Number(target.dataset.reportPhoto)];if(p)openViewer(p.dataUrl,p.name);return;}if(target.dataset.issue){const item=$(target.dataset.issue);if(item){item.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});item.classList.add('highlight');setTimeout(()=>item.classList.remove('highlight'),1800);}return;}if(target.dataset.example){state.query=target.dataset.example;state.city='上海';await runSearch();return;}if(target.dataset.searchDistrict!==undefined){
 state.searchDistrict=target.dataset.searchDistrict;
 setDistrictFilter(false);
 return;
}if(target.dataset.candidate!==undefined){chooseCandidate(Number(target.dataset.candidate));return;}if(target.dataset.homeExample){openHomeExample(target.dataset.homeExample);return;}if(target.dataset.openRecord){const report=state.records.find(r=>r.id===target.dataset.openRecord);if(report){state.saveStates.set(report.id,'saved');openReport(report);}return;}if(target.dataset.delete){await deleteRecord(target.dataset.delete);return;}if(target.dataset.filter){state.filter=target.dataset.filter;render();return;}switch(target.dataset.action){
case 'home-notices':$('home-notices').showModal();break;
 case 'show-location':{
  const report=state.report;
  const location=report&&report.location;
  const picker=window.HomeSafeLocationPicker;
  if(!location||!Number.isFinite(location.lng)||!Number.isFinite(location.lat)){toast('这个标签没有记录位置');break;}
  if(!picker||!picker.openViewer){toast('地图尚未准备好，请稍后再试');break;}
  picker.openViewer({label:location.label||report.communityLabel||'小区标签',address:location.address,lng:location.lng,lat:location.lat});
  break;
 }
 case 'show-community-location':{
  const report=state.report;
  const picker=window.HomeSafeLocationPicker;
  if(!report||!picker||!picker.openViewerByName){toast('地图尚未准备好，请稍后再试');break;}
  const address=[report.district,report.address].filter(Boolean).join(' ');
  picker.openViewerByName(report.name,address).then(ok=>{if(!ok)toast('没有找到这个小区的坐标，可以先搜索小区名称');});
  break;
 }
case 'tag-open':openPhotoTag();break;
case 'tag-locate':if(photoTag.allowed)lookupPhotoTag();else $('photo-tag-permission').showModal();break;
case 'tag-allow':photoTag.allowed=true;$('photo-tag-permission').close();lookupPhotoTag();break;
case 'tag-deny':$('photo-tag-permission').close();showPhotoTag('denied');break;
case 'tag-cancel':stopPhotoTagLookup();showPhotoTag('idle');document.querySelector('[data-action="tag-locate"]').focus({preventScroll:true});break;
case 'tag-pick':pickPhotoTag(Number(target.dataset.tagIndex));break;
case 'toggle-district-filter':
 setDistrictFilter(!state.districtExpanded);break;
case 'location-status':
  openMapPicker();break;
 case 'tag-map':
  openTagMapPicker();break;
case 'clear-community-search':
 ++searchSequence;
 Object.assign(state,{query:'',results:[],searched:false,searching:false,searchDistrict:'',districtExpanded:false});
 render();$('query').focus();break;
case 'open-photo-confirm':
 if(!state.uploadInitialized){
  state.uploadInitialized=true;
  if(!window.HomeSafePhotoService&&!state.photos.length)state.photos=paSamplePhotos(paSampleRooms);
 }
 state.confirmingPhotos=true;render();window.scrollTo(0,0);focusPage();break;
case 'close-photo-confirm':
 state.confirmingPhotos=false;render();window.scrollTo(0,0);document.querySelector('.home-primary')?.focus({preventScroll:true});break;
case 'album':
 state.uploadRoom=target.dataset.room||'';
 document.querySelectorAll('.confirm-tags [data-room]').forEach(button=>{
  button.setAttribute('aria-pressed',String(button.dataset.room===state.uploadRoom));
 });
 $('album').dataset.room=state.uploadRoom;
 $('album').click();break;case 'camera':$('camera').click();break;case 'help':$('help').showModal();break;case 'back':if(state.report?.type==='photo'&&paRoute.view==='full')history.back();else back();break;case 'analyze':if(state.photos.some(photo=>photo.sample)){await analyze(true,state.photos.map(photo=>photo.room));break;}if(window.HomeSafePhotoService&&state.photos.length){$('service-label').textContent=window.HomeSafePhotoService.label||'团队配置的照片分析服务';const keyInput=$('model-key');if(keyInput)keyInput.value=window.HomeSafePhotoService.getKey?.()||'';const keyHint=$('key-hint');if(keyHint){keyHint.textContent='Key 只在本次打开页面期间保留在内存，不会写入仓库或浏览器存储。';keyHint.classList.remove('is-error');}$('consent').showModal();}else await analyze(false);break;case 'confirm-analyze':{const key=($('model-key')?.value||'').trim();if(window.HomeSafePhotoService){if(!key){const keyHint=$('key-hint');if(keyHint){keyHint.textContent='请先填入 DeepSeek API Key，再开始分析。';keyHint.classList.add('is-error');}break;}window.HomeSafePhotoService.setKey?.(key);}$('consent').close();await analyze(false);break;}case 'demo':await analyze(true);break;case 'cancel':cancelJob();break;case 'clear-photo-error':state.photoError='';render();break;case 'continue-search':navigate('search');break;case 'reload-records':await loadRecords();break;case 'save':if(state.report)await saveReport(state.report);break;case 'download':download();break;case 'print':window.print();break;}});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&state.page==='search'&&state.districtExpanded){event.preventDefault();setDistrictFilter(false);}
});
document.addEventListener('input',event=>{if(event.target.id==='query')state.query=event.target.value;if(event.target.id==='city')state.city=event.target.value;});
document.addEventListener('submit',event=>{if(event.target.id==='search-form'){event.preventDefault();state.city=$('city').value;state.query=$('query').value;runSearch();}});
for(const id of ['album','camera']){
 $(id).addEventListener('change',event=>{
  const input=event.target;
  const files=[...input.files];
  const room=input.dataset.room;
  input.value='';
  delete input.dataset.room;
  addPhotos(files,room);
 });
}
window.addEventListener('beforeunload',event=>{if(state.job||state.reading){event.preventDefault();event.returnValue='';}});
let printDetails=[];
window.addEventListener('beforeprint',()=>{printDetails=[...document.querySelectorAll('.cr-card details,.pr-detail,.pr-other')].filter(d=>!d.open);printDetails.forEach(d=>d.open=true);});
window.addEventListener('afterprint',()=>{printDetails.forEach(d=>d.open=false);printDetails=[];});
render();loadRecords();
