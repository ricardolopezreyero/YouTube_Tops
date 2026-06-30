/**
 * app.js – YouTube Tops frontend.
 * Vanilla JS, ES modules.
 */

import {
  auth, db, googleProvider,
  signInWithPopup, onAuthStateChanged, signOut,
  doc, getDoc, setDoc, updateDoc, serverTimestamp,
} from './firebase-config.js';

// ── Utilidades ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
function esc(str) {
  return String(str || '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
function pad(n) { return String(n).padStart(2,'0'); }
function fmtDuration(s) {
  if (!s) return '?';
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60;
  return h>0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
function fmtViews(n) {
  if (!n) return '0';
  return n>=1_000_000?`${(n/1_000_000).toFixed(1)}M`:n>=1_000?`${(n/1_000).toFixed(0)}K`:String(n);
}
function scoreBadgeClass(s){ return s>=0.6?'score-hi':s>=0.35?'score-mid':'score-lo'; }
function uid() { return Math.random().toString(36).slice(2,10); }

function showToast(msg, duration=2500) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), duration);
}

// ── Estado global ─────────────────────────────────────────────────────────────
const state = {
  user: null, idToken: null, userProfile: null,
  rawVideos: [], offset: 0, hasMore: false, loading: false,
  weights: { engagement:35, relevance:25, depth:15, duration:10, captions:5, authority:10 },
  keywords: [], durMin:8, durMax:60, mode:'balanced',
  feedback: {},   // { videoId: { clicks, dismissed } }
  lists: [],      // [{ id, name, order }]
  listItems: {},  // { listId: { videoId: { order, added_at, title, channel_title, thumbnail_url, url, duration_s, score } } }
  currentView: 'home',     // 'home' | 'list'
  currentListId: null,
  pendingAddVideoListId: null, // usado en el modal para saber a qué lista agregar
};

// ── Pantallas ─────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

// ── Auth ──────────────────────────────────────────────────────────────────────
$('btn-google-login').addEventListener('click', async () => {
  const btn=$('btn-google-login'), errEl=$('login-error');
  errEl.classList.add('hidden'); btn.disabled=true;
  try { await signInWithPopup(auth, googleProvider); }
  catch(err) { errEl.textContent=`Error: ${err.message}`; errEl.classList.remove('hidden'); }
  finally { btn.disabled=false; }
});
$('btn-logout').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async user => {
  state.user = user;
  if (!user) {
    Object.assign(state, { userProfile:null, idToken:null, feedback:{}, lists:[], listItems:{} });
    showScreen('screen-login'); return;
  }
  try {
    state.idToken = await user.getIdToken();
    let snap=null;
    try { snap = await getDoc(doc(db,'users',user.uid)); }
    catch(e) { console.warn('Firestore getDoc:', e.message); showScreen('screen-onboard'); return; }

    if (!snap.exists() || !snap.data()?.interest_keywords?.length) {
      showScreen('screen-onboard');
    } else {
      applyProfileToState(snap.data());
      showScreen('screen-app');
      renderListsBadge();
      loadVideos(true);
    }
  } catch(err) {
    const e=$('login-error');
    if(e){ e.textContent=`Error: ${err.message}`; e.classList.remove('hidden'); }
    await signOut(auth).catch(()=>{});
  }
});

async function getToken() {
  if (!state.user) throw new Error('No hay usuario autenticado');
  state.idToken = await state.user.getIdToken(false);
  return state.idToken;
}

async function saveProfile(data) {
  if (!state.user) return;
  try { await setDoc(doc(db,'users',state.user.uid), data, { merge:true }); }
  catch(e) { console.warn('saveProfile:', e.message); }
}

// ── Onboarding ────────────────────────────────────────────────────────────────
const descInput=$('description-input'), charCount=$('char-count');
descInput.addEventListener('input', ()=>{ charCount.textContent=descInput.value.length; });

$('btn-save-profile').addEventListener('click', async () => {
  const btn=$('btn-save-profile'), errEl=$('onboard-error');
  const label=btn.querySelector('.btn-label'), spinner=btn.querySelector('.btn-spinner');
  errEl.classList.add('hidden');
  const description=descInput.value.trim();
  if (description.length<20) { errEl.textContent='Por favor escribe al menos 20 caracteres.'; errEl.classList.remove('hidden'); return; }
  btn.disabled=true; label.textContent='Procesando…'; spinner.classList.remove('hidden');
  try {
    const token=await getToken();
    const res=await fetch('/api/onboard',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},
      body:JSON.stringify({description})});
    if(!res.ok){ const d=await res.json(); throw new Error(d.error||`Error ${res.status}`); }

    const { seeds, keywords, suggested_lists } = await res.json();

    // Crear 3 listas sugeridas vacías
    const newLists = (suggested_lists||['Ver después','Favoritos','Comparte esto']).map((name,i)=>({
      id: uid(), name, order: i, created_at: new Date().toISOString()
    }));

    state.keywords = keywords;
    state.lists    = newLists;
    state.listItems = {};
    newLists.forEach(l=>{ state.listItems[l.id]={}; });

    await saveProfile({
      description, derived_seeds:seeds, interest_keywords:keywords,
      weights:{...state.weights}, settings:{mode:state.mode,duration_min:state.durMin,duration_max:state.durMax},
      feedback:state.feedback, lists:state.lists, listItems:state.listItems,
      updated_at:serverTimestamp()
    });

    showScreen('screen-app');
    renderListsBadge();
    loadVideos(true);
  } catch(err) {
    errEl.textContent=err.message; errEl.classList.remove('hidden');
  } finally {
    btn.disabled=false; label.textContent='Generar mi perfil →'; spinner.classList.add('hidden');
  }
});

// ── Feedback ──────────────────────────────────────────────────────────────────
async function trackClick(videoId) {
  if (!state.feedback[videoId]) state.feedback[videoId]={clicks:0,dismissed:false};
  state.feedback[videoId].clicks=(state.feedback[videoId].clicks||0)+1;
  const badge=$(`clk-${CSS.escape(videoId)}`);
  if(badge){ badge.textContent=`${state.feedback[videoId].clicks} clic${state.feedback[videoId].clicks>1?'s':''}`; badge.classList.remove('hidden'); }
  if(state.user) updateDoc(doc(db,'users',state.user.uid),{[`feedback.${videoId}.clicks`]:state.feedback[videoId].clicks}).catch(()=>{});
}

async function dismissVideo(videoId) {
  if (!state.feedback[videoId]) state.feedback[videoId]={clicks:0,dismissed:false};
  state.feedback[videoId].dismissed=true;
  const card=$(`card-${CSS.escape(videoId)}`);
  if(card){ card.style.transition='opacity .25s,transform .25s'; card.style.opacity='0'; card.style.transform='scale(0.9)'; setTimeout(()=>card.remove(),260); }
  if(state.user) updateDoc(doc(db,'users',state.user.uid),{[`feedback.${videoId}.dismissed`]:true}).catch(()=>{});
}

function applyFeedback(videos) {
  return videos.filter(v=>!state.feedback[v.video_id]?.dismissed)
    .map(v=>{ const c=state.feedback[v.video_id]?.clicks||0; return {...v,score:+Math.min(1,v.score+Math.min(c*0.03,0.30)).toFixed(3),clicks:c}; })
    .sort((a,b)=>b.score-a.score);
}

// ── Parámetros ────────────────────────────────────────────────────────────────
const paramsPanel=$('params-panel'), btnParams=$('btn-params'), weightsSum=$('weights-sum');
btnParams.addEventListener('click',()=>{ const h=paramsPanel.classList.contains('hidden'); paramsPanel.classList.toggle('hidden',!h); btnParams.setAttribute('aria-expanded',String(h)); closeListsPanel(); });
$('btn-close-params').addEventListener('click',()=>{ paramsPanel.classList.add('hidden'); btnParams.setAttribute('aria-expanded','false'); });

const WEIGHT_KEYS=['engagement','relevance','depth','duration','captions','authority'];
WEIGHT_KEYS.forEach(key=>{
  const s=$(`w-${key}`),o=$(`w-${key}-val`);
  s.addEventListener('input',()=>{ state.weights[key]=parseInt(s.value); o.textContent=s.value; updateWeightsSum(); });
});
$('dur-min').addEventListener('input',function(){ state.durMin=parseInt(this.value); $('dur-min-val').textContent=this.value; });
$('dur-max').addEventListener('input',function(){ state.durMax=parseInt(this.value); $('dur-max-val').textContent=this.value; });
$('mode-select').addEventListener('change',function(){ state.mode=this.value; applyModePreset(this.value); });

function updateWeightsSum(){
  const t=WEIGHT_KEYS.reduce((s,k)=>s+state.weights[k],0);
  weightsSum.textContent=`Σ = ${t}`;
  weightsSum.className='badge '+(t===100?'badge--ok':t>100?'badge--err':'badge--warn');
}
function applyModePreset(mode){
  const P={depth:{engagement:25,relevance:30,depth:25,duration:10,captions:5,authority:5},quick:{engagement:40,relevance:20,depth:10,duration:20,captions:5,authority:5},balanced:{engagement:35,relevance:25,depth:15,duration:10,captions:5,authority:10}};
  Object.assign(state.weights,P[mode]||P.balanced);
  WEIGHT_KEYS.forEach(k=>{ $(`w-${k}`).value=state.weights[k]; $(`w-${k}-val`).textContent=state.weights[k]; });
  updateWeightsSum();
}
$('btn-apply-params').addEventListener('click',async()=>{
  if(state.user) updateDoc(doc(db,'users',state.user.uid),{weights:{...state.weights},settings:{mode:state.mode,duration_min:state.durMin,duration_max:state.durMax},updated_at:serverTimestamp()}).catch(()=>{});
  paramsPanel.classList.add('hidden'); btnParams.setAttribute('aria-expanded','false');
  loadVideos(true);
});
$('btn-edit-profile').addEventListener('click',()=>{
  paramsPanel.classList.add('hidden');
  showScreen('screen-onboard');
  if(state.userProfile?.description){ descInput.value=state.userProfile.description; charCount.textContent=descInput.value.length; }
});

// ── Panel de Listas ───────────────────────────────────────────────────────────
const listsPanel=$('lists-panel');

$('btn-lists').addEventListener('click',()=>{
  const isHidden=listsPanel.classList.contains('hidden');
  listsPanel.classList.toggle('hidden',!isHidden);
  $('btn-lists').setAttribute('aria-expanded',String(isHidden));
  if(isHidden){ renderListsDirectory(); paramsPanel.classList.add('hidden'); }
});
$('btn-close-lists').addEventListener('click',closeListsPanel);

function closeListsPanel(){
  listsPanel.classList.add('hidden');
  $('btn-lists').setAttribute('aria-expanded','false');
}

function renderListsBadge(){
  const badge=$('lists-count-badge');
  const count=state.lists.length;
  badge.textContent=count;
  badge.classList.toggle('hidden',count===0);
}

function renderListsDirectory(){
  const dir=$('lists-directory');
  dir.innerHTML='';
  if(!state.lists.length){
    dir.innerHTML='<p class="lists-empty-hint">Aún no tienes listas.<br>Crea una con el botón de arriba.</p>';
    return;
  }
  [...state.lists].sort((a,b)=>a.order-b.order).forEach(list=>{
    const count=Object.keys(state.listItems[list.id]||{}).length;
    const btn=document.createElement('button');
    btn.className='list-dir-item';
    btn.type='button';
    btn.innerHTML=`<span class="list-dir-name">${esc(list.name)}</span><span class="list-dir-count">${count} video${count!==1?'s':''}</span>`;
    btn.addEventListener('click',()=>{ closeListsPanel(); showListView(list.id); });
    dir.appendChild(btn);
  });
}

$('btn-create-list').addEventListener('click',()=> promptCreateList());

function promptCreateList(defaultName=''){
  const name=prompt('Nombre de la nueva lista:',defaultName||'');
  if(!name?.trim()) return;
  createList(name.trim());
}

function createList(name){
  const newList={ id:uid(), name, order:state.lists.length, created_at:new Date().toISOString() };
  state.lists.push(newList);
  state.listItems[newList.id]={};
  persistLists();
  renderListsBadge();
  renderListsDirectory();
  showToast(`Lista "${name}" creada`);
  return newList;
}

function deleteList(listId){
  if(!confirm('¿Eliminar esta lista y todos sus videos?')) return;
  state.lists=state.lists.filter(l=>l.id!==listId);
  delete state.listItems[listId];
  persistLists();
  renderListsBadge();
  showHomeView();
  showToast('Lista eliminada');
}

function renameList(listId){
  const list=state.lists.find(l=>l.id===listId);
  if(!list) return;
  const name=prompt('Nuevo nombre:',list.name);
  if(!name?.trim()||name.trim()===list.name) return;
  list.name=name.trim();
  persistLists();
  $('list-view-name').textContent=list.name;
  showToast('Lista renombrada');
}

function persistLists(){
  if(!state.user) return;
  updateDoc(doc(db,'users',state.user.uid),{
    lists:state.lists, listItems:state.listItems, updated_at:serverTimestamp()
  }).catch(e=>console.warn('persistLists:',e.message));
}

// ── Vista de Lista ────────────────────────────────────────────────────────────
function showListView(listId){
  const list=state.lists.find(l=>l.id===listId);
  if(!list) return;
  state.currentView='list';
  state.currentListId=listId;
  $('home-view').classList.add('hidden');
  $('list-view').classList.remove('hidden');
  $('list-view-name').textContent=list.name;
  renderListView();
}

function showHomeView(){
  state.currentView='home';
  state.currentListId=null;
  $('list-view').classList.add('hidden');
  $('home-view').classList.remove('hidden');
}

$('btn-back-home').addEventListener('click',showHomeView);
$('btn-delete-list').addEventListener('click',()=>{ if(state.currentListId) deleteList(state.currentListId); });
$('btn-rename-list').addEventListener('click',()=>{ if(state.currentListId) renameList(state.currentListId); });

function renderListView(){
  const container=$('list-items-container');
  container.innerHTML='';
  const items=state.listItems[state.currentListId]||{};
  const sorted=Object.entries(items).sort((a,b)=>(a[1].order||0)-(b[1].order||0));

  $('list-empty-state').classList.toggle('hidden',sorted.length>0);

  sorted.forEach(([videoId, data], idx)=>{
    const row=buildListItemRow(videoId,data,idx,sorted.length);
    container.appendChild(row);
  });
}

function buildListItemRow(videoId,data,idx,total){
  const row=document.createElement('div');
  row.className='list-item-row';
  row.id=`listrow-${CSS.escape(videoId)}`;

  row.innerHTML=`
    <div class="list-item-thumb-wrap">
      ${data.thumbnail_url
        ? `<img src="${esc(data.thumbnail_url)}" alt="${esc(data.title)}" loading="lazy" class="list-item-thumb">`
        : `<div class="list-item-thumb-placeholder">▶</div>`}
      <span class="video-duration">${fmtDuration(data.duration_s)}</span>
    </div>
    <div class="list-item-info">
      <a href="${esc(data.url)}" target="_blank" rel="noopener noreferrer" class="list-item-title"
         onclick="trackClickExternal('${videoId}')">${esc(data.title)}</a>
      <div class="list-item-meta">
        <span>${esc(data.channel_title)}</span>
        ${data.score?`<span class="${scoreBadgeClass(data.score)} score-badge" style="font-size:.7rem">Score ${(data.score*100).toFixed(0)}</span>`:''}
      </div>
    </div>
    <div class="list-item-actions">
      <button class="btn-move" data-dir="up" data-id="${videoId}" title="Subir" ${idx===0?'disabled':''}>↑</button>
      <button class="btn-move" data-dir="down" data-id="${videoId}" title="Bajar" ${idx===total-1?'disabled':''}>↓</button>
      <button class="btn-remove-from-list" data-id="${videoId}" title="Quitar de la lista">✕</button>
    </div>`;

  row.querySelectorAll('.btn-move').forEach(btn=>{
    btn.addEventListener('click',()=>moveItemInList(state.currentListId,videoId,btn.dataset.dir));
  });
  row.querySelector('.btn-remove-from-list').addEventListener('click',()=>removeFromList(state.currentListId,videoId));
  return row;
}

// Exponer trackClick para el onclick inline de los links en la lista
window.trackClickExternal = videoId => trackClick(videoId);

function moveItemInList(listId,videoId,dir){
  const items=state.listItems[listId];
  if(!items) return;
  const sorted=Object.entries(items).sort((a,b)=>(a[1].order||0)-(b[1].order||0));
  const idx=sorted.findIndex(([id])=>id===videoId);
  const swapIdx=dir==='up'?idx-1:idx+1;
  if(swapIdx<0||swapIdx>=sorted.length) return;
  [sorted[idx][1].order, sorted[swapIdx][1].order]=[sorted[swapIdx][1].order, sorted[idx][1].order];
  persistLists();
  renderListView();
}

function removeFromList(listId,videoId){
  delete state.listItems[listId][videoId];
  persistLists();
  const row=$(`listrow-${CSS.escape(videoId)}`);
  if(row){ row.style.transition='opacity .2s'; row.style.opacity='0'; setTimeout(()=>row.remove(),220); }
  const remaining=Object.keys(state.listItems[listId]||{}).length;
  $('list-empty-state').classList.toggle('hidden',remaining>0);
  showToast('Video quitado de la lista');
}

function addVideoToList(listId,videoData){
  const items=state.listItems[listId]||{};
  if(items[videoData.video_id]){ showToast('Ya está en esta lista'); return; }
  const order=Object.keys(items).length;
  items[videoData.video_id]={
    order, added_at:new Date().toISOString(),
    title:videoData.title, channel_title:videoData.channel_title,
    thumbnail_url:videoData.thumbnail_url, url:videoData.url,
    duration_s:videoData.duration_s||videoData.duration_seconds,
    score:videoData.score||videoData.score_base||0,
  };
  state.listItems[listId]=items;
  persistLists();
  const listName=state.lists.find(l=>l.id===listId)?.name||'lista';
  showToast(`✓ Guardado en "${listName}"`);
  if(state.currentView==='list'&&state.currentListId===listId) renderListView();
}

// ── Dropdown "Agregar a lista" ────────────────────────────────────────────────
let _dropdownVideoData=null;
const listDropdown=$('list-dropdown');

function showListDropdown(anchorEl, videoData){
  _dropdownVideoData=videoData;
  const items=$('list-dropdown-items');
  items.innerHTML='';
  if(!state.lists.length){
    items.innerHTML='<p style="padding:.5rem .75rem;color:var(--text-muted);font-size:.8125rem">Sin listas aún</p>';
  } else {
    state.lists.forEach(list=>{
      const inList=!!state.listItems[list.id]?.[videoData.video_id];
      const btn=document.createElement('button');
      btn.className='list-dropdown-item'+(inList?' list-dropdown-item--saved':'');
      btn.type='button';
      btn.textContent=inList?`✓ ${list.name}`:list.name;
      btn.addEventListener('click',()=>{
        if(!inList) addVideoToList(list.id,videoData);
        closeDropdown();
      });
      items.appendChild(btn);
    });
  }

  const rect=anchorEl.getBoundingClientRect();
  listDropdown.classList.remove('hidden');
  listDropdown.style.top  = `${rect.bottom+window.scrollY+4}px`;
  listDropdown.style.left = `${Math.min(rect.left+window.scrollX, window.innerWidth-220)}px`;
}

function closeDropdown(){ listDropdown.classList.add('hidden'); _dropdownVideoData=null; }

$('list-dropdown-new').addEventListener('click',()=>{
  closeDropdown();
  const name=prompt('Nombre de la nueva lista:','');
  if(!name?.trim()) return;
  const newList=createList(name.trim());
  if(_dropdownVideoData){ addVideoToList(newList.id,_dropdownVideoData); _dropdownVideoData=null; }
});

document.addEventListener('click',e=>{
  if(!listDropdown.classList.contains('hidden')&&!listDropdown.contains(e.target)&&!e.target.closest('.btn-bookmark'))
    closeDropdown();
});

// ── Modal: Agregar video por URL ──────────────────────────────────────────────
function openAddVideoModal(preselectedListId=null){
  state.pendingAddVideoListId=preselectedListId;
  $('video-url-input').value='';
  $('video-preview').classList.add('hidden'); $('video-preview').innerHTML='';
  $('modal-list-select-wrap').classList.add('hidden');
  $('modal-error').classList.add('hidden');
  $('modal-add-video').classList.remove('hidden');
  $('video-url-input').focus();
  // Poblar select de listas
  populateModalListSelect(preselectedListId);
}

function closeModal(){
  $('modal-add-video').classList.add('hidden');
  state.pendingAddVideoListId=null;
}

function populateModalListSelect(preselected){
  const sel=$('modal-list-select');
  sel.innerHTML='';
  if(!state.lists.length){
    sel.innerHTML='<option value="__new__">+ Crear nueva lista…</option>';
    return;
  }
  state.lists.forEach(list=>{
    const opt=document.createElement('option');
    opt.value=list.id; opt.textContent=list.name;
    if(list.id===preselected) opt.selected=true;
    sel.appendChild(opt);
  });
  const newOpt=document.createElement('option');
  newOpt.value='__new__'; newOpt.textContent='+ Crear nueva lista…';
  sel.appendChild(newOpt);
}

$('btn-close-modal').addEventListener('click',closeModal);
$('modal-add-video').addEventListener('click',e=>{ if(e.target===$('modal-add-video')) closeModal(); });
$('btn-open-add-video').addEventListener('click',()=>openAddVideoModal(null));
$('btn-open-add-video-bar').addEventListener('click',()=>openAddVideoModal(null));
$('btn-open-add-video-list').addEventListener('click',()=>openAddVideoModal(state.currentListId));

$('btn-fetch-video').addEventListener('click',async()=>{
  const btn=$('btn-fetch-video'), label=btn.querySelector('.btn-label'), spinner=btn.querySelector('.btn-spinner');
  const url=$('video-url-input').value.trim();
  const errEl=$('modal-error');
  errEl.classList.add('hidden');
  if(!url){ errEl.textContent='Pega una URL de YouTube primero.'; errEl.classList.remove('hidden'); return; }

  btn.disabled=true; label.textContent='Buscando…'; spinner.classList.remove('hidden');
  try {
    const token=await getToken();
    const res=await fetch('/api/add-video',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},
      body:JSON.stringify({url})});
    if(!res.ok){ const d=await res.json(); throw new Error(d.error||`Error ${res.status}`); }
    const { video } = await res.json();

    // Mostrar preview
    const preview=$('video-preview');
    preview.innerHTML=`
      <div class="modal-preview">
        ${video.thumbnail_url?`<img src="${esc(video.thumbnail_url)}" alt="${esc(video.title)}" class="modal-preview-thumb">`:''}
        <div class="modal-preview-info">
          <div class="modal-preview-title">${esc(video.title)}</div>
          <div class="modal-preview-meta">${esc(video.channel_title)} · ${fmtDuration(video.duration_s)}</div>
        </div>
      </div>`;
    preview.classList.remove('hidden');

    // Guardar data para uso en confirm
    btn.dataset.videoData=JSON.stringify(video);
    $('modal-list-select-wrap').classList.remove('hidden');
  } catch(err) {
    errEl.textContent=err.message; errEl.classList.remove('hidden');
  } finally {
    btn.disabled=false; label.textContent='Buscar video'; spinner.classList.add('hidden');
  }
});

$('btn-confirm-add-video').addEventListener('click',async()=>{
  const videoData=JSON.parse($('btn-fetch-video').dataset.videoData||'null');
  if(!videoData){ $('modal-error').textContent='Primero busca un video.'; $('modal-error').classList.remove('hidden'); return; }

  let listId=$('modal-list-select').value;
  if(listId==='__new__'){
    const name=prompt('Nombre de la nueva lista:','');
    if(!name?.trim()) return;
    const newList=createList(name.trim());
    listId=newList.id;
    populateModalListSelect(listId);
  }
  addVideoToList(listId,videoData);
  closeModal();
});

// ── Cargar videos ─────────────────────────────────────────────────────────────
async function loadVideos(reset=false){
  if(state.loading) return;
  state.loading=true;
  if(reset){
    state.rawVideos=[]; state.offset=0; state.hasMore=false;
    $('videos-grid').innerHTML='';
    $('featured-section').innerHTML=''; $('featured-section').classList.add('hidden');
  }
  showLoading(true); hideStates();
  try {
    const token=await getToken();
    const params=new URLSearchParams({offset:String(state.offset),limit:'20',weights:JSON.stringify(state.weights),keywords:JSON.stringify(state.keywords)});
    const res=await fetch(`/api/videos?${params}`,{headers:{'Authorization':`Bearer ${token}`}});
    if(!res.ok){
      if(res.status===401){ await signOut(auth); return; }
      const d=await res.json().catch(()=>({})); throw new Error(d.error||`Error ${res.status}`);
    }
    const { videos, total, hasMore }=await res.json();
    state.hasMore=hasMore; state.offset+=videos.length; state.rawVideos.push(...videos);
    const adjusted=applyFeedback(videos);
    if(reset&&total===0){ showEmpty(); return; }
    if(reset&&adjusted.length>0){ renderFeatured(adjusted[0]); renderGrid(adjusted.slice(1),true); }
    else renderGrid(adjusted,false);
    $('load-more-area').classList.toggle('hidden',!hasMore);
    // Mostrar siempre el botón "Agregar video"
    $('add-video-bar').classList.remove('hidden');
  } catch(err) {
    showError(err.message);
  } finally {
    state.loading=false; showLoading(false);
  }
}

$('btn-load-more').addEventListener('click',()=>loadVideos(false));
$('btn-retry').addEventListener('click',()=>loadVideos(true));

// ── Renderizar ────────────────────────────────────────────────────────────────
function renderFeatured(v){
  const sec=$('featured-section'); sec.innerHTML=''; sec.appendChild(buildFeaturedCard(v)); sec.classList.remove('hidden');
}
function renderGrid(videos,reset){
  const grid=$('videos-grid'); if(reset) grid.innerHTML='';
  videos.forEach(v=>grid.appendChild(buildVideoCard(v)));
}

function buildFeaturedCard(v){
  const a=document.createElement('a');
  a.className='featured-card'; a.href=v.url; a.target='_blank'; a.rel='noopener noreferrer';
  a.id=`card-${v.video_id}`; a.setAttribute('role','listitem');
  a.innerHTML=`
    <span class="featured-badge">🏆 Joya #1</span>
    ${v.thumbnail_url?`<img class="featured-thumb" src="${esc(v.thumbnail_url)}" alt="${esc(v.title)}" loading="lazy">`:`<div class="featured-thumb video-thumb-placeholder">▶</div>`}
    <div class="featured-info">
      <div class="video-title">${esc(v.title)}</div>
      <div class="video-meta"><span class="video-channel">${esc(v.channel_title)}</span><span class="video-views">${fmtViews(v.view_count)} vistas</span><span>${fmtDuration(v.duration_s)}</span></div>
      <div class="video-score-row" style="margin-top:.75rem;gap:.5rem">
        <span class="${scoreBadgeClass(v.score)} score-badge">Score ${(v.score*100).toFixed(0)}</span>
        ${v.breakdown?.captions?'<span class="captions-badge">CC</span>':''}
        <span class="clicks-badge${(v.clicks||0)===0?' hidden':''}" id="clk-${v.video_id}">${v.clicks||0} clic${(v.clicks||0)!==1?'s':''}</span>
      </div>
    </div>`;
  a.appendChild(buildDismissBtn(v.video_id));
  a.appendChild(buildBookmarkBtn(v));
  a.addEventListener('click',e=>{ if(e.target.closest('.btn-dismiss,.btn-bookmark')) return; trackClick(v.video_id); });
  return a;
}

function buildVideoCard(v){
  const a=document.createElement('a');
  a.className='video-card'; a.href=v.url; a.target='_blank'; a.rel='noopener noreferrer';
  a.id=`card-${v.video_id}`; a.setAttribute('role','listitem');
  a.innerHTML=`
    <div class="video-thumb-wrap">
      ${v.thumbnail_url?`<img class="video-thumb" src="${esc(v.thumbnail_url)}" alt="${esc(v.title)}" loading="lazy">`:`<div class="video-thumb-placeholder">▶</div>`}
      <span class="video-duration">${fmtDuration(v.duration_s)}</span>
    </div>
    <div class="video-info">
      <div class="video-title">${esc(v.title)}</div>
      <div class="video-meta"><span class="video-channel">${esc(v.channel_title)}</span><span class="video-views">${fmtViews(v.view_count)}</span></div>
      <div class="video-score-row">
        <span class="${scoreBadgeClass(v.score)} score-badge">Score ${(v.score*100).toFixed(0)}</span>
        <div style="display:flex;gap:.3rem;align-items:center">
          ${v.breakdown?.captions?'<span class="captions-badge">CC</span>':''}
          <span class="clicks-badge${(v.clicks||0)===0?' hidden':''}" id="clk-${v.video_id}">${v.clicks||0} clic${(v.clicks||0)!==1?'s':''}</span>
        </div>
      </div>
    </div>`;
  a.appendChild(buildDismissBtn(v.video_id));
  a.appendChild(buildBookmarkBtn(v));
  a.addEventListener('click',e=>{ if(e.target.closest('.btn-dismiss,.btn-bookmark')) return; trackClick(v.video_id); });
  return a;
}

function buildDismissBtn(videoId){
  const btn=document.createElement('button');
  btn.className='btn-dismiss'; btn.title='No me interesa'; btn.type='button'; btn.innerHTML='×';
  btn.addEventListener('click',e=>{ e.preventDefault(); e.stopPropagation(); dismissVideo(videoId); });
  return btn;
}

function buildBookmarkBtn(videoData){
  const btn=document.createElement('button');
  btn.className='btn-bookmark'; btn.title='Guardar en lista'; btn.type='button';
  btn.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
  btn.addEventListener('click',e=>{
    e.preventDefault(); e.stopPropagation();
    if(!state.lists.length){ promptCreateList(); return; }
    showListDropdown(btn,videoData);
  });
  return btn;
}

// ── Estado UI ─────────────────────────────────────────────────────────────────
function showLoading(show){ $('loading').classList.toggle('hidden',!show); }
function hideStates(){
  $('empty-state').classList.add('hidden');
  $('error-state').classList.add('hidden');
  $('load-more-area').classList.add('hidden');
}
function showEmpty(){ $('empty-state').classList.remove('hidden'); }
function showError(msg){ $('error-state-msg').textContent=msg; $('error-state').classList.remove('hidden'); }

// ── Perfil al estado ──────────────────────────────────────────────────────────
function applyProfileToState(profile){
  state.userProfile=profile;
  if(profile.interest_keywords?.length) state.keywords=profile.interest_keywords;
  if(profile.feedback) state.feedback=profile.feedback;
  if(profile.lists) state.lists=profile.lists;
  if(profile.listItems) state.listItems=profile.listItems;
  // Asegurar que cada lista tiene su objeto en listItems
  state.lists.forEach(l=>{ if(!state.listItems[l.id]) state.listItems[l.id]={}; });
  if(profile.weights){
    Object.assign(state.weights,profile.weights);
    WEIGHT_KEYS.forEach(k=>{ const s=$(`w-${k}`),o=$(`w-${k}-val`); if(s&&state.weights[k]!==undefined){s.value=state.weights[k];o.textContent=state.weights[k];} });
    updateWeightsSum();
  }
  if(profile.settings){
    const s=profile.settings;
    if(s.mode){ state.mode=s.mode; $('mode-select').value=s.mode; }
    if(s.duration_min){ state.durMin=s.duration_min; $('dur-min').value=s.duration_min; $('dur-min-val').textContent=s.duration_min; }
    if(s.duration_max){ state.durMax=s.duration_max; $('dur-max').value=s.duration_max; $('dur-max-val').textContent=s.duration_max; }
  }
}

updateWeightsSum();
