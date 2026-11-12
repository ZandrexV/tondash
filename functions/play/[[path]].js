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
  if (!m) return new Response('Not found', { status: 404 });

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

  // DEBUG: útil mientras ajustas. Quita estos logs en producción.
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

/* ---------- HTML de la página intermedia ---------- */

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
  body{
    margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:system-ui,-apple-system,sans-serif;color:#fff;${bg};
    background-size:cover;background-position:center;
  }
  .overlay{
    position:fixed;inset:0;background:rgba(0,0,0,.55);
    backdrop-filter:blur(2px);
  }
  .card{
    position:relative;z-index:1;text-align:center;padding:2rem 2.5rem;
    background:rgba(0,0,0,.55);border-radius:16px;max-width:90vw;
    box-shadow:0 10px 40px rgba(0,0,0,.5);
  }
  .spinner{
    width:48px;height:48px;border:4px solid rgba(255,255,255,.25);
    border-top-color:#fff;border-radius:50%;margin:0 auto 1rem;
    animation:spin 1s linear infinite;
  }
  @keyframes spin{to{transform:rotate(360deg)}}
  #msg{font-size:.95rem;opacity:.85;margin-top:.75rem}
  .captcha-wrap{margin-top:1.25rem;display:flex;justify-content:center}
</style>
</head>
<body>
<div class="overlay"></div>
<div class="card">
  <div class="spinner"></div>
  <div>Preparando el reproductor…</div>
  <div id="msg">Verifica que eres humano para continuar</div>
  <div class="captcha-wrap">
    <div class="cf-turnstile"
         data-sitekey="${env.TURNSTILE_SITE_KEY}"
         data-callback="onTurnstile"
         data-appearance="always"
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