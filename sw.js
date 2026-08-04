/*
 * 离线缓存。策略：network-first —— 所有文件都先走网络拿最新的，
 * 只有网络失败时才回退到缓存。有网时看到的永远是最新版，
 * 没网时（走在路上没信号）回退到上次存的那份。
 */

const CACHE_VERSION = 'v2';
const CACHE_NAME = `cal-dining-${CACHE_VERSION}`;

/*
 * 首次安装就存一份，加到主屏幕后马上断网也能打开。
 * 有了它，第一次进来就具备离线能力，不用等各个文件被访问过一遍。
 *
 * 注意这里没有 sw.js —— service worker 自己绝对不能进缓存，
 * 否则浏览器永远拿到旧的那份，你就再也推不动更新了。
 */
const PRECACHE = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './manifest.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './data/menu.json',
  './data/glossary.json',
];

/* 网络和缓存都没有时给 HTML 请求兜底，总比白屏强 */
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>离线 · Cal Dining 双语菜单</title>
<style>
  body {
    margin: 0; min-height: 100vh;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 14px; padding: 32px;
    background: #fff; color: #16191d;
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
    text-align: center;
  }
  h1 { font-size: 19px; margin: 0; }
  p { margin: 0; font-size: 14px; color: #868e96; }
  button {
    margin-top: 8px; padding: 10px 22px;
    border: 0; border-radius: 999px;
    background: #003262; color: #fff;
    font: inherit; font-size: 15px; cursor: pointer;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #0e1114; color: #e9ecef; }
    p { color: #7d868e; }
  }
</style>
</head>
<body>
  <h1>现在没有网络</h1>
  <p>这是第一次打开，还没来得及把菜单存到手机上。<br>连上网刷新一次，之后断网也能看。</p>
  <button onclick="location.reload()">重新加载</button>
</body>
</html>`;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // 单个文件 404 不该让整次安装失败
    await Promise.allSettled(PRECACHE.map((u) => cache.add(u)));
    await self.skipWaiting();   // 不等旧的 sw 退场，直接进入等待激活
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    /*
     * 删掉所有名字不等于当前版本的缓存 —— 不按前缀过滤。
     * 旧版本已经装在别人手机上，谁也不确定它当初叫什么名字，
     * 只有「留下当前这个、其余全删」才能保证迁移干净。
     */
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    );
    await self.clients.claim();  // 立刻接管已经开着的页面，不用等标签页全关掉
  })());
});

const isHTML = (req) =>
  req.mode === 'navigate' ||
  (req.headers.get('accept') || '').includes('text/html');

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 不碰 sw.js 自己，交给浏览器原生的更新机制
  if (url.pathname.endsWith('/sw.js')) return;

  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);

  try {
    /*
     * cache: 'no-cache' 是这里的关键。
     *
     * 光写 fetch(req) 是不够的 —— 它仍然会被「浏览器自己的 HTTP 缓存」拦下来，
     * 拿到旧文件，那 network-first 就名存实亡了。GitHub Pages 给静态文件发的是
     * Cache-Control: max-age=600，意味着你传完新文件后的 10 分钟内，
     * 用户刷新拿到的还是旧版。
     *
     * 'no-cache' 强制向服务器验证（带上 If-None-Match / If-Modified-Since）：
     * 内容没变就回 304，不重新下载（menu.json 有 890KB，这点很重要）；
     * 变了才下载新的。既保证最新，又不浪费流量。
     */
    const res = await fetch(req, { cache: 'no-cache' });

    /*
     * 只存干净的 200。
     * - 206（分段）塞进 Cache 会直接抛异常
     * - redirected 的响应之后拿来响应 navigate 请求会报错
     *   （GitHub Pages 会把 /cal-dining 跳到 /cal-dining/）
     */
    if (res && res.status === 200 && !res.redirected) {
      // 不 await，别让写缓存拖慢返回
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;

  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;

    // 网络和缓存都没有：HTML 给个离线提示页，别让用户看白屏
    if (isHTML(req)) {
      return new Response(OFFLINE_HTML, {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // 其余（menu.json / glossary.json 等）照常抛错，
    // 前端 catch 到之后会显示「菜单载入失败」
    throw err;
  }
}
