// functions/play/[[path]].js
// Redirector con spinner violeta, backdrop TMDB y Turnstile invisible.

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);

  if (pathParts.length < 3 || pathParts[0] !== 'play') {
    return new Response('Ruta inválida', { status: 400 });
  }

  const type = pathParts[1];
  const id = pathParts[2];
  const season = pathParts[3];
  const episode = pathParts[4];

  if (type !== 'movie' && type !== 'tv') {
    return new Response('Tipo inválido', { status: 400 });
  }
  if (type === 'tv' && (!season || !episode)) {
    return new Response('Faltan temporada o episodio', { status: 400 });
  }
  if (!/^\d+$/.test(id)) {
    return new Response('ID de TMDB inválido', { status: 400 });
  }

  // ── Datos de TMDB para el backdrop ──────────────────────────────────
  const tmdbApiKey = context.env.TMDB_API_KEY;
  let backdropUrl = '';
  let displayTitle = 'Cargando…';

  if (tmdbApiKey) {
    try {
      const endpoint = type === 'movie'
        ? `https://api.themoviedb.org/3/movie/${id}?api_key=${tmdbApiKey}&language=es-ES`
        : `https://api.themoviedb.org/3/tv/${id}?api_key=${tmdbApiKey}&language=es-ES`;
      const res = await fetch(endpoint);
      if (res.ok) {
        const data = await res.json();
        if (data.backdrop_path) {
          backdropUrl = `https://image.tmdb.org/t/p/w1280${data.backdrop_path}`;
        }
        const title = data.title || data.name || '';
        const year = (data.release_date || data.first_air_date || '').substring(0, 4);
        if (title) displayTitle = `${title}${year ? ` (${year})` : ''}`;
      }
    } catch (e) {
      console.error('TMDB error:', e);
    }
  }

  const siteKey = context.env.TURNSTILE_SITE_KEY; // Público, va en el HTML

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${displayTitle}</title>
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192x192.png">
  <meta property="og:title" content="${displayTitle}">
  ${backdropUrl ? `<meta property="og:image" content="${backdropUrl}">` : ''}
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; }
    body {
      display: flex;
      justify-content: center;
      align-items: center;
      background-color: #0a0a0a;
      background-image: ${backdropUrl ? `url('${backdropUrl}')` : 'none'};
      background-size: cover;
      background-position: center;
      background-attachment: fixed;
      overflow: hidden;
    }
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      z-index: 1;
    }
    .spinner {
      position: relative;
      z-index: 2;
      width: 28px;
      height: 28px;
      border: 3px solid rgba(139, 92, 246, 0.25);
      border-top-color: #8b5cf6;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="spinner" role="status" aria-label="Cargando"></div>

  <!-- Widget invisible de Turnstile -->
  <div class="cf-turnstile"
       data-sitekey="${siteKey}"
       data-size="invisible"
       data-callback="onTurnstileSuccess"
       data-error-callback="onTurnstileError"
       style="display: none;">
  </div>

  <script>
    const payload = {
      type: ${JSON.stringify(type)},
      id: ${JSON.stringify(id)},
      season: ${JSON.stringify(season || null)},
      episode: ${JSON.stringify(episode || null)}
    };

    function onTurnstileSuccess(token) {
      // Enviar el token al endpoint de verificación del servidor
      fetch('/api/verify-turnstile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, turnstileToken: token })
      })
      .then(res => res.json())
      .then(data => {
        if (data.redirect) {
          window.location.replace(data.redirect);
        } else {
          console.error('Verificación fallida:', data);
          // Redirigir de todos modos como fallback (o mostrar error)
          // window.location.replace('https://player.tonplayer.space/...'); 
        }
      })
      .catch(err => {
        console.error('Error al verificar:', err);
        // Fallback: redirigir sin token si la verificación falla
      });
    }

    function onTurnstileError(code) {
      console.error('Turnstile error:', code);
      // Fallback: redirigir sin token
    }
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}