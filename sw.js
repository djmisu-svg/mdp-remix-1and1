const CACHE='mdp-remix-shell-v3';
const ASSETS=['/','/index.html','/style.css','/app.js','/library.js','/starter.js','/icon.svg','/icon-192.png','/icon-512.png','/icon-maskable-512.png','/manifest.webmanifest'];
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    try{
      const responses=await Promise.all(ASSETS.map(async path=>{
        const response=await fetch(new Request(path,{cache:'reload'}));
        if(!response.ok||response.redirected)throw new Error('Application file unavailable: '+path);
        const type=response.headers.get('content-type')||'';
        if((path.endsWith('.js')&&!/javascript/.test(type))||(path.endsWith('.css')&&!/text\/css/.test(type)))throw new Error('Unexpected application file: '+path);
        if((path==='/'||path==='/index.html')&&!(await response.clone().text()).includes('id="playlist-form"'))throw new Error('Application sign-in is required.');
        return[path,response];
      }));
      const cache=await caches.open(CACHE);
      for(const[path,response]of responses)await cache.put(path,response);
      if(!self.registration.active)await self.skipWaiting();
    }catch(error){await caches.delete(CACHE);throw error;}
  })());
});
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('mdp-remix-shell-')&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  if(event.request.mode==='navigate'&&(url.pathname==='/'||url.pathname==='/index.html')){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE);
      const shell=(await cache.match('/index.html'))||(await cache.match('/'));
      if(shell)return shell;
      try{return await fetch(event.request);}
      catch{return new Response('MdP RemiX 1&1: conectează-te la internet pentru prima deschidere.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});}
    })());
  }else if(ASSETS.includes(url.pathname)){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE);
      const cached=await cache.match(url.pathname);
      return cached||fetch(event.request);
    })());
  }
});
