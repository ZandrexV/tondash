// functions/play/[[path]].js
// Flujo:
//   1. GET sin cookie → página con captcha
//   2. POST con token OK → Set-Cookie + devuelve { url: "/embed?src=..." }
//   3. Client-side: oculta captcha, reproduce VAST
//   4. Al terminar el ad (o skip/error/timeout) → location.replace(url)

const PASS_COOKIE = 'captcha_pass';
const PASS_TTL = 60 * 60 * 24; // 24h
const VAST_URL = 'https://unfolded-uncle.com/d.miF/zddwGtN/vaZsGiUV/Gewmj9/uJZ/UYl/k/P/T_cczYN/D/EU4FNUjik-thN/zVMk0aMYTLge3YMPwT'; // fallback; mejor definir env.VAST_URL

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' };

export async function onRequest({ request, env }) {
  const url = new URL(request.url);

  if (request.method === 'GET' && isDirectNavigation(request, url)) {
    return new Response(renderBlocked(), { status: 403, headers: HTML_HEADERS });
  }

  // movie: sin temporada/episodio · tv: temporada/episodio opcionales · barra final opcional
  const m = url.pathname.match(
    /^\/play\/(?:(movie)\/(tt\d+|\d+)|(tv)\/(tt\d+|\d+)(?:\/(\d+)\/(\d+))?)\/?$/
  );
  if (!m) {
    if (request.method === 'GET') {
      return new Response(renderHelp(env), { status: 404, headers: HTML_HEADERS });
    }
    return new Response('Not found', { status: 404 });
  }

  const type = m[1] || m[3];
  const rawId = m[2] || m[4];
  const s = m[5];
  const e = m[6];

  let id = rawId;
  if (rawId.startsWith('tt')) {
    id = await resolveImdb(env, rawId, type);
    if (!id) {
      if (request.method === 'GET') {
        return new Response(renderHelp(env), { status: 404, headers: HTML_HEADERS });
      }
      return json({ error: 'ID IMDB no encontrado en TMDB' }, 404);
    }
  }

  if (request.method === 'GET') {
    const hasValidPass = await hasPass(request, env);

    if (hasValidPass) {
      const playerUrl = await generateLink(env, type, id, s, e);
      if (!playerUrl) {
        return new Response(renderHelp(env), { status: 502, headers: HTML_HEADERS });
      }
      // OJO: con cookie válida se salta captcha Y ad → 302 directo
      return new Response(null, {
        status: 302,
        headers: {
          Location: `/embed?src=${encodeURIComponent(playerUrl)}`,
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          Vary: 'Cookie',
        },
      });
    }

    const backdrop = await getBackdrop(env, type, id);
    return new Response(renderPage(env, type, id, s, e, backdrop), {
      headers: {
        ...HTML_HEADERS,
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  }

  if (request.method === 'POST') {
    const alreadyPassed = await hasPass(request, env);
    let ok = alreadyPassed;
    if (!ok) {
      const body = await request.json().catch(() => null);
      const token = body?.token;
      if (!token) return json({ error: 'Token faltante' }, 400);
      ok = await verifyTurnstile(env, token, request);
    }
    if (!ok) return json({ error: 'Captcha inválido' }, 403);

    const playerUrl = await generateLink(env, type, id, s, e);
    if (!playerUrl) return json({ error: 'Error generando enlace' }, 502);

    const headers = new Headers({ 'Content-Type': 'application/json' });
    const secret = getSecret(env);
    if (!alreadyPassed && secret) {
      const passValue = await createPassCookie(secret);
      headers.append(
        'Set-Cookie',
        `${PASS_COOKIE}=${passValue}; Max-Age=${PASS_TTL}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned`
      );
    }
    return new Response(
      JSON.stringify({ url: `/embed?src=${encodeURIComponent(playerUrl)}` }),
      { status: 200, headers }
    );
  }

  return new Response('Method Not Allowed', { status: 405 });
}

/* ---------- Utilidades ---------- */
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

// JSON seguro para incrustar dentro de <script>
const jsStr = (v) =>
  JSON.stringify(v ?? '')
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

function fetchT(url, opts = {}, ms = 5000) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
}

/* ---------- Detección de acceso directo ---------- */
function isDirectNavigation(request, url) {
  const dest = request.headers.get('Sec-Fetch-Dest');
  const referer = request.headers.get('Referer');
  if (dest === 'iframe') return false;
  if (dest === 'document') return true;
  if (dest) return false;
  if (!referer) return true;
  try { return new URL(referer).origin === url.origin; } catch { return true; }
}

/* ---------- Cookie firmada ---------- */
function getSecret(env) { return env.PASS_SECRET || env.TURNSTILE_SECRET_KEY; }

function getCookie(request, name) {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return null;
  const match = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? match[1] : null;
}

function bytesToHex(bytes) {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    bytes[i] = byte;
  }
  return bytes;
}

async function hmacSign(secret, payload) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return bytesToHex(new Uint8Array(sig));
}

async function createPassCookie(secret) {
  if (!secret) throw new Error('Falta PASS_SECRET');
  const expiry = Math.floor(Date.now() / 1000) + PASS_TTL;
  const payload = `v1:${expiry}`;
  const sig = await hmacSign(secret, payload);
  return `${payload}:${sig}`;
}

async function verifyPassCookie(value, secret) {
  if (!secret || typeof value !== 'string') return false;
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  const [version, expiryStr, sigHex] = parts;
  if (version !== 'v1') return false;
  const expiry = parseInt(expiryStr, 10);
  if (!Number.isFinite(expiry)) return false;
  if (Math.floor(Date.now() / 1000) > expiry) return false;
  const sigBytes = hexToBytes(sigHex);
  if (!sigBytes) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  return crypto.subtle.verify(
    'HMAC', key, sigBytes,
    new TextEncoder().encode(`${version}:${expiryStr}`)
  );
}

async function hasPass(request, env) {
  const cookie = getCookie(request, PASS_COOKIE);
  if (!cookie) return false;
  try {
    return await verifyPassCookie(cookie, getSecret(env));
  } catch { return false; }
}

/* ---------- Helpers de red ---------- */
async function resolveImdb(env, imdbId, type) {
  try {
    const r = await fetchT(
      `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id&api_key=${env.TMDB_API_KEY}`
    );
    if (!r.ok) return null;
    const d = await r.json();
    const list = type === 'movie' ? d.movie_results : d.tv_results;
    if (!list || !list.length) return null;
    return String(list[0].id);
  } catch { return null; }
}

async function getBackdrop(env, type, id) {
  try {
    const endpoint = type === 'movie'
      ? `https://api.themoviedb.org/3/movie/${id}`
      : `https://api.themoviedb.org/3/tv/${id}`;
    const r = await fetchT(`${endpoint}?api_key=${env.TMDB_API_KEY}&language=es-ES`);
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.backdrop_path) return null;
    return `https://image.tmdb.org/t/p/w1280${d.backdrop_path}`;
  } catch { return null; }
}

async function generateLink(env, type, id, s, e) {
  try {
    const target = `${env.PLAYER_URL}/link/${type}/${id}${s ? `/${s}/${e}` : ''}`;
    const r = await fetchT(target, { headers: { 'X-Api-Key': env.LINK_API_KEY } });
    const d = await r.json().catch(() => null);
    if (!d || !d.success) return null;
    return d.url;
  } catch { return null; }
}

async function verifyTurnstile(env, token, request) {
  try {
    const form = new URLSearchParams({
      secret: env.TURNSTILE_SECRET_KEY,
      response: token,
    });
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) form.append('remoteip', ip);
    const r = await fetchT(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'POST', body: form }
    );
    const d = await r.json().catch(() => null);
    if (d?.success !== true) {
      console.log('siteverify fail:', r.status, JSON.stringify(d?.['error-codes'] || d));
    }
    return d?.success === true;
  } catch { return false; }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/* ---------- HTML: captcha primero, VAST después ---------- */
function renderPage(env, type, id, s, e, backdrop) {
  const bg = backdrop
    ? `background-image:url('${esc(backdrop)}')`
    : 'background:#0b0b0b';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cargando…</title>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<style>
  *{box-sizing:border-box}
  html,body{height:100%}
  body{
    margin:0;min-height:100%;
    display:flex;align-items:center;justify-content:center;
    font-family:system-ui,-apple-system,sans-serif;color:#fff;${bg};
    background-size:cover;background-position:center;
    padding:1rem;
  }
  .overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(2px)}
  .card{
    position:relative;z-index:1;text-align:center;
    padding:2rem 2.5rem;background:rgba(0,0,0,.55);border-radius:16px;
    max-width:90vw;box-shadow:0 10px 40px rgba(0,0,0,.5);
  }
  .spinner{
    width:48px;height:48px;border:4px solid rgba(255,255,255,.25);
    border-top-color:#fff;border-radius:50%;margin:0 auto 1rem;
    animation:spin 1s linear infinite;
  }
  @keyframes spin{to{transform:rotate(360deg)}}
  .title{font-size:1rem;font-weight:500}
  #msg{font-size:.95rem;opacity:.85;margin-top:.75rem}
  .captcha-wrap{margin-top:1.25rem;display:flex;justify-content:center}

  /* Anuncio */
  #ad-layer{position:fixed;inset:0;background:#000;z-index:9999;display:flex;align-items:center;justify-content:center}
  #ad-layer.hidden{display:none}
  #ad-loading{
    position:absolute;inset:0;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:.75rem;color:#fff;
  }
  #ad-loading .spinner{width:40px;height:40px;margin:0}
  #ad-video{display:none;width:100%;height:100%;object-fit:contain;background:#000}
  #ad-unmute{
    display:none;position:absolute;top:1rem;right:1rem;
    align-items:center;gap:.4rem;padding:.5rem .9rem;border:0;border-radius:999px;
    background:rgba(255,255,255,.92);color:#111;
    font-weight:600;font-size:.85rem;cursor:pointer;
    box-shadow:0 4px 16px rgba(0,0,0,.35);font-family:inherit;z-index:10001;
  }
  #ad-unmute svg{width:16px;height:16px;flex-shrink:0}
  #ad-skip{
    position:absolute;bottom:1.25rem;right:1.25rem;padding:.5rem 1rem;
    background:rgba(0,0,0,.7);color:#fff;border-radius:8px;font-size:.88rem;
    cursor:pointer;border:0;font-family:inherit;z-index:10001;
  }
  #ad-skip[disabled]{cursor:default;opacity:.6}
  #ad-click{
    position:absolute;top:1rem;left:1rem;padding:.5rem 1rem;
    background:rgba(255,255,255,.9);color:#111;border-radius:8px;
    font-size:.82rem;text-decoration:none;font-weight:600;z-index:10001;
  }

  @media (max-width:480px), (max-height:500px){
    body{padding:.5rem}
    .card{padding:1rem .75rem;border-radius:10px;max-width:100%}
    .spinner{width:28px;height:28px;border-width:2px;margin-bottom:.5rem}
    .title{font-size:.82rem}
    #msg{font-size:.72rem;margin-top:.35rem}
    .captcha-wrap{margin-top:.6rem;transform:scale(.82);transform-origin:center}
    #ad-unmute{top:.5rem;right:.5rem;padding:.4rem .75rem;font-size:.75rem}
    #ad-skip{bottom:.75rem;right:.75rem;font-size:.75rem;padding:.35rem .7rem}
    #ad-click{top:.5rem;left:.5rem;font-size:.72rem;padding:.35rem .7rem}
  }
  @media (max-width:320px), (max-height:340px){
    body{padding:.35rem}
    .card{padding:.75rem .5rem;border-radius:8px}
    .spinner{width:22px;height:22px;border-width:2px;margin-bottom:.35rem}
    .title{font-size:.75rem}
    #msg{font-size:.68rem;margin-top:.25rem}
    .captcha-wrap{margin-top:.4rem;transform:scale(.72)}
  }
</style>
</head>
<body>

<!-- ========== Captcha (visible al inicio) ========== -->
<div class="overlay"></div>
<div class="card" id="captcha-card">
  <div class="spinner"></div>
  <div class="title">Preparando el reproductor…</div>
  <div id="msg">Verifica que eres humano para continuar</div>
  <div class="captcha-wrap">
    <div class="cf-turnstile"
         data-sitekey="${esc(env.TURNSTILE_SITE_KEY)}"
         data-callback="onTurnstile"
         data-expired-callback="onTsReset"
         data-error-callback="onTsReset"
         data-appearance="always"
         data-size="flexible"
         data-theme="dark"></div>
  </div>
</div>

<!-- ========== Anuncio (oculto al inicio) ========== -->
<div id="ad-layer" class="hidden">
  <div id="ad-loading">
    <div class="spinner"></div>
    <div>Cargando…</div>
  </div>
  <video id="ad-video" playsinline muted preload="auto"></video>
  <button id="ad-unmute" type="button" title="Activar sonido">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"></polygon>
      <line x1="23" y1="9" x2="17" y2="15"></line>
      <line x1="17" y1="9" x2="23" y2="15"></line>
    </svg>
    <span>Activar sonido</span>
  </button>
  <button id="ad-skip" type="button" hidden>Omitir</button>
  <a id="ad-click" hidden target="_blank" rel="noopener noreferrer">Más info ›</a>
</div>

<script>
  var VAST_URL = ${jsStr(env.VAST_URL || VAST_URL)};
  var AD_FETCH_TIMEOUT = 2000;   // ms para obtener el VAST (cada petición)
  var AD_PLAY_GUARD    = 5000;   // ms para que el video empiece

  var adLayer    = document.getElementById('ad-layer');
  var adLoading  = document.getElementById('ad-loading');
  var video      = document.getElementById('ad-video');
  var unmuteBtn  = document.getElementById('ad-unmute');
  var skipBtn    = document.getElementById('ad-skip');
  var clickBtn   = document.getElementById('ad-click');
  var captchaEl  = document.getElementById('captcha-card');

  var ad = null;
  var fired = { impression:false, start:false, q1:false, mid:false, q3:false, complete:false };
  var skipped = false;
  var pendingPlayerUrl = null;
  var reachedPlayer = false;

  function t(root, tag) {
    var el = root.querySelector(tag);
    return el ? el.textContent.trim() : null;
  }

  function parseDur(s) {
    if (!s) return null;
    if (/^\\d+(\\.\\d+)?$/.test(s)) return parseFloat(s);
    var p = s.split(':').map(parseFloat);
    if (p.length === 3) return p[0]*3600 + p[1]*60 + p[2];
    if (p.length === 2) return p[0]*60 + p[1];
    return null;
  }

  function collectTracking(root) {
    var out = {};
    root.querySelectorAll('Tracking').forEach(function(el){
      var ev = el.getAttribute('event');
      var url = el.textContent.trim();
      if (ev && url) { (out[ev] = out[ev] || []).push(url); }
    });
    return out;
  }

  function fire(url, code) {
    if (!url) return;
    url = url.replace(/\\[(CACHEBUSTING|TIMESTAMP)\\]/g, Date.now())
             .replace(/\\[ERRORCODE\\]/g, code || 900)
             .replace(/\\[CONTENTPLAYHEAD\\]/g, video && video.currentTime ? video.currentTime.toFixed(3) : '00:00:00.000');
    try { var img = new Image(); img.referrerPolicy = 'no-referrer'; img.src = url; } catch (e) {}
  }

  function fireAll(list, code) {
    (list || []).forEach(function(u){ fire(u, code); });
  }

  function texts(root, sel) {
    return Array.from(root.querySelectorAll(sel))
      .map(function(e){ return e.textContent.trim(); })
      .filter(Boolean);
  }

  function resolveVast(url, depth) {
    depth = depth || 0;
    if (depth > 3) return Promise.resolve(null);
    var ctrl = new AbortController();
    var timer = setTimeout(function(){ ctrl.abort(); }, AD_FETCH_TIMEOUT);
    return fetch(url, { credentials: 'omit', mode: 'cors', signal: ctrl.signal })
      .then(function(r){ clearTimeout(timer); return r.ok ? r.text() : null; })
      .then(function(xml){
        if (!xml) return null;
        var doc = new DOMParser().parseFromString(xml, 'text/xml');
        if (doc.querySelector('parsererror')) return null;
        var inline = doc.querySelector('InLine');
        if (inline) return parseInline(inline);
        var wrapper = doc.querySelector('Wrapper');
        if (wrapper) {
          var next = wrapper.querySelector('VASTAdTagURI');
          if (!next) return null;
          return resolveVast(next.textContent.trim(), depth + 1).then(function(inner){
            if (!inner) return null;
            inner.impressions.push.apply(inner.impressions, texts(wrapper, 'Impression'));
            inner.errors.push.apply(inner.errors, texts(wrapper, 'Error'));
            inner.clickTracking.push.apply(inner.clickTracking, texts(wrapper, 'ClickTracking'));
            var wt = collectTracking(wrapper);
            for (var k in wt) { inner.tracking[k] = (inner.tracking[k] || []).concat(wt[k]); }
            return inner;
          });
        }
        return null;
      })
      .catch(function(){ clearTimeout(timer); return null; });
  }

  function parseInline(inline) {
    var duration = parseDur(t(inline, 'Duration'));
    var impressions = texts(inline, 'Impression');
    var errors = texts(inline, 'Error');
    var tracking = collectTracking(inline);
    var clickThrough = t(inline, 'ClickThrough');
    var clickTracking = texts(inline, 'ClickTracking');
    var linear = inline.querySelector('Linear');

    var rawSkip = linear ? linear.getAttribute('skipoffset') : null;
    var skipOffset = null;
    if (rawSkip) {
      skipOffset = /%$/.test(rawSkip)
        ? (duration ? duration * parseFloat(rawSkip) / 100 : null)
        : parseDur(rawSkip);
    }

    var mediaFiles = Array.from(inline.querySelectorAll('MediaFile')).map(function(m){
      return {
        url: m.textContent.trim(),
        type: m.getAttribute('type') || '',
        bitrate: parseInt(m.getAttribute('bitrate') || '0', 10),
        height: parseInt(m.getAttribute('height') || '0', 10)
      };
    }).filter(function(m){ return m.url; });

    var mp4s = mediaFiles.filter(function(m){
      return /mp4|webm/i.test(m.type) || /\\.(mp4|webm)(\\?|$)/i.test(m.url);
    });
    var pool = mp4s.length ? mp4s : mediaFiles;
    // El más cercano a ~480p (evita bitrates enormes en móvil)
    pool.sort(function(a,b){
      return Math.abs((a.height||480)-480) - Math.abs((b.height||480)-480);
    });

    return {
      duration: duration,
      impressions: impressions,
      errors: errors,
      tracking: tracking,
      clickThrough: clickThrough,
      clickTracking: clickTracking,
      skipOffset: skipOffset,
      mediaFile: pool[0] || null
    };
  }

  // Handlers con nombre para poder quitarlos antes de salir
  function onPause()  { if (!video.ended) fireAll(ad.tracking.pause); }
  function onPlay()   { fireAll(ad.tracking.resume); }
  function onVolume() {
    fireAll(video.muted ? ad.tracking.mute : ad.tracking.unmute);
    if (!video.muted) unmuteBtn.style.display = 'none';
  }

  // Ir al player (usado en todos los caminos de salida del ad)
  function goToPlayer() {
    if (reachedPlayer) return;
    reachedPlayer = true;
    video.removeEventListener('timeupdate', onTimeUpdate);
    video.removeEventListener('pause', onPause);
    video.removeEventListener('play', onPlay);
    video.removeEventListener('volumechange', onVolume);
    video.removeEventListener('ended', onEnded);
    video.removeEventListener('error', onError);
    try { video.pause(); } catch (e) {}
    video.removeAttribute('src');
    try { video.load(); } catch (e) {}
    if (pendingPlayerUrl) location.replace(pendingPlayerUrl);
  }

  function showAdLayer() {
    captchaEl.style.display = 'none';
    adLayer.classList.remove('hidden');
  }

  function startAd() {
    if (reachedPlayer) return;
    if (!ad || !ad.mediaFile) return goToPlayer();

    adLoading.style.display = 'none';
    video.style.display = 'block';
    unmuteBtn.style.display = 'flex';

    video.muted = true;
    video.src = ad.mediaFile.url;

    var playGuard = setTimeout(goToPlayer, AD_PLAY_GUARD);
    video.addEventListener('playing', function(){ clearTimeout(playGuard); }, { once: true });
    video.addEventListener('error',   function(){ clearTimeout(playGuard); }, { once: true });

    video.addEventListener('loadedmetadata', function(){
      if (!fired.impression) { fired.impression = true; fireAll(ad.impressions); }
    }, { once: true });

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    video.addEventListener('pause', onPause);
    video.addEventListener('play', onPlay);
    video.addEventListener('volumechange', onVolume);

    if (ad.clickThrough) {
      clickBtn.href = ad.clickThrough;
      clickBtn.hidden = false;
      clickBtn.addEventListener('click', function(){
        fireAll(ad.clickTracking);
        try { video.pause(); } catch (e) {}
      });
      // Reanudar al volver de la pestaña del anunciante
      window.addEventListener('focus', function(){
        if (!reachedPlayer && video.paused && !video.ended) video.play().catch(function(){});
      });
    }

    if (ad.skipOffset != null) {
      skipBtn.hidden = false;
      skipBtn.disabled = true;
      skipBtn.addEventListener('click', function(){
        if (skipBtn.disabled) return;
        skipped = true;
        fireAll(ad.tracking.skip);
        goToPlayer();
      });
    }

    var p = video.play();
    if (p && p.catch) p.catch(function(){ clearTimeout(playGuard); goToPlayer(); });
  }

  function onTimeUpdate() {
    if (!ad) return;
    var d = video.duration;
    var dur = (isFinite(d) && d > 0) ? d : (ad.duration || 0);
    if (!dur) return;
    var pct = video.currentTime / dur;

    if (!fired.start && video.currentTime > 0.1) { fired.start = true; fireAll(ad.tracking.start); }
    if (!fired.q1 && pct >= 0.25) { fired.q1 = true; fireAll(ad.tracking.firstQuartile); }
    if (!fired.mid && pct >= 0.5) { fired.mid = true; fireAll(ad.tracking.midpoint); }
    if (!fired.q3 && pct >= 0.75) { fired.q3 = true; fireAll(ad.tracking.thirdQuartile); }

    if (ad.skipOffset != null && !skipped) {
      var left = ad.skipOffset - video.currentTime;
      if (left > 0) { skipBtn.textContent = 'Omitir en ' + Math.ceil(left); skipBtn.disabled = true; }
      else          { skipBtn.textContent = 'Omitir anuncio ›'; skipBtn.disabled = false; }
    }
  }

  function onEnded() {
    if (!skipped && !fired.complete) { fired.complete = true; fireAll(ad.tracking.complete); }
    goToPlayer();
  }

  function onError() {
    fireAll(ad.errors, 405);
    goToPlayer();
  }

  unmuteBtn.addEventListener('click', function(){
    video.muted = false;
    video.volume = 1;
    unmuteBtn.style.display = 'none';
  });

  function initAd() {
    if (!VAST_URL) return goToPlayer();

    var timeout = setTimeout(goToPlayer, AD_FETCH_TIMEOUT);

    resolveVast(VAST_URL).then(function(result){
      clearTimeout(timeout);
      if (reachedPlayer) return;
      ad = result;
      if (!ad || !ad.mediaFile) return goToPlayer();
      startAd();
    }).catch(function(){
      clearTimeout(timeout);
      goToPlayer();
    });
  }

  // ============================================================
  // Captcha → POST → VAST → redirect
  // ============================================================
  function onTsReset() {
    document.getElementById('msg').textContent = 'Verifica de nuevo';
  }

  async function onTurnstile(token) {
    var msg = document.getElementById('msg');
    msg.textContent = 'Generando enlace…';
    try {
      var r = await fetch(location.pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token })
      });
      var d = await r.json();
      if (!d.url) {
        msg.textContent = 'Error: ' + (d.error || 'desconocido');
        if (window.turnstile) turnstile.reset();
        return;
      }
      pendingPlayerUrl = d.url;
      showAdLayer();
      initAd();
    } catch (err) {
      msg.textContent = 'Error de red';
      if (window.turnstile) turnstile.reset();
    }
  }
</script>
</body>
</html>`;
}

/* ---------- HTML: 404 ---------- */
function renderHelp(env) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ruta no encontrada</title>
<style>
  *{box-sizing:border-box}
  html,body{height:100%}
  body{
    margin:0;min-height:100%;
    display:flex;align-items:center;justify-content:center;
    font-family:system-ui,-apple-system,sans-serif;color:#fff;
    background:#0b0b0b;padding:1rem;
  }
  .card{
    text-align:center;padding:2rem 2rem;
    background:rgba(255,255,255,.04);
    border:1px solid rgba(255,255,255,.08);
    border-radius:16px;max-width:520px;width:100%;
    box-shadow:0 10px 40px rgba(0,0,0,.5);
  }
  .code{
    font-size:2.5rem;font-weight:700;line-height:1;margin-bottom:.4rem;
    background:linear-gradient(135deg,#ff4d4d,#ff9a3c);
    -webkit-background-clip:text;background-clip:text;color:transparent;
  }
  h1{font-size:1.05rem;font-weight:600;margin:0 0 .3rem}
  .sub{font-size:.85rem;opacity:.7;margin:0 0 1.2rem}
  .endpoints{text-align:left;display:grid;gap:.5rem}
  .ep{
    display:flex;flex-direction:column;gap:.3rem;
    padding:.7rem .85rem;border-radius:10px;
    background:rgba(255,255,255,.04);
    border:1px solid rgba(255,255,255,.06);
  }
  .ep .label{font-size:.68rem;letter-spacing:.06em;text-transform:uppercase;opacity:.55;font-weight:600}
  .ep code{
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
    font-size:.82rem;color:#7ee2ff;word-break:break-all;
  }
  .ep .desc{font-size:.74rem;opacity:.7}
  @media (max-width:480px), (max-height:500px){
    body{padding:.5rem}
    .card{padding:1rem .85rem;border-radius:10px;max-width:100%}
    .code{font-size:2rem}
    h1{font-size:.92rem}
    .sub{font-size:.75rem;margin-bottom:.8rem}
    .ep{padding:.55rem .7rem}
    .ep code{font-size:.74rem}
    .ep .desc{font-size:.68rem}
  }
  @media (max-width:320px), (max-height:340px){
    body{padding:.35rem}
    .card{padding:.7rem .5rem;border-radius:8px}
    .code{font-size:1.6rem}
    h1{font-size:.85rem}
    .sub{font-size:.7rem;margin-bottom:.6rem}
    .endpoints{gap:.35rem}
    .ep{padding:.4rem .55rem}
    .ep .label{font-size:.6rem}
    .ep code{font-size:.68rem}
    .ep .desc{font-size:.62rem}
  }
</style>
</head>
<body>
<div class="card">
  <div class="code">404</div>
  <h1>Ruta no encontrada</h1>
  <p class="sub">La URL no corresponde a ningún reproductor.</p>
  <div class="endpoints">
    <div class="ep">
      <span class="label">Película · TMDB</span>
      <code>/play/movie/{tmdb_id}</code>
      <span class="desc">Ej: <code>/play/movie/603</code></span>
    </div>
    <div class="ep">
      <span class="label">Película · IMDB</span>
      <code>/play/movie/{tt_id}</code>
      <span class="desc">Ej: <code>/play/movie/tt0137523</code></span>
    </div>
    <div class="ep">
      <span class="label">Serie · TMDB</span>
      <code>/play/tv/{tmdb_id}/{temp}/{ep}</code>
      <span class="desc">Ej: <code>/play/tv/1396/2/5</code></span>
    </div>
    <div class="ep">
      <span class="label">Serie · IMDB</span>
      <code>/play/tv/{tt_id}/{temp}/{ep}</code>
      <span class="desc">Ej: <code>/play/tv/tt0903747/1/1</code></span>
    </div>
  </div>
</div>
</body>
</html>`;
}

/* ---------- HTML: 403 ---------- */
function renderBlocked() {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Acceso restringido</title>
<style>
  *{box-sizing:border-box}
  html,body{height:100%}
  body{
    margin:0;min-height:100%;
    display:flex;align-items:center;justify-content:center;
    font-family:system-ui,-apple-system,sans-serif;color:#fff;
    background:#0b0b0b;padding:1rem;
  }
  .card{
    text-align:center;padding:2rem;max-width:380px;width:100%;
    background:rgba(255,255,255,.04);
    border:1px solid rgba(255,255,255,.08);
    border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.5);
  }
  .code{
    font-size:2.5rem;font-weight:700;line-height:1;
    background:linear-gradient(135deg,#ff4d4d,#ff9a3c);
    -webkit-background-clip:text;background-clip:text;color:transparent;
  }
  h1{font-size:1rem;margin:.6rem 0 .3rem;font-weight:600}
  p{font-size:.85rem;opacity:.7;margin:0;line-height:1.5}
  @media (max-width:480px), (max-height:500px){
    body{padding:.5rem}
    .card{padding:1.25rem 1rem;border-radius:10px}
    .code{font-size:2rem}
    h1{font-size:.92rem}
    p{font-size:.78rem}
  }
</style>
</head>
<body>
<div class="card">
  <div class="code">403</div>
  <h1>Acceso restringido</h1>
  <p>Esta página solo funciona cuando se embebe en otra web.</p>
</div>
</body>
</html>`;
}
