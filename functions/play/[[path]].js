// functions/play/[[path]].js
// Rutas soportadas:
//   GET  /play/movie/{tmdb_id}                 → página con backdrop + captcha
//   GET  /play/tv/{tmdb_id}/{temporada}/{ep}   → página con backdrop + captcha
//   POST /play/...                             → verifica captcha y devuelve { url }

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const m = url.pathname.match(
    /^\/play\/(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?$/
  );

  // ---------- URL inválida: página de ayuda ----------
  if (!m) {
    if (request.method === 'GET') {
      return new Response(renderHelp(env), {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    return new Response('Not found', { status: 404 });
  }

  const [, type, id, s, e] = m;

  // ---------- GET: página intermedia con backdrop + captcha ----------
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

/* ---------- Helpers ---------- */

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

  // DEBUG: quita estos logs en producción
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

/* ---------- HTML: página de captcha ---------- */

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

<!-- Script de anuncios -->
<script src="https://pl30962784.profitableratecpmnetwork.com/51/af/ca/51afca00c44be302fbdea712d5586975.js"></script>

<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>

<style>
  *{box-sizing:border-box}
  body{
    margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
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
  .card .title{font-size:1rem;font-weight:500}
  #msg{font-size:.95rem;opacity:.85;margin-top:.75rem}
  .captcha-wrap{margin-top:1.25rem;display:flex;justify-content:center}

  /* ---------- Móvil ---------- */
  @media (max-width: 480px) {
    body{padding:.75rem}
    .card{
      padding:1.25rem 1rem;
      border-radius:12px;
      max-width:100%;
      width:100%;
    }
    .spinner{
      width:36px;height:36px;border-width:3px;margin-bottom:.75rem;
    }
    .card .title{font-size:.9rem}
    #msg{font-size:.82rem;margin-top:.5rem}
    .captcha-wrap{
      margin-top:1rem;
      transform:scale(.9);
      transform-origin:center;
    }
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

/* ---------- HTML: página de ayuda / 404 ---------- */

function renderHelp(env) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ruta no encontrada</title>

<!-- Script de anuncios -->
<script src="https://pl30962784.profitableratecpmnetwork.com/51/af/ca/51afca00c44be302fbdea712d5586975.js"></script>

<style>
  *{box-sizing:border-box}
  body{
    margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:system-ui,-apple-system,sans-serif;color:#fff;
    background:#0b0b0b;padding:1rem;
  }
  .card{
    text-align:center;
    padding:2.5rem 2.5rem;
    background:rgba(255,255,255,.04);
    border:1px solid rgba(255,255,255,.08);
    border-radius:16px;
    max-width:640px;width:100%;
    box-shadow:0 10px 40px rgba(0,0,0,.5);
  }
  .code{
    font-size:3rem;font-weight:700;line-height:1;margin-bottom:.5rem;
    background:linear-gradient(135deg,#ff4d4d,#ff9a3c);
    -webkit-background-clip:text;background-clip:text;color:transparent;
  }
  h1{font-size:1.15rem;font-weight:600;margin:0 0 .35rem}
  .sub{font-size:.9rem;opacity:.7;margin:0 0 1.5rem}
  .endpoints{text-align:left;display:grid;gap:.6rem}
  .ep{
    display:flex;flex-direction:column;gap:.35rem;
    padding:.85rem 1rem;border-radius:10px;
    background:rgba(255,255,255,.04);
    border:1px solid rgba(255,255,255,.06);
  }
  .ep .label{
    font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;
    opacity:.55;font-weight:600;
  }
  .ep code{
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
    font-size:.86rem;color:#7ee2ff;word-break:break-all;
  }
  .ep .desc{font-size:.8rem;opacity:.7}
  .btn{
    display:inline-block;margin-top:1.5rem;
    padding:.65rem 1.25rem;border-radius:10px;
    background:#fff;color:#111;text-decoration:none;
    font-size:.9rem;font-weight:600;
    transition:transform .15s ease, opacity .15s ease;
  }
  .btn:hover{transform:translateY(-1px);opacity:.9}

  /* ---------- Móvil ---------- */
  @media (max-width: 480px) {
    body{padding:.75rem}
    .card{padding:1.5rem 1rem;border-radius:12px}
    .code{font-size:2.4rem}
    h1{font-size:1rem}
    .sub{font-size:.82rem;margin-bottom:1.1rem}
    .ep{padding:.7rem .85rem}
    .ep code{font-size:.78rem}
    .ep .desc{font-size:.74rem}
    .btn{margin-top:1.1rem;padding:.6rem 1rem;font-size:.85rem}
  }
</style>
</head>
<body>
<div class="card">
  <div class="code">404</div>
  <h1>Ruta no encontrada</h1>
  <p class="sub">La URL que ingresaste no corresponde a ningún reproductor. Estos son los endpoints disponibles:</p>

  <div class="endpoints">
    <div class="ep">
      <span class="label">Película</span>
      <code>/play/movie/{tmdb_id}</code>
      <span class="desc">Ejemplo: <code>/play/movie/603</code></span>
    </div>
    <div class="ep">
      <span class="label">Serie</span>
      <code>/play/tv/{tmdb_id}/{temporada}/{episodio}</code>
      <span class="desc">Ejemplo: <code>/play/tv/1396/2/5</code></span>
    </div>
  </div>

  <a class="btn" href="/">Volver al inicio</a>
</div>
</body>
</html>`;
}