/* Costume Index. Native browser APIs; personal records stay in browser storage. */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DATA = JSON.parse($('#costumeData').textContent);
const HOSTED = document.querySelector('meta[name="gallery-mode"]').content === 'hosted';
let downloadBusy=false, downloadFallbackId=null, hostedImageUrl=null;
DATA.forEach(d=>Object.assign(d,{pose:d.id,num:d.id,line:d.category,cat:d.types[0]||'其他',angle:'原图',ja:d.keywordsEn}));
const byId = new Map(DATA.map(d => [d.id, d]));
const ANGLES = ['原图'];
const groupMap = new Map();
DATA.forEach(d => {
  if (!groupMap.has(d.pose)) groupMap.set(d.pose, { ...d, items: [] });
  groupMap.get(d.pose).items.push(d);
});
const GROUPS = [...groupMap.values()];
GROUPS.forEach(g => g.items.sort((a,b) => ANGLES.indexOf(a.angle)-ANGLES.indexOf(b.angle)));
const series = [...new Set(DATA.map(d => d.line))];
const synonymGroups = [['文胸','胸罩'],['内裤','底裤'],['吊带上衣','吊带背心'],['象牙白','米白色'],['棕色','咖啡色'],['鞋子','鞋']];
function norm(s) { return String(s).normalize('NFKC').toLowerCase(); }
function expand(s) { let t=norm(s); for(const group of synonymGroups) if(group.some(x=>t.includes(x))) t+=' '+group.join(' '); return t; }
DATA.forEach(d => d.search = expand([d.name,d.keywordsZh,d.keywordsEn,d.category,...d.types,...d.colors,d.id].join(' ')));
const KEY='costume_index_v1';
function read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
const validIds = v => Array.isArray(v) ? [...new Set(v.filter(x => typeof x==='string' && byId.has(x)))] : [];
function sanitize(raw) {
  const x=raw && typeof raw==='object' ? raw : {};
  const collections=[];
  for(const c of (Array.isArray(x.collections) ? x.collections : [])) {
    if(c && typeof c.name==='string' && c.name.trim()) {
      const entry={id:typeof c.id==='string'&&/^c[a-z0-9-]{1,70}$/i.test(c.id)?c.id:uid(),name:c.name.trim().slice(0,60),items:validIds(c.items)};
      const same=collections.find(x=>x.id===entry.id);
      if(same) same.items=[...new Set([...same.items,...entry.items])]; else collections.push(entry);
    }
  }
  const notes={};
  if(x.notes && typeof x.notes==='object') for(const [k,v] of Object.entries(x.notes)) if(groupMap.has(k)&&typeof v==='string') notes[k]=v.slice(0,3000);
  return {version:2, favImages:validIds(x.favImages),collections,notes,recent:validIds(x.recent).slice(0,150),board:validIds(x.board).slice(0,4)};
}
function uid() { return 'c'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9); }
const loaded=read(KEY);
let store=sanitize(loaded);

const old=loaded?.view||{};
const finite=(value,fallback)=>typeof value==='number'&&Number.isFinite(value)?Math.trunc(value):fallback;
const S={scope:['all','fav','recent'].includes(old.scope)||store.collections.some(c=>c.id===old.scope)?old.scope:'all',line:series.includes(old.line)?old.line:'',cat:typeof old.cat==='string'?old.cat:'',angle:DATA.some(d=>d.colors.includes(old.angle))?old.angle:'',query:typeof old.query==='string'?old.query.slice(0,500):'',mode:'single',sort:old.sort==='name'?'name':'source',density:Math.max(155,Math.min(295,finite(old.density,215))),ja:!!old.ja,theme:old.theme==='dark'?'dark':'light',shown:Math.max(1,Math.min(DATA.length,finite(old.shown,48))),scroll:Math.max(0,Math.min(1000000,finite(old.scroll,0)))};
const selected=new Set();
let cachedCollections='',cachedCategoryLine=null,seriesBuilt=false;
let imageExporting=false;
let matches=[],results=[],filteredGroups=[],viewerGroups=[],current=null,zoom=1,pan={x:0,y:0},mirror=false,loadToken=0,returnFocus=null,storageWarning=false,searchTimer,composing=false;
const clone=x=>JSON.parse(JSON.stringify(x));
let baseStore=clone(store);
// Apply this tab's additions/removals to the latest saved data, rather than
// replacing data another tab may have saved since our last read.
function mergeIds(base,local,remote) {
  const before=new Set(base),now=new Set(local),removed=new Set(base.filter(id=>!now.has(id)));
  return [...new Set([...remote.filter(id=>!removed.has(id)),...local.filter(id=>!before.has(id))])];
}
function mergeStore(base,local,remote) {
  const out=clone(remote);
  for(const key of ['favImages']) out[key]=mergeIds(base[key],local[key],remote[key]);
  const before=new Map(base.collections.map(c=>[c.id,c]));
  const here=new Map(local.collections.map(c=>[c.id,c]));
  out.collections=remote.collections.filter(c=>!before.has(c.id)||here.has(c.id));
  for(const c of local.collections) {
    const prior=before.get(c.id),other=out.collections.find(x=>x.id===c.id);
    if(!prior){if(other)other.items=[...new Set([...other.items,...c.items])];else out.collections.push(clone(c));}
    else if(other){if(c.name!==prior.name)other.name=c.name;other.items=mergeIds(prior.items,c.items,other.items);}
    else if(JSON.stringify(prior)!==JSON.stringify(c))out.collections.push(clone(c));
  }
  for(const key of new Set([...Object.keys(base.notes),...Object.keys(local.notes)])) {
    if(base.notes[key]!==local.notes[key]) {if(Object.hasOwn(local.notes,key))out.notes[key]=local.notes[key];else delete out.notes[key];}
  }
  if(JSON.stringify(base.recent)!==JSON.stringify(local.recent))out.recent=[...new Set([...local.recent.filter(id=>!base.recent.includes(id)),...remote.recent,...local.recent])].slice(0,150);
  const added=local.board.filter(id=>!base.board.includes(id));
  out.board=[...new Set([...added,...mergeIds(base.board,local.board,remote.board)])].slice(0,4);
  return out;
}
function toast(message) {
  const el=$('#toast');el.textContent=message;
  clearTimeout(toast.timer);clearTimeout(toast.hideTimer);
  if(el.showPopover)el.showPopover();
  else ($('#smallDialog[open],#boardDialog[open],#viewer[open]')||document.body).append(el);
  el.classList.add('visible');
  toast.timer=setTimeout(()=>{el.classList.remove('visible');toast.hideTimer=setTimeout(()=>el.hidePopover?.(),200);},3200);
}
function save(visitedId=null) {
  try {
    const before=JSON.stringify(store);
    const latest=read(KEY);
    if(latest)store=mergeStore(baseStore,store,sanitize(latest));
    // An explicit visit must stay newest even when merging saved history.
    if(visitedId&&byId.has(visitedId))store.recent=[visitedId,...store.recent.filter(id=>id!==visitedId)].slice(0,150);
    if(!['all','fav','recent'].includes(S.scope)&&!collection())S.scope='all';
    localStorage.setItem(KEY,JSON.stringify({...store,view:S}));
    baseStore=clone(store);
    if(before!==JSON.stringify(store))queueMicrotask(()=>{draw();if(current)viewerInfo();});
  }
  catch { if(!storageWarning) {storageWarning=true;toast('浏览器无法保存记录，请使用“导出个人资料”备份。');} }
}
function favourite(d) { return store.favImages.includes(d.id); }
function collection() { return store.collections.find(c=>c.id===S.scope); }
function compute() {
  const tokens=norm(S.query).trim().split(/\s+/).filter(Boolean);
  const ids=S.scope==='recent'?new Set(store.recent):collection()?new Set(collection().items):null;
  matches=DATA.filter(d=>(!S.line||d.category===S.line)&&(!S.cat||d.types.includes(S.cat))&&(!S.angle||d.colors.includes(S.angle))&&(S.scope!=='fav'||favourite(d))&&(!ids||ids.has(d.id))&&tokens.every(t=>d.search.includes(t)));
  if(S.scope==='recent'){const order=new Map(store.recent.map((id,i)=>[id,i]));matches.sort((a,b)=>order.get(a.id)-order.get(b.id));}
  else if(S.sort==='name')matches.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')||a.id.localeCompare(b.id));
  filteredGroups=matches.map(d=>({group:groupMap.get(d.id),items:[d]}));results=matches;
}
function batch(){return 48;}
function nav(){
  $('#costumeTotal').textContent=DATA.length.toLocaleString();$('#librarySize').textContent=DATA.length;
  $('#favCount').textContent=store.favImages.length;$('#recentCount').textContent=store.recent.length;$('#boardCount').textContent=store.board.length+' / 4';
  const markup=store.collections.map(c=>`<button class="nav-item" data-scope="${esc(c.id)}">${esc(c.name)}<span>${c.items.length}</span></button>`).join('')+'<button class="nav-item mobile-collection" data-new>＋ 新建集合</button>';
  if(markup!==cachedCollections){$('#collections').innerHTML=markup;cachedCollections=markup;}
  $$('#libraryNav [data-scope],#collections [data-scope]').forEach(b=>{b.classList.toggle('active',b.dataset.scope===S.scope);if(b.dataset.scope===S.scope)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  if(!seriesBuilt){
    $('#categories').innerHTML=[['','全部分类'],...series.map(x=>[x,x])].map(([id,name])=>`<button class="nav-item" data-line="${esc(id)}">${esc(name)}<span>${id?DATA.filter(d=>d.category===id).length:DATA.length}</span></button>`).join('');
    $('#type').innerHTML='<option value="">全部类型</option>'+[...new Set(DATA.flatMap(d=>d.types))].sort((a,b)=>a.localeCompare(b,'zh-CN')).map(x=>`<option>${esc(x)}</option>`).join('');
    $('#color').innerHTML='<option value="">全部颜色</option>'+[...new Set(DATA.flatMap(d=>d.colors))].sort((a,b)=>a.localeCompare(b,'zh-CN')).map(x=>`<option>${esc(x)}</option>`).join('');seriesBuilt=true;
  }
  $$('#categories [data-line]').forEach(b=>{b.classList.toggle('active',b.dataset.line===S.line);b.setAttribute('aria-pressed',b.dataset.line===S.line);});
  $('#type').value=S.cat;$('#color').value=S.angle;$('#sort').value=S.sort;$('#density').value=S.density;$('#showEn').checked=S.ja;
  if(!composing&&document.activeElement!==$('#search'))$('#search').value=S.query;
  document.documentElement.dataset.theme=S.theme;document.documentElement.style.setProperty('--card-size',S.density+'px');document.body.classList.toggle('show-ja',S.ja);
  const c=collection(),heading=c?['REFERENCE COLLECTION',c.name,'把相关的穿搭，放在一起参考。']:({all:['COSTUME REFERENCE','服装参考','挑选穿搭，组合你的画面。'],fav:['YOUR FAVOURITES','我的收藏','留下你想再次使用的穿搭。'],recent:['RECENTLY VIEWED','最近浏览','接着上一次的搭配构思。']}[S.scope]||['COSTUME REFERENCE','服装参考','挑选穿搭，组合你的画面。']);
  $('#pageKicker').textContent=heading[0];$('#pageTitle').textContent=heading[1];$('#pageSubtitle').textContent=heading[2]+(HOSTED?' 图片由原站加载。':'');$('#collectionActions').hidden=!c;
}
function chips() {
  $('#activeFilters').innerHTML=[['line',S.line],['cat',S.cat],['angle',S.angle],['query',S.query]].filter(([,v])=>v).map(([k,v])=>`<button class="filter-chip" data-clear="${k}" aria-label="移除筛选 ${esc(v)}">${esc(v)}<span>×</span></button>`).join('');
}
function selectionIds(id){return [id];}
function card(d){const on=store.favImages.includes(d.id);return `<article class="card" tabindex="0" role="button" aria-label="打开 ${esc(d.id+' '+d.name)}" data-id="${d.id}" data-pose="${d.id}"><div class="card-image"><img src="${d.thumb}" loading="lazy" decoding="async" alt="${esc(d.name)}"><div class="card-top"><span class="card-number">${d.id}</span><input class="card-check" type="checkbox" data-select="${d.id}" ${selected.has(d.id)?'checked':''} aria-label="选择此套服装"></div><button class="fav-mark ${on?'on':''}" data-fav="${d.id}" aria-label="收藏此套服装" aria-pressed="${on}">${on?'♥':'♡'}</button></div><div class="card-body"><h3>${esc(d.name)}</h3><div class="ja">${esc(d.keywordsEn)}</div><div class="card-detail"><span>${esc(d.category)}</span><span>${esc(d.colors.slice(0,2).join(' / '))}</span></div></div></article>`;}
function selectionUi() {$('#selectionBar').hidden=!selected.size;$('#selectionCount').textContent='已选 '+selected.size+' 张图片';}
function draw(recompute=true){
  if(recompute)compute();nav();chips();selectionUi();$('#grid').className='grid single';
  $('#grid').innerHTML=results.slice(0,S.shown).map(d=>card(d)).join('')||'<div class="empty"><h2>没有符合条件的服装</h2><p>试试减少关键词或筛选条件。</p><button class="btn" data-reset>清除筛选</button></div>';
  $('#resultCount').textContent=matches.length.toLocaleString()+' 套服装';$('#shownCount').textContent='已显示 '+Math.min(S.shown,results.length)+' / '+results.length;
  $('#loadMore').hidden=S.shown>=results.length;$('#endLabel').hidden=S.shown<results.length||!results.length;$('#loadMore').textContent='继续浏览 · 还有 '+Math.max(0,results.length-S.shown)+' 套';
}
function update(patch,{reset=true}={}) {
  clearTimeout(searchTimer);
  if(!Object.hasOwn(patch,'query')&&!composing)patch={query:$('#search').value,...patch};
  const wasDeep=window.scrollY>$('.result-toolbar').offsetTop;
  Object.assign(S,patch);
  if(reset){S.shown=batch();selected.clear();}
  if(!composing)$('#search').value=S.query;
  draw();
  if(reset&&wasDeep)window.scrollTo(0,Math.max(0,$('.result-toolbar').offsetTop-$('.controls').offsetHeight));
  S.scroll=window.scrollY;save();
}
function reset() {update({scope:'all',line:'',cat:'',angle:'',query:''});}
function toggleFav(value) {
  const type='favImages',a=store[type],i=a.indexOf(value);if(i<0)a.push(value);else a.splice(i,1);save();draw();if(current) viewerInfo();
}
function download(text,name,type='application/json') {const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
function csv(items) {
  const safe=v=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const rows=[['id','分类','服装名','中文检索词','英文检索词','英文生图提示词','原图路径'],...items.map(d=>[d.id,d.category,d.name,d.keywordsZh,d.keywordsEn,d.prompt||'',d.full])];
  download('\ufeff'+rows.map(row=>row.map(safe).join(',')).join('\r\n'),'costume-index-'+new Date().toISOString().slice(0,10)+'.csv','text/csv;charset=utf-8');toast('已导出 '+items.length+' 张图片的索引');
}
function promptDialog(title,html,confirm='确定') {
  return new Promise(resolve=>{const dlg=$('#smallDialog');$('#dialogTitle').textContent=title;$('#dialogBody').innerHTML=html;$('#dialogConfirm').textContent=confirm;
    dlg.returnValue='';dlg.onclose=()=>{resolve(dlg.returnValue==='ok'?($('#dialogValue')?.value??true):null);dlg.onclose=null;};dlg.showModal();setTimeout(()=>$('#dialogValue')?.focus(),0);
  });
}
// Explicitly close local dialogs; never submit a network form. Making cancel
// a non-submit button also ensures Enter in a name field confirms the action.
$('#dialogForm').addEventListener('submit',event=>{event.preventDefault();$('#smallDialog').close('ok');});
$('#dialogCancel').onclick=()=>$('#smallDialog').close('cancel');
async function newCollection(items=[]) {
  if(store.collections.length>=1000){toast('最多支持 1000 个集合，请先整理已有集合');return null;}
  const name=await promptDialog('新建参考集合','<input id="dialogValue" aria-label="集合名称" maxlength="60" placeholder="例如：春日穿搭、角色衣橱">','创建');
  if(typeof name!=='string'||!name.trim())return null;
  const c={id:uid(),name:name.trim(),items:validIds(items)};store.collections.push(c);save();draw();toast('已创建「'+c.name+'」');return c;
}
async function addToCollection(ids) {
  if(!ids.length){toast('请先选择图片');return;}
  if(!store.collections.length){await newCollection(ids);return;}
  const value=await promptDialog('加入参考集合','<select id="dialogValue" aria-label="选择集合">'+store.collections.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')+'<option value="new">＋ 新建集合</option></select>','加入');
  if(value==='new'){await newCollection(ids);return;}const c=store.collections.find(c=>c.id===value);if(!c)return;c.items=[...new Set([...c.items,...ids])];save();draw();toast('已加入「'+c.name+'」');
}
function viewerInfo(){
  if(!current)return;const d=current,i=viewerGroups.findIndex(e=>e.group.id===d.id);
  $('#viewerNumber').textContent=d.id+' / '+d.category;$('#viewerTitle').textContent=d.name;$('#viewerKeywords').textContent=d.keywordsZh;$('#viewerPrompt').textContent=d.prompt||d.keywordsEn;$('#viewerEn').textContent=d.keywordsEn;
  $('#viewerPosition').textContent=(i+1)+' / '+viewerGroups.length;
  $('#prevImage').disabled=i<=0;$('#nextImage').disabled=i>=viewerGroups.length-1;
  $('#viewerMeta').innerHTML=`<dt>分类</dt><dd>${esc(d.category)}</dd><dt>尺寸</dt><dd>${d.size?d.size.join(' × '):'原始 PNG'}</dd><dt>格式</dt><dd>PNG${d.bytes?' · '+(d.bytes/1048576).toFixed(1)+' MB':''}</dd><dt>编号</dt><dd>${d.id}</dd>`;
  const on=store.favImages.includes(d.id);$('#favImage').textContent=on?'已收藏此套':'收藏此套';$('#favImage').classList.toggle('on',on);$('#favImage').setAttribute('aria-pressed',on);
  $('#pinImage').textContent=store.board.includes(d.id)?'移出参考台':'放入参考台';$('#pinImage').classList.toggle('on',store.board.includes(d.id));$('#downloadImage').href=d.full;$('#downloadImage').download=d.id+'.png';
  $('#downloadImage').textContent=downloadFallbackId===d.id?'打开原站原图':location.protocol==='file:'?'打开原图':'保存原图';$('#downloadImage').target=location.protocol==='file:'||downloadFallbackId===d.id?'_blank':'_self';$('#downloadImage').rel='noopener';
  $('#costumeNote').value=store.notes[d.id]||'';
}
function transform() {
  const img=$('#fullImage'),ratio=img.naturalWidth/Math.max(1,img.naturalHeight);
  const width=Math.min(img.clientWidth,img.clientHeight*ratio),height=Math.min(img.clientHeight,img.clientWidth/Math.max(.001,ratio));
  const maxX=Math.max(0,(width*zoom-img.clientWidth)/2),maxY=Math.max(0,(height*zoom-img.clientHeight)/2);
  pan.x=Math.max(-maxX,Math.min(maxX,pan.x));pan.y=Math.max(-maxY,Math.min(maxY,pan.y));
  $('#fullImage').style.transform=`translate(${pan.x}px,${pan.y}px) scale(${mirror?-zoom:zoom},${zoom})`;
  $('#stage').classList.toggle('zoomed',zoom>1);$('#fitImage').textContent=zoom===1?'适应窗口':Math.round(zoom*100)+'% · 复位';$('#mirrorImage').setAttribute('aria-pressed',mirror);
}
function fit() {zoom=1;pan={x:0,y:0};transform();}
function setZoom(z){const img=$('#fullImage'),max=Math.max(5,img.naturalWidth/Math.max(1,img.clientWidth),img.naturalHeight/Math.max(1,img.clientHeight));zoom=Math.max(1,Math.min(max,z));if(zoom===1)pan={x:0,y:0};transform();}
function imageMime(filename){return filename.endsWith('.webp')?'image/webp':/\.jpe?g$/i.test(filename)?'image/jpeg':'image/png';}
function openImage(id) {
  const d=byId.get(id);if(!d)return;
  if(current?.id!==id)downloadFallbackId=null;
  if(!$('#viewer').open){returnFocus={element:document.activeElement,pose:d.pose,id:d.id};viewerGroups=filteredGroups.map(e=>({group:e.group,items:[...e.items]}));$('#viewer').showModal();document.body.style.overflow='hidden';}
  points.clear();gesture=null;$('#stage').classList.remove('dragging');
  current=d;fit();mirror=false;transform();viewerInfo();
  store.recent=[d.id,...store.recent.filter(x=>x!==d.id)].slice(0,150);save(d.id);
  const token=++loadToken,img=$('#fullImage');img.src=d.preview;img.alt=d.name;$('#imageStatus').textContent='正在读取原图…';
  if(hostedImageUrl){URL.revokeObjectURL(hostedImageUrl);hostedImageUrl=null;}
  if(HOSTED){
    fetch(d.full,{credentials:'omit'}).then(response=>{if(!response.ok)throw new Error('HTTP '+response.status);return response.blob();}).then(blob=>{
      if(!blob.size||!blob.type.startsWith('image/'))throw new Error('Not an image');
      if(token!==loadToken)return;hostedImageUrl=URL.createObjectURL(blob);img.src=hostedImageUrl;$('#imageStatus').textContent='';
    }).catch(()=>{if(token===loadToken)$('#imageStatus').textContent='原图读取失败，请检查网络或打开原站原图。';});
  }else{
    const full=new Image();full.onload=()=>{if(token!==loadToken)return;img.src=d.full;$('#imageStatus').textContent='';};full.onerror=()=>{if(token===loadToken)$('#imageStatus').textContent='原图读取失败，当前显示预览图。请检查本机图片是否完整。';};full.src=d.full;
  }
}
function closeViewer(){if($('#viewer').open)$('#viewer').close();}
$('#viewer').addEventListener('close',()=>{
  loadToken++;current=null;imageExporting=false;if(hostedImageUrl){URL.revokeObjectURL(hostedImageUrl);hostedImageUrl=null;}points.clear();gesture=null;document.body.style.overflow='';draw();
  const focus=returnFocus?.element?.isConnected?returnFocus.element:
    $$('#grid [data-id]').find(e=>e.dataset.id===returnFocus?.id)||
    $$('#grid [data-pose]').find(e=>e.dataset.pose===returnFocus?.pose)||$('#grid .card,#grid [data-open]')||$('#search');
  (focus.matches('section')?focus.querySelector('[data-open]'):focus)?.focus({preventScroll:true});save();
});
function stepImage(n){if(!current)return;const i=viewerGroups.findIndex(e=>e.group.id===current.id),next=viewerGroups[i+n];if(next)openImage(next.group.id);}
function pin(id){const i=store.board.indexOf(id);if(i>=0)store.board.splice(i,1);else if(store.board.length<4)store.board.push(id);else{toast('参考台最多 4 张，请先移除一张');return;}save();nav();if(current)viewerInfo();}
function drawBoard(){ $('#boardGrid').innerHTML=store.board.map(id=>{const d=byId.get(id);return `<section class="board-card"><div><img src="${esc(d.full)}" alt="${esc(d.name+' '+d.angle)}"></div><header><span>${esc(d.num+' '+d.name+' / '+d.angle)}</span><div><button class="text-btn" data-board-mirror="${id}">镜像</button> <button class="text-btn" data-board-remove="${id}">移除</button></div></header></section>`;}).join('')||'<div class="board-empty">在大图预览中点击“放入参考台”，并排比较最多 4 张图片。</div>'; }
$('#libraryNav').onclick=e=>{const b=e.target.closest('[data-scope]');if(b)update({scope:b.dataset.scope});};
$('#collections').onclick=e=>{if(e.target.closest('[data-new]')){newCollection();return;}const b=e.target.closest('[data-scope]');if(b)update({scope:b.dataset.scope});};
$('#categories').onclick=e=>{const b=e.target.closest('[data-line]');if(b)update({line:b.dataset.line,cat:''});};
function scheduleSearch(e){clearTimeout(searchTimer);if(composing||e?.isComposing)return;const query=$('#search').value;searchTimer=setTimeout(()=>update({query}),140);}
$('#search').oninput=scheduleSearch;
$('#search').addEventListener('compositionstart',()=>{composing=true;clearTimeout(searchTimer);});
$('#search').addEventListener('compositionend',()=>{composing=false;scheduleSearch();});
$('#type').onchange=e=>update({cat:e.target.value});$('#color').onchange=e=>update({angle:e.target.value});$('#sort').onchange=e=>update({sort:e.target.value});
$('#resetBtn').onclick=reset;$('#activeFilters').onclick=e=>{const b=e.target.closest('[data-clear]');if(b)update({[b.dataset.clear]:'',...(b.dataset.clear==='line'?{cat:''}:{})});};
$('#density').oninput=e=>{S.density=+e.target.value;document.documentElement.style.setProperty('--card-size',S.density+'px');save();};
$('#showEn').onchange=e=>{S.ja=e.target.checked;document.body.classList.toggle('show-ja',S.ja);save();};$('#themeBtn').onclick=()=>{S.theme=S.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=S.theme;save();};
$('#filtersToggle').onclick=()=>{const open=$('.controls').classList.toggle('filters-open');$('#filtersToggle').setAttribute('aria-expanded',open);};
$('#loadMore').onclick=()=>{S.shown+=batch();draw(false);save();};$('#backTop').onclick=()=>window.scrollTo({top:0,behavior:'auto'});
$('#grid').onclick=e=>{
  const fav=e.target.closest('[data-fav]');if(fav){toggleFav(fav.dataset.fav);return;}
  if(e.target.closest('[data-select]'))return;
  if(e.target.closest('[data-reset]')){reset();return;}
  const open=e.target.closest('[data-open]');if(open){openImage(open.dataset.open);return;}
  const card=e.target.closest('.card');if(card)openImage(card.dataset.id);
};
$('#grid').onchange=e=>{const b=e.target.closest('[data-select]');if(!b)return;for(const id of selectionIds(b.dataset.select))b.checked?selected.add(id):selected.delete(id);b.indeterminate=false;selectionUi();};
$('#grid').onkeydown=e=>{if(e.target.matches('.card')&&['Enter',' '].includes(e.key)){e.preventDefault();openImage(e.target.dataset.id);}};
$('#selectionClear').onclick=()=>{selected.clear();draw(false);};$('#selectVisible').onclick=()=>{for(const r of results.slice(0,S.shown)){const ds=S.mode==='single'?[r]:r.items;ds.forEach(d=>selected.add(d.id));}draw(false);};
$('#selectionCollection').onclick=()=>addToCollection([...selected]);$('#selectionCsv').onclick=()=>csv(DATA.filter(d=>selected.has(d.id)));$('#exportCsv').onclick=()=>csv(matches);
$('#copyPaths').onclick=async()=>{const text=matches.map(d=>d.full).join('\n');try{await navigator.clipboard.writeText(text);toast('已复制 '+matches.length+(HOSTED?' 条图片地址':' 条相对路径'));}catch{await promptDialog(HOSTED?'图片地址':'图片相对路径','<p>浏览器未允许直接复制，可在下面全选后复制。</p><textarea id="dialogValue" aria-label="图片路径" rows="8" readonly>'+esc(text)+'</textarea>','关闭');}};
$('#newCollection').onclick=()=>newCollection();$('#renameCollection').onclick=async()=>{const c=collection();if(!c)return;const value=await promptDialog('重命名集合',`<input id="dialogValue" aria-label="集合名称" maxlength="60" value="${esc(c.name)}">`);if(typeof value==='string'&&value.trim()){c.name=value.trim();save();draw();}};
$('#removeFromCollection').onclick=()=>{const c=collection();if(!c)return;if(!selected.size){toast('请先勾选要移出的图片');return;}c.items=c.items.filter(id=>!selected.has(id));selected.clear();save();draw();};
$('#deleteCollection').onclick=async()=>{const c=collection();if(!c)return;if(await promptDialog('删除参考集合',`<p>删除「${esc(c.name)}」？仅移除集合记录，图片和收藏保留。操作前可导出个人资料。</p>`,'删除集合')){store.collections=store.collections.filter(x=>x!==c);update({scope:'all'});}};
$('#backupBtn').onclick=()=>{download(JSON.stringify({...store,format:'costume-index-backup',exportedAt:new Date().toISOString()},null,2),'costume-index-backup-'+new Date().toISOString().slice(0,10)+'.json');toast('个人资料已导出：收藏、集合、备注和参考台');};
$('#importInput').onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    if(file.size>64*1024*1024)throw new Error('备份超过 64 MB');const raw=JSON.parse(await file.text());if(!raw||raw.format!=='costume-index-backup'||raw.version!==2)throw new Error('不是此图库支持的备份文件');
    if(Array.isArray(raw.collections)&&raw.collections.length>1000)throw new Error('备份包含超过 1000 个集合，请先拆分后导入');const incoming=sanitize(raw);
    if(new Set([...store.collections,...incoming.collections].map(c=>c.id)).size>1000)throw new Error('合并后超过 1000 个集合，请先整理后再导入');
    if(!await promptDialog('合并个人资料',`<p>将合并 ${incoming.favImages.length} 个服装收藏、${incoming.collections.length} 个集合。已有收藏保留；同一服装的已有备注优先保留。</p>`,'合并'))return;
    store.favImages=[...new Set([...store.favImages,...incoming.favImages])];
    for(const c of incoming.collections){const old=store.collections.find(x=>x.id===c.id);if(old)old.items=[...new Set([...old.items,...c.items])];else store.collections.push(c);}
    store.notes={...incoming.notes,...store.notes};store.recent=[...new Set([...store.recent,...incoming.recent])].slice(0,150);store.board=[...new Set([...store.board,...incoming.board])].slice(0,4);save();draw();toast('资料已合并');
  }catch(error){toast('导入失败：'+error.message);}finally{e.target.value='';}
};
$('#closeViewer').onclick=closeViewer;
$('#copyPrompt').onclick=async()=>{
  if(!current)return;const text=current.prompt||current.keywordsEn;
  try{await navigator.clipboard.writeText(text);toast('已复制英文生图提示词');}
  catch{await promptDialog('复制英文生图提示词','<p>浏览器未允许直接复制，请全选后复制。</p><textarea id="dialogValue" aria-label="英文生图提示词" rows="6" readonly>'+esc(text)+'</textarea>','关闭');}
};
$('#copyPrompts').onclick=async()=>{const text=matches.map(d=>d.prompt||d.keywordsEn).join('\n\n');try{await navigator.clipboard.writeText(text);toast('已复制 '+matches.length+' 条提示词');}catch{await promptDialog('复制提示词','<p>浏览器未允许直接复制，可在下面全选后复制。</p><textarea id="dialogValue" aria-label="英文提示词" rows="10" readonly>'+esc(text)+'</textarea>','关闭');}};
$('#downloadImage').addEventListener('click',async event=>{
  if(!HOSTED||!current||downloadFallbackId===current.id)return;
  event.preventDefault();if(downloadBusy)return;
  const d=current,button=$('#downloadImage');downloadBusy=true;button.textContent='正在保存…';
  try{
    const response=await fetch(d.full,{credentials:'omit'});
    if(!response.ok)throw new Error('HTTP '+response.status);
    const blob=await response.blob();if(!blob.size||!blob.type.startsWith('image/'))throw new Error('Not an image');
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=d.id+'.png';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
  }catch{
    downloadFallbackId=d.id;toast('原图保存失败，请点击“打开原站原图”后另存。');
  }finally{downloadBusy=false;if(current)viewerInfo();}
});
$('#prevImage').onclick=()=>stepImage(-1);$('#nextImage').onclick=()=>stepImage(1);
$('#zoomIn').onclick=()=>setZoom(zoom*1.35);$('#zoomOut').onclick=()=>setZoom(zoom/1.35);$('#fitImage').onclick=fit;$('#mirrorImage').onclick=()=>{mirror=!mirror;transform();};
$('#favImage').onclick=()=>current&&toggleFav(current.id);$('#pinImage').onclick=()=>current&&pin(current.id);$('#addCollection').onclick=()=>current&&addToCollection([current.id]);
$('#costumeNote').oninput=e=>{if(!current)return;store.notes[current.pose]=e.target.value;save();};
$('#boardBtn').onclick=()=>{drawBoard();$('#boardDialog').showModal();};$('#closeBoard').onclick=()=>$('#boardDialog').close();$('#clearBoard').onclick=()=>{store.board=[];save();nav();drawBoard();};
$('#boardGrid').onclick=e=>{const remove=e.target.closest('[data-board-remove]');if(remove){pin(remove.dataset.boardRemove);drawBoard();return;}if(e.target.closest('[data-board-mirror]'))e.target.closest('.board-card').firstElementChild.classList.toggle('mirror');};
$('#stage').addEventListener('wheel',e=>{if(e.target.closest('button'))return;e.preventDefault();setZoom(zoom*(e.deltaY>0?0.88:1.14));},{passive:false});
const points=new Map();let gesture=null;
$('#stage').addEventListener('pointerdown',e=>{
  if(e.target.closest('button'))return;
  // Mouse image export belongs to the browser. Touch keeps swipe/pinch;
  // zoomed mouse gestures pan unless Alt explicitly requests image export.
  if(e.pointerType!=='touch'&&e.target===$('#fullImage')&&(zoom===1||e.altKey))return;
  if(e.pointerType!=='touch')e.preventDefault();
  points.set(e.pointerId,{x:e.clientX,y:e.clientY});$('#stage').setPointerCapture(e.pointerId);
  if(points.size===1)gesture={x:e.clientX,y:e.clientY,pan:{...pan}};
  if(points.size===2){const p=[...points.values()];gesture={distance:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),zoom};}
  $('#stage').classList.add('dragging');
});
$('#fullImage').addEventListener('dragstart',event=>{
  if(!current||zoom>1&&!event.altKey){event.preventDefault();return;}
  const image=$('#fullImage'),url=new URL(current.full,document.baseURI).href;
  if(image.src!==(HOSTED?hostedImageUrl:url)||!image.complete||!image.naturalWidth){event.preventDefault();toast('原图尚未就绪，请等加载完成后拖出，或使用原图按钮');return;}
  const filename=current.full.split('/').pop();
  const mime=imageMime(filename);
  // Preserve native bitmap/file formats and add full-resolution URL formats
  // used by desktop file managers, drawing programs and other drop targets.
  event.dataTransfer.effectAllowed='copy';
  imageExporting=true;
  event.dataTransfer.setData('text/uri-list',url);
  event.dataTransfer.setData('text/plain',url);
  event.dataTransfer.setData('text/html',`<img src="${esc(url)}" alt="${esc(current.name)}">`);
  event.dataTransfer.setData('DownloadURL',`${mime}:${filename}:${url}`);
});
$('#fullImage').addEventListener('dragend',()=>{imageExporting=false;points.clear();gesture=null;$('#stage').classList.remove('dragging');});
// Dropping our own exported image back onto the viewer should not navigate
// away. External drop targets still receive the normal file payload.
$('#viewer').addEventListener('dragover',event=>{if(imageExporting)event.preventDefault();});
$('#viewer').addEventListener('drop',event=>{if(imageExporting)event.preventDefault();});
$('#stage').addEventListener('pointermove',e=>{if(!points.has(e.pointerId)||!gesture)return;points.set(e.pointerId,{x:e.clientX,y:e.clientY});if(points.size===2&&gesture.distance){const p=[...points.values()];setZoom(gesture.zoom*Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y)/gesture.distance);}else if(points.size===1&&gesture.pan&&zoom>1){const rect=$('#stage').getBoundingClientRect();pan={x:Math.max(-rect.width*zoom/2,Math.min(rect.width*zoom/2,gesture.pan.x+e.clientX-gesture.x)),y:Math.max(-rect.height*zoom/2,Math.min(rect.height*zoom/2,gesture.pan.y+e.clientY-gesture.y))};transform();}});
function pointerEnd(e){const start=gesture;points.delete(e.pointerId);if(!points.size){$('#stage').classList.remove('dragging');if(e.type==='pointerup'&&start?.pan&&zoom===1&&e.pointerType==='touch'&&Math.abs(e.clientX-start.x)>60&&Math.abs(e.clientX-start.x)>Math.abs(e.clientY-start.y)*1.5)stepImage(e.clientX<start.x?1:-1);gesture=null;}else{const p=[...points.values()][0];gesture={x:p.x,y:p.y,pan:{...pan}};}}
$('#stage').addEventListener('pointerup',pointerEnd);$('#stage').addEventListener('pointercancel',pointerEnd);
$('#helpBtn').onclick=()=>promptDialog('使用衣装索引',(HOSTED?'<p>在线演示从原站加载图片，需要网络；保存失败时可打开原站原图后另存。</p>':'')+'<p>搜索支持中文、英文、材质、颜色和编号；多个词用空格分隔，例如“蕾丝 黑色”。颜色和类型按整套穿搭的原始检索词匹配，标题由检索词整理，不是原作者为每套服装命名。</p><p>点开服装：完整看图，滚轮／双指缩放，放大后拖动平移。未放大时可拖出原图，放大后按 Alt 拖出；左右键换服装，F 收藏。</p><p>使用“打开图库.cmd”可启动离线本机服务并直接保存原图。直接双击 HTML 时，原图会在新标签页打开，可右键另存；接收软件不支持拖放时，也可先保存再导入。</p><p>“复制提示词”给出按画面反推的英文描述，只写能看到的单品、版型、细节和颜色，不含生成参数；筛选结果可整批复制。</p><p>参考台最多固定 4 套。收藏、集合和备注保存在浏览器。换入口或清理浏览器前先导出资料；不同入口的记录独立。</p><div class="help-actions"><button type="button" class="btn" id="helpBackup">导出个人资料</button> <label class="btn">导入资料<input type="file" id="helpImport" accept=".json" hidden></label></div><p>原素材作者：ギア。原站允许用于作品创作、商业创作、编辑及参考，禁止图片文件本身的转载、再分发和转售。详情以顶部素材原站的说明为准。</p>','关闭').then(()=>{});
$('#dialogBody').addEventListener('click',e=>{if(e.target.id==='helpBackup')$('#backupBtn').click();});
$('#dialogBody').addEventListener('change',async e=>{
  if(e.target.id!=='helpImport'||!e.target.files.length)return;
  const dt=new DataTransfer();for(const file of e.target.files)dt.items.add(file);
  const dialog=$('#smallDialog');
  const closed=new Promise(resolve=>dialog.addEventListener('close',resolve,{once:true}));
  dialog.close();await closed;
  $('#importInput').files=dt.files;$('#importInput').dispatchEvent(new Event('change'));
});
document.addEventListener('keydown',e=>{
  if(e.target.matches('input,textarea,select,[contenteditable=true]'))return;
  if($('#smallDialog').open||$('#boardDialog').open)return;
  if($('#viewer').open){if(e.key===' '&&e.target.closest('button,a,summary'))return;const actions={ArrowLeft:()=>stepImage(-1),ArrowRight:()=>stepImage(1),f:()=>toggleFav(current.pose),F:()=>toggleFav(current.pose),' ':()=>{if(zoom!==1){fit();return;}const img=$('#fullImage'),z=Math.max(img.naturalWidth/img.clientWidth,img.naturalHeight/img.clientHeight);setZoom(z);}};if(actions[e.key]){e.preventDefault();actions[e.key]();}return;}
  if(e.key==='/'){e.preventDefault();$('#search').focus();}
});
let scrollTimer;window.addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{S.scroll=window.scrollY;save();},180);},{passive:true});
window.addEventListener('pagehide',()=>{S.scroll=window.scrollY;save();});
window.addEventListener('storage',event=>{
  if(event.key!==KEY&&event.key!==null)return;
  const next=sanitize(read(KEY));
  if(JSON.stringify(next)===JSON.stringify(baseStore))return;
  store=mergeStore(baseStore,store,next);baseStore=clone(store);
  if(!['all','fav','recent'].includes(S.scope)&&!collection())S.scope='all';
  draw();if(current)viewerInfo();
});
window.addEventListener('resize',()=>{if(current)transform();});
const initialScroll=S.scroll;draw();save();requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo(0,initialScroll)));
})();
