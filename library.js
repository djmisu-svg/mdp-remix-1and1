export const CATEGORIES = ['Remix', 'Chill', 'Energie', 'Altele'];
export const STORAGE_KEY = 'mdp-remix-library-v1';
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,150}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeLink(input) {
  let url;
  try { url = new URL(String(input).trim()); } catch { throw new Error('Lipește un link complet de pe YouTube, care începe cu https://.'); }
  if (!['https:', 'http:'].includes(url.protocol) || !HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password || url.port) {
    throw new Error('Folosește un link de pe youtube.com sau youtu.be.');
  }
  const list = url.searchParams.get('list');
  let video = null;
  if (url.hostname.endsWith('youtu.be')) video = url.pathname.split('/')[1];
  else if (url.pathname === '/watch') video = url.searchParams.get('v');
  else if (/^\/(shorts|embed|live)\//.test(url.pathname)) video = url.pathname.split('/')[2];
  if (video && !VIDEO_ID.test(video)) video = null;
  if (list) {
    if (!PLAYLIST_ID.test(list)) throw new Error('Linkul are un cod de playlist nevalid. Copiază din nou linkul din YouTube.');
    return {kind:'playlist', youtubeId:list, videoId:video, url:'https://www.youtube.com/playlist?list=' + encodeURIComponent(list)};
  }
  if (video) return {kind:'video', youtubeId:video, videoId:video, url:'https://www.youtube.com/watch?v=' + encodeURIComponent(video)};
  throw new Error('Acest link nu conține un playlist sau un clip. Deschide playlistul în YouTube și copiază linkul lui.');
}

export function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.url !== 'string') throw new Error('Playlist nevalid.');
  const parsed = parseYouTubeLink(raw.url);
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0,100) : '';
  return {...parsed, id:typeof raw.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(raw.id) ? raw.id : crypto.randomUUID(), name:name || (parsed.kind === 'playlist' ? 'Playlistul meu' : 'Clipul meu'), category:CATEGORIES.includes(raw.category) ? raw.category : 'Altele', favorite:raw.favorite === true, createdAt:Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(), order:Number.isSafeInteger(raw.order)&&raw.order>=0?raw.order:0};
}

export function importLibrary(value) {
  if (!value || !['MdP RemiX','MdP RemiX 1&1'].includes(value.app) || value.version !== 1 || !Array.isArray(value.playlists) || value.playlists.length > 1000) throw new Error('Alege o copie JSON exportată din MdP RemiX 1&1 (maximum 1.000 de playlisturi).');
  return value.playlists.map(normalizeItem);
}

export function mergeLibrary(existing, incoming) {
  const merged = existing.map(item => ({...item}));
  const urls = new Set(merged.map(item => item.url));
  const ids = new Set(merged.map(item => item.id));
  let order=Math.max(-1,...merged.map(item=>item.order||0))+1;
  for (const item of incoming) {
    if (urls.has(item.url)) continue;
    const next = {...item};
    next.order=order++;
    if (ids.has(next.id)) next.id = crypto.randomUUID();
    merged.push(next); ids.add(next.id); urls.add(next.url);
  }
  return merged;
}

export function embedUrl(item) {
  const safe = parseYouTubeLink(item.url);
  const base = safe.kind === 'playlist' ? 'https://www.youtube-nocookie.com/embed/videoseries?list=' + encodeURIComponent(safe.youtubeId) : 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(safe.youtubeId) + '?';
  return base + (safe.kind === 'playlist' ? '&' : '') + 'autoplay=1&playsinline=1&rel=0';
}

export function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
