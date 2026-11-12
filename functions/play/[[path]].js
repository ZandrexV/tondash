// functions/play/[[path]].js
// Rutas (solo embebidas vía iframe):
//   GET  /play/movie/{tmdb_id|tt_id}                 → captcha + backdrop
//   GET  /play/tv/{tmdb_id|tt_id}/{temp}/{ep}        → captcha + backdrop
//   POST /play/...                                   → verifica y devuelve { url }

export async function onRequest({ request, env }) {
  const url = new URL(request.url);

  // ---------- Bloqueo de acceso directo ----------
  if (request.method === 'GET' && isDirectNavigation(request, url)) {
    return new Response(renderBlocked(), {
      status: 403,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // ---------- Validación de ruta (TMDB o IMDB) ----------
  const m = url.pathname.match(
    /^\/play\/(movie|tv)\/(tt\d+|\d+)(?:\/(\d+)\/(\d+))?$/
  );

  if (!m) {
    if (request.method === 'GET') {
      return new Response(renderHelp(env), {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    return new Response('Not found', { status: 404 });
  }

  const [, type, rawId, s, e] = m;

  // ---------- Resolver IMDB → TMDB ----------
  let id = rawId;
  if (rawId.startsWith('tt')) {
    id = await resolveImdb(env, rawId, type);
    if (!id) {
      if (request.method === 'GET') {
        return new Response(renderHelp(env), {
          status: 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      return json({ error: 'ID IMDB no encontrado en TMDB' }, 404);
    }
  }

  // ---------- GET: página intermedia ----------
  if (request.method === 'GET') {
    const backdrop = await getBackdrop(env, type, id);
    return new Response(renderPage(env, type, id, s, e, backdrop), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // ---------- POST: verificar Turnstile y generar enlace ----------
  if (request.method === 'POST') {
    const body = await request.json().catch(() => null);
    const token = body?.token;
    if (!token) return json({ error: 'Token faltante' }, 400);

    const ok = await verifyTurnstile(env, token, request);
    if (!ok) return json({ error: 'Captcha inválido' }, 403);

    const target = `${env.PLAYER_URL}/link/${type}/${id}${
      s ? `/${s}/${e}` : ''
    }`;
    const r = await fetch(target, {
      headers: { 'X-Api-Key': env.LINK_API_KEY },
    });
    const d = await r.json().catch(() => null);
    if (!d || !d.success) return json({ error: 'Error generando enlace' }, 502);

    return json({ url: d.url });
  }

  return new Response('Method Not Allowed', { status: 405 });
}

/* ---------- Detección de acceso directo vs embed ---------- */

function isDirectNavigation(request, url) {
  const dest = request.headers.get('Sec-Fetch-Dest');
  const referer = request.headers.get('Referer');

  // iframe → embed permitido
  if (dest === 'iframe') return false;
  // document → navegación directa del browser → bloquear
  if (dest === 'document') return true;
  // otros dest (empty = fetch, image, etc.) → no es navegación, dejar pasar
  if (dest) return false;

  // Fallback para browsers sin Sec-Fetch-*
  if (!referer) return true;
  try {
    return new URL(referer).origin === url.origin;
  } catch {
    return true;
  }
}

/* ---------- Helpers ---------- */

async function resolveImdb(env, imdbId, type) {
  try {
    const r = await fetch(
      `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id&api_key=${env.TMDB_API_KEY}`
    );
    if (!r.ok) return null;
    const d = await r.json();
    const list = type === 'movie' ? d.movie_results : d.tv_results;
    if (!list || !list.length) return null;
    return String(list[0].id);
  } catch {
    return null;
  }
}

async function getBackdrop(env, type, id) {
  try {
    const endpoint =
      type === 'movie'
        ? `https://api.themoviedb.org/3/movie/${id}`
        : `https://api.themoviedb.org/3/tv/${id}`;
    const r = await fetch(
      `${endpoint}?api_key=${env.TMDB_API_KEY}&language=es-ES`
    );
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.backdrop_path) return null;
    return `https://image.tmdb.org/t/p/w1280${d.backdrop_path}`;
  } catch {
    return null;
  }
}

async function verifyTurnstile(env, token, request) {
  const form = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token,
  });
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) form.append('remoteip', ip);

  const r = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    { method: 'POST', body: form }
  );
  const d = await r.json().catch(() => null);

  console.log('siteverify status:', r.status);
  console.log('siteverify body:', JSON.stringify(d));

  return d?.success === true;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/* ---------- HTML: página de captcha (comprimida para móvil) ---------- */

function renderPage(env, type, id, s, e, backdrop) {
  const bg = backdrop
    ? `background-image:url('${backdrop}')`
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
  .overlay{
    position:fixed;inset:0;background:rgba(0,0,0,.55);
    backdrop-filter:blur(2px);
  }
  .card{
    position:relative;z-index:1;text-align:center;
    padding:2rem 2.5rem;
    background:rgba(0,0,0,.55);border-radius:16px;
    max-width:90vw;
    box-shadow:0 10px 40px rgba(0,0,0,.5);
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

  /* ---------- Compacto: iframe móvil / viewport chico ---------- */
  @media (max-width:480px), (max-height:500px){
    body{padding:.5rem}
    .card{padding:1rem .75rem;border-radius:10px;max-width:100%}
    .spinner{width:28px;height:28px;border-width:2px;margin-bottom:.5rem}
    .title{font-size:.82rem}
    #msg{font-size:.72rem;margin-top:.35rem}
    .captcha-wrap{margin-top:.6rem;transform:scale(.82);transform-origin:center}
  }

  /* ---------- Extra compacto: iframes muy chicos ---------- */
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
<div class="overlay"></div>
<div class="card">
  <div class="spinner"></div>
  <div class="title">Preparando el reproductor…</div>
  <div id="msg">Verifica que eres humano para continuar</div>
  <div class="captcha-wrap">
    <div class="cf-turnstile"
         data-sitekey="${env.TURNSTILE_SITE_KEY}"
         data-callback="onTurnstile"
         data-appearance="always"
         data-size="flexible"
         data-theme="dark"></div>
  </div>
</div>

<script>
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
      if (d.url) {
        location.replace(d.url);
      } else {
        msg.textContent = 'Error: ' + (d.error || 'desconocido');
        if (window.turnstile) turnstile.reset();
      }
    } catch (err) {
      msg.textContent = 'Error de red';
      if (window.turnstile) turnstile.reset();
    }
  }
</script>
</body>
</html>`;
}

/* ---------- HTML: página 404 (con IMDB) ---------- */

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
  .ep .label{
    font-size:.68rem;letter-spacing:.06em;text-transform:uppercase;
    opacity:.55;font-weight:600;
  }
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

/* ---------- HTML: página de bloqueo (acceso directo) ---------- */

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
    border-radius:16px;
    box-shadow:0 10px 40px rgba(0,0,0,.5);
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