import {CATEGORIES, STORAGE_KEY, parseYouTubeLink, normalizeItem, importLibrary, mergeLibrary, embedUrl, escapeHtml as esc} from './library.js';
import {STARTER_PLAYLISTS} from './starter.js';

const $ = selector => document.querySelector(selector);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
let playlists = STARTER_PLAYLISTS.map(normalizeItem);
let lastId = null;
let preferences = {category:'Toate',sort:'manual',view:'home'};
let storageOK = true;
let storageReadError = false;
let filter = 'Toate';
let view = 'home';
let query = '';
let editingId = null;
let selectedId = null;
let installPrompt = null;
let toastTimer;
let youtubePlayer = null;
let youtubeApiPromise = null;
let playGeneration = 0;
let waitingWorker = null;
let refreshing = false;

try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved.playlists)) throw new Error('Invalid library');
    playlists = saved.playlists.map((item,index)=>normalizeItem({...item,order:Number.isSafeInteger(item.order)?item.order:index}));
    lastId = typeof saved.lastId === 'string' ? saved.lastId : null;
    if (saved.preferences) {
      preferences.category = ['Toate',...CATEGORIES].includes(saved.preferences.category) ? saved.preferences.category : 'Toate';
      preferences.sort = ['manual','newest','name','favorites'].includes(saved.preferences.sort) ? saved.preferences.sort : 'manual';
      preferences.view = ['home','library','favorites'].includes(saved.preferences.view) ? saved.preferences.view : 'home';
    }
  } else localStorage.setItem(STORAGE_KEY, JSON.stringify({playlists,lastId,preferences}));
} catch { storageOK = false; storageReadError = true; }
filter=preferences.category;

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4800);
}

function persist() {
  if (storageReadError) { toast('Biblioteca veche nu a putut fi citită. Exportă lista curentă pentru a o păstra.'); return; }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({playlists,lastId,preferences})); storageOK = true; }
  catch { storageOK = false; toast('Browserul nu poate salva lista. Exportă o copie din Setări.'); }
}

function showDialog(id) {
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  const dialog = document.getElementById(id);
  dialog.showModal();
  document.body.style.overflow = 'hidden';
}

function closeDialog(button) {
  const dialog = button?.closest('dialog') || document.querySelector('dialog[open]');
  dialog?.close();
}

document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('close', () => {
    if (dialog.id === 'player-dialog') {
      playGeneration++;
      if(youtubePlayer) {try{youtubePlayer.destroy();}catch{} youtubePlayer=null;}
      $('#video-container').replaceChildren();
    }
    if (!document.querySelector('dialog[open]')) document.body.style.overflow = '';
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  });
});

const palettes = {
  Remix:['#b7abc9','#292038','#84689c'],
  Chill:['#94b6b1','#183c38','#558f83'],
  Energie:['#dc976f','#442419','#c36736'],
  Altele:['#c8cc86','#343a19','#919a4b']
};

function card(item) {
  const [bg,ink,shape] = palettes[item.category];
  return `<article class="playlist-card"><div class="cover-wrap"><button class="playlist-cover" data-action="play" data-id="${esc(item.id)}" aria-label="Redă ${esc(item.name)}" style="--cover-bg:${bg};--cover-ink:${ink};--cover-shape:${shape}"><span class="cover-top">MdP / PERSONAL COLLECTION</span><span class="cover-ring" aria-hidden="true"></span><span class="cover-line" aria-hidden="true"></span><span class="cover-word" aria-hidden="true">${esc(item.category)}</span><span class="cover-play">${icon('play')}</span></button><button class="favorite-button${item.favorite?' active':''}" data-action="favorite" data-id="${esc(item.id)}" aria-pressed="${item.favorite}" aria-label="${item.favorite?'Scoate de la':'Adaugă la'} Favorite: ${esc(item.name)}">${icon('heart')}</button></div><div class="card-info"><div><h3>${esc(item.name)}</h3><p>${icon('youtube')} ${item.kind==='video'?'Clip YouTube':'Playlist YouTube'} <span>· ${esc(item.category)}</span></p></div><button class="icon-button card-more" data-action="options" data-id="${esc(item.id)}" aria-label="Opțiuni pentru ${esc(item.name)}">${icon('more')}</button></div></article>`;
}

function emptyState(type) {
  const states = {
    empty:['Primul tău vibe începe aici.','Adaugă un playlist de pe YouTube și fă loc muzicii care îți place.','Adaugă primul playlist','add'],
    favorites:['Pentru muzica de suflet.','Apasă pe inima unui playlist din bibliotecă. Îl vei găsi apoi aici.','Vezi biblioteca','library'],
    search:['Niciun playlist găsit.','Încearcă alt nume sau alege toate categoriile.','Resetează căutarea','reset-search'],
    filtered:['Încă nu ai acest vibe.','Adaugă un playlist în această categorie sau explorează întreaga colecție.','Vezi toate playlisturile','reset-search']
  };
  const [title,description,label,action] = states[type];
  return `<div class="empty-state"><div class="empty-illustration" aria-hidden="true"><div class="empty-back"></div><div class="empty-front">${icon('music')}</div><span class="empty-spark">✦</span></div><div class="empty-copy"><h3>${title}</h3><p>${description}</p><button class="text-button" data-action="${action}">${action==='add'?icon('plus'):''}${label}${icon('arrow')}</button></div></div>`;
}

function render() {
  const isFavorites = view === 'favorites';
  $('#hero').hidden = view !== 'home';
  $('#library-title').innerHTML = (isFavorites?'Favoritele tale':'Colecția ta') + '<span class="lime-dot">.</span>';
  $('.section-eyebrow').textContent = isFavorites ? 'MUZICA LA CARE TE ÎNTORCI' : 'UN LOC PENTRU FIECARE VIBE';
  document.querySelectorAll('[data-view]').forEach(link => {
    if (link.dataset.view === view) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
  const base = playlists.filter(item => !isFavorites || item.favorite);
  const needle = query.trim().toLocaleLowerCase('ro');
  const shown = base.filter(item => (filter==='Toate' || item.category===filter) && (!needle || item.name.toLocaleLowerCase('ro').includes(needle)));
  $('#library-toolbar').hidden = playlists.length === 0;
  $('#filters').hidden = base.length === 0;
  $('#filters').innerHTML = ['Toate',...CATEGORIES].map(category => `<button class="filter-button${filter===category?' active':''}" data-action="filter" data-filter="${category}" aria-pressed="${filter===category}">${category}</button>`).join('');
  $('#collection-count').textContent = `${shown.length} ${shown.length===1?'playlist':'playlisturi'}${isFavorites?(shown.length===1?' favorit':' favorite'):''}`;
  $('#collection-hint').textContent = playlists.length ? 'Selectate de tine. Pe ritmul tău.' : 'Adună ce-ți place. Ascultă când vrei.';
  $('#collection-hint').hidden=playlists.length>0;
  $('#sort-label').hidden=playlists.length===0;
  $('#sort-order').value=preferences.sort;
  const ordered=shown.slice().sort((a,b)=>preferences.sort==='manual'?a.order-b.order||a.createdAt-b.createdAt:preferences.sort==='name'?a.name.localeCompare(b.name,'ro'):preferences.sort==='favorites'?Number(b.favorite)-Number(a.favorite)||b.createdAt-a.createdAt:b.createdAt-a.createdAt);
  if (shown.length) $('#collection').innerHTML = '<div class="playlist-grid">' + ordered.map(card).join('') + '</div>';
  else $('#collection').innerHTML = emptyState(!playlists.length?'empty':isFavorites&&!base.length?'favorites':needle?'search':'filtered');
  const last = playlists.find(item => item.id === lastId);
  $('#last-played').hidden = !last;
  if (last) $('#last-played-title').textContent = last.name;
}

function route(initial=false) {
  const hash = location.hash.slice(1);
  view = ['home','library','favorites'].includes(hash) ? hash : preferences.view;
  preferences.view=view;
  filter=preferences.category; query = ''; $('#search').value = '';
  render();
  if(!initial)persist();
}
window.addEventListener('hashchange', () => { route(); window.scrollTo({top:0,behavior:'instant'}); });
$('#search').addEventListener('input', event => { query = event.target.value; render(); });
$('#sort-order').addEventListener('change',event=>{preferences.sort=event.target.value;render();persist();});

function add(item=null) {
  editingId = item?.id || null;
  $('#playlist-form').reset();
  $('#form-error').hidden = true;
  $('#playlist-url').removeAttribute('aria-invalid');
  $('#add-title').innerHTML = (item?'Editează playlistul':'Un nou vibe') + '<span class="lime-dot">.</span>';
  $('#save-button').innerHTML = icon(item?'check':'plus') + (item?' Salvează modificările':' Salvează în bibliotecă');
  if (item) {
    $('#playlist-url').value = item.url;
    $('#playlist-name').value = item.name;
    $('#playlist-category').value = item.category;
  } else if (filter !== 'Toate') $('#playlist-category').value = filter;
  showDialog('add-dialog');
}

$('#playlist-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const parsed = parseYouTubeLink($('#playlist-url').value);
    const duplicate = playlists.find(item => item.url===parsed.url && item.id!==editingId);
    if (duplicate) throw new Error(`Acest link este deja în bibliotecă: „${duplicate.name}”.`);
    const previous = playlists.find(item => item.id===editingId);
    const item = normalizeItem({...previous,...parsed,id:previous?.id || crypto.randomUUID(),name:$('#playlist-name').value,category:$('#playlist-category').value,createdAt:previous?.createdAt ?? Date.now(),order:previous?.order ?? Math.max(-1,...playlists.map(value=>value.order))+1});
    if (editingId) playlists = playlists.map(value => value.id===editingId?item:value);
    else {
      if(playlists.length>=1000) throw new Error('Ai ajuns la 1.000 de playlisturi. Exportă o copie și elimină câteva ca să adaugi altele.');
      playlists.push(item);
    }
    if (view==='favorites' && !item.favorite) { location.hash='library'; view='library'; }
    filter='Toate'; preferences.category='Toate'; query=''; $('#search').value='';
    closeDialog(); render();
    toast(editingId?'Playlist actualizat. Vibe păstrat.':'Playlist adăugat. Dă-i play!'); persist();
  } catch(error) {
    $('#form-error').textContent = error.message;
    $('#form-error').hidden = false;
    $('#playlist-url').setAttribute('aria-invalid','true');
  }
});

function loadYouTubeAPI() {
  if(window.YT?.Player)return Promise.resolve(window.YT);
  if(youtubeApiPromise)return youtubeApiPromise;
  youtubeApiPromise=new Promise(resolve=>{
    let finished=false;
    const complete=value=>{if(finished)return;finished=true;clearTimeout(timer);if(!value)youtubeApiPromise=null;resolve(value);};
    const timer=setTimeout(()=>complete(null),15000);
    const previous=window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady=()=>{if(typeof previous==='function')previous();complete(window.YT);};
    const existing=document.getElementById('youtube-api-script');
    if(existing)existing.remove();
    const script=document.createElement('script');
    script.id='youtube-api-script';script.src='https://www.youtube.com/iframe_api';script.async=true;
    script.onerror=()=>complete(null);
    document.head.append(script);
  });
  return youtubeApiPromise;
}

async function play(item) {
  if (!item) return;
  const generation=++playGeneration;
  $('#player-title').textContent = item.name;
  $('#player-status').textContent='Se încarcă playerul YouTube. Apasă ▶ în player dacă redarea nu pornește automat.';
  $('#player-status').dataset.state='loading';
  $('#youtube-link').href = item.url;
  const frame = document.createElement('iframe');
  frame.id='mdp-youtube-frame';
  frame.title = 'Player YouTube: ' + item.name;
  frame.src = embedUrl(item)+'&enablejsapi=1&origin='+encodeURIComponent(location.origin);
  frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  showDialog('player-dialog');
  $('#video-container').replaceChildren(frame);
  lastId=item.id; render(); persist();
  const api=await loadYouTubeAPI();
  if(generation!==playGeneration||!frame.isConnected)return;
  if(!api){$('#player-status').textContent='Folosește comenzile din player. Dacă nu se încarcă, apasă „Deschide în YouTube”.';return;}
  youtubePlayer=new api.Player(frame,{events:{
    onReady:event=>{if(generation===playGeneration)event.target.playVideo();},
    onStateChange:event=>{
      if(generation!==playGeneration)return;
      const states={1:['playing','Redare în curs. Alege piesele din comenzile YouTube.'],2:['paused','Redare în pauză. Apasă ▶ în player pentru a continua.'],0:['ended','Clipul s-a încheiat. Poți alege altă piesă din playlist.'],3:['buffering','Se încarcă videoclipul…'],5:['ready','Playerul este pregătit. Apasă ▶ pentru a asculta.']};
      if(states[event.data]){const[state,label]=states[event.data];$('#player-status').dataset.state=state;$('#player-status').textContent=label;}
    },
    onError:event=>{
      if(generation!==playGeneration)return;
      $('#player-status').dataset.state='error';
      $('#player-status').dataset.error=String(event.data);
      $('#player-status').textContent=[101,150].includes(event.data)?'Acest clip permite redarea numai în YouTube. Apasă „Deschide în YouTube”.':event.data===100?'Clipul este privat sau nu mai este disponibil. Poți verifica playlistul în YouTube.':'YouTube nu permite redarea acestui clip aici. Apasă „Deschide în YouTube”.';
    }
  }});
}

function options(item) {
  if (!item) return;
  selectedId = item.id;
  $('#item-title').textContent = item.name;
  const ordered=visibleInManualOrder();
  const index=ordered.findIndex(value=>value.id===item.id);
  $('#item-actions').innerHTML = `<div class="order-controls"><span>Ordinea în colecție</span><div><button class="button secondary" data-action="move-up" data-id="${esc(item.id)}"${index<=0?' disabled':''}>↑ Mai sus</button><button class="button secondary" data-action="move-down" data-id="${esc(item.id)}"${index>=ordered.length-1?' disabled':''}>↓ Mai jos</button></div></div><button class="item-action" data-action="play" data-id="${esc(item.id)}">${icon('play')}Redă playlistul</button><button class="item-action" data-action="edit" data-id="${esc(item.id)}">${icon('edit')}Editează numele, categoria sau linkul</button><button class="item-action" data-action="favorite" data-id="${esc(item.id)}">${icon('heart')}${item.favorite?'Scoate de la Favorite':'Adaugă la Favorite'}</button><a class="item-action" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${icon('external')}Deschide în YouTube</a><button class="item-action delete-action" data-action="delete" data-id="${esc(item.id)}">${icon('trash')}Elimină din bibliotecă</button>`;
  showDialog('item-dialog');
}

function visibleInManualOrder(){
  const needle=query.trim().toLocaleLowerCase('ro');
  return playlists.filter(value=>(view!=='favorites'||value.favorite)&&(filter==='Toate'||value.category===filter)&&(!needle||value.name.toLocaleLowerCase('ro').includes(needle))).sort((a,b)=>a.order-b.order||a.createdAt-b.createdAt);
}

function moveItem(item,direction){
  if(!item)return;
  const visible=visibleInManualOrder();
  const index=visible.findIndex(value=>value.id===item.id);
  const neighbor=visible[index+direction];
  if(!neighbor)return;
  const all=playlists.slice().sort((a,b)=>a.order-b.order||a.createdAt-b.createdAt);
  const from=all.findIndex(value=>value.id===item.id),to=all.findIndex(value=>value.id===neighbor.id);
  [all[from],all[to]]=[all[to],all[from]];
  all.forEach((value,index)=>{value.order=index;});
  preferences.sort='manual';render();persist();options(item);toast('Noua ordine este salvată.');
}

function exportBackup() {
  const data = {app:'MdP RemiX 1&1',version:1,exportedAt:new Date().toISOString(),playlists};
  const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href=url; link.download='mdp-remix-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.append(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
  toast('Copia bibliotecii este pregătită pentru descărcare.');
}

$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if(file.size>1048576) throw new Error('Fișierul este prea mare. Alege o copie JSON de maximum 1 MB.');
    const incoming = importLibrary(JSON.parse(await file.text()));
    const merged = mergeLibrary(playlists,incoming);
    if (merged.length>1000) throw new Error('Importul ar depăși limita de 1.000 de playlisturi.');
    const count = merged.length-playlists.length;
    playlists=merged; filter='Toate';preferences.category='Toate'; query=''; $('#search').value='';
    render(); toast(count?`${count} ${count===1?'playlist importat':'playlisturi importate'}.`:'Playlisturile din copie sunt deja în bibliotecă.'); persist();
  } catch(error) { toast(error instanceof SyntaxError?'Fișierul nu este o copie JSON validă.':error.message); }
  event.target.value='';
});

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if(!button) return;
  const action=button.dataset.action;
  const item=playlists.find(value=>value.id===button.dataset.id);
  switch(action) {
    case 'add': add(); break;
    case 'close': closeDialog(button); break;
    case 'guide': showDialog('guide-dialog'); break;
    case 'library': location.hash='library'; break;
    case 'settings':
      $('#storage-note').textContent=storageOK?'Lista este salvată în acest browser, pe acest dispozitiv. Exportă o copie ca să o păstrezi sau să o muți pe alt telefon.':'Browserul nu poate păstra lista în siguranță. Exportă o copie înainte să închizi aplicația.';
      showDialog('settings-dialog'); break;
    case 'filter': filter=button.dataset.filter;preferences.category=filter; render();persist(); break;
    case 'reset-search': filter='Toate';preferences.category='Toate';query='';$('#search').value='';render();persist();break;
    case 'play': play(item); break;
    case 'resume': play(playlists.find(value=>value.id===lastId));break;
    case 'shuffle': {
      const choices=playlists.filter(value=>(view!=='favorites'||value.favorite)&&(filter==='Toate'||value.category===filter)&&(!query||value.name.toLocaleLowerCase('ro').includes(query.trim().toLocaleLowerCase('ro'))));
      if(choices.length) play(choices[Math.floor(Math.random()*choices.length)]);
      else toast('Adaugă un playlist sau schimbă filtrul pentru a asculta.');
      break;
    }
    case 'favorite':
      if(!item) break;
      item.favorite=!item.favorite;
      if(button.closest('#item-dialog')) closeDialog(button);
      render(); toast(item.favorite?'Adăugat la Favorite.':'Eliminat de la Favorite.'); persist();break;
    case 'options': options(item);break;
    case 'edit': if(item) add(item);break;
    case 'move-up':moveItem(item,-1);break;
    case 'move-down':moveItem(item,1);break;
    case 'delete':
      if(!item) break;
      selectedId=item.id;
      $('#delete-description').textContent=`„${item.name}” va fi eliminat din biblioteca MdP RemiX. Îl poți adăuga din nou folosind linkul YouTube.`;
      showDialog('delete-dialog');break;
    case 'confirm-delete':
      playlists=playlists.filter(value=>value.id!==selectedId);
      if(lastId===selectedId)lastId=null;
      closeDialog(button);render();toast('Playlist eliminat din bibliotecă.');persist();break;
    case 'export': exportBackup();break;
    case 'import': $('#import-file').click();break;
    case 'install':
      if(installPrompt){await installPrompt.prompt();installPrompt=null;$('#install-button').hidden=true;}
      break;
    case 'install-shortcut':
      if(installPrompt){await installPrompt.prompt();installPrompt=null;$('#install-button').hidden=true;}
      else showDialog('settings-dialog');
      break;
    case 'update':
      if(waitingWorker)waitingWorker.postMessage({type:'SKIP_WAITING'});
      else location.reload();
      break;
  }
});

window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('#install-button').hidden=false;});
window.addEventListener('appinstalled',()=>{$('#install-button').hidden=true;$('#install-shortcut').hidden=true;$('#install-instructions').textContent='MdP RemiX este instalată. O poți deschide de pe ecranul telefonului.';});
if(window.matchMedia('(display-mode: standalone)').matches || navigator.standalone){$('#install-instructions').textContent='MdP RemiX este deja deschisă ca aplicație pe telefonul tău.';$('#install-shortcut').hidden=true;}
window.addEventListener('offline',()=>toast('Ești offline. Poți organiza biblioteca; pentru redare ai nevoie de internet.'));
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(registration=>{
    const offerUpdate=()=>{if(registration.waiting&&navigator.serviceWorker.controller){waitingWorker=registration.waiting;$('#update-button').hidden=false;toast('O versiune nouă este disponibilă în Setări.');}};
    offerUpdate();
    registration.addEventListener('updatefound',()=>{const installing=registration.installing;if(installing)installing.addEventListener('statechange',()=>{if(installing.state==='installed')offerUpdate();});});
    registration.update().catch(()=>{});
  }).catch(()=>{}));
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(waitingWorker&&!refreshing){refreshing=true;location.reload();}});
}
route(true);
if(storageReadError)toast('Biblioteca nu a putut fi citită. Verifică Setări și păstrează o copie exportată.');
