// functions/play/[[path]].js
// Redirector con spinner + backdrop de TMDB para /play/movie/:id y /play/tv/:id/:season/:episode

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const pathParts = url.pathname.split('/').filter(Boolean); // ["play", "movie", "123"]

  // ── 1. Validar la ruta ──────────────────────────────────────────────
  if (pathParts.length < 3 || pathParts[0] !== 'play') {
    return new Response('Ruta inválida', { status: 400 });
  }

  const type = pathParts[1];            // "movie" o "tv"
  const id = pathParts[2];              // ID de TMDB
  const season = pathParts[3];          // (solo TV)
  const episode = pathParts[4];         // (solo TV)

  // Validar tipo
  if (type !== 'movie' && type !== 'tv') {
    return new Response('Tipo inválido. Debe ser "movie" o "tv"', { status: 400 });
  }

  // Validar estructura TV (necesita temporada y episodio)
  if (type === 'tv' && (!season || !episode)) {
    return new Response('Faltan temporada o episodio en la URL', { status: 400 });
  }

  // Validar que el ID sea numérico (previene inyecciones)
  if (!/^\d+$/.test(id)) {
    return new Response('ID de TMDB inválido', { status: 400 });
  }

  // ── 2. Obtener datos de TMDB (backdrop + título) ────────────────────
  const tmdbApiKey = context.env.TMDB_API_KEY;
  let backdropUrl = '';
  let title = '';
  let year = '';

  if (tmdbApiKey) {
    try {
      const tmdbEndpoint =
        type === 'movie'
          ? `https://api.themoviedb.org/3/movie/${id}?api_key=${tmdbApiKey}&language=es-ES`
          : `https://api.themoviedb.org/3/tv/${id}?api_key=${tmdbApiKey}&language=es-ES`;

      const tmdbRes = await fetch(tmdbEndpoint);

      if (tmdbRes.ok) {
        const data = await tmdbRes.json();

        // Backdrop en alta calidad (w1280 = buen balance calidad/peso)
        if (data.backdrop_path) {
          backdropUrl = `https://image.tmdb.org/t/p/w1280${data.backdrop_path}`;
        }

        // Título (movie → title, tv → name)
        title = data.title || data.name || '';

        // Año (movie → release_date, tv → first_air_date)
        const dateStr = data.release_date || data.first_air_date || '';
        if (dateStr) year = dateStr.substring(0, 4);
      }
    } catch (e) {
      // Si TMDB falla, continuamos sin backdrop (no bloqueamos la redirección)
      console.error('Error al consultar TMDB:', e);
    }
  }

  // ── 3. Construir la URL de destino final ────────────────────────────
  const destination = new URL(url.pathname + url.search, 'https://player.tonplayer.space');

  // ── 4. Escapar el título para insertarlo en HTML de forma segura ────
  const safeTitle = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const displayTitle = safeTitle
    ? `${safeTitle}${year ? ` (${year})` : ''}`
    : 'Cargando...';

  // ── 5. HTML de la página de redirección ─────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>${displayTitle}</title>

  <!-- ═══ FAVICONS (compatibles con Google Search) ═══ -->
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192x192.png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">

  <!-- ═══ Open Graph (buena práctica al compartir) ═══ -->
  <meta property="og:title" content="${displayTitle}">
  <meta property="og:type" content="${type === 'movie' ? 'video.movie' : 'video.tv_show'}">
  ${backdropUrl ? `<meta property="og:image" content="${backdropUrl}">` : ''}

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
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #fff;
      overflow: hidden;
    }
    /* Overlay oscuro para destacar el spinner */
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background: linear-gradient(180deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.9) 100%);
      z-index: 1;
    }
    .container {
      position: relative;
      z-index: 2;
      text-align: center;
      padding: 2rem;
      max-width: 90vw;
    }
    .spinner {
      width: 56px;
      height: 56px;
      border: 4px solid rgba(255, 255, 255, 0.15);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.9s linear infinite;
      margin: 0 auto 1.5rem;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .title {
      font-size: 1.4rem;
      font-weight: 600;
      margin: 0 0 0.5rem;
      text-shadow: 0 2px 8px rgba(0,0,0,0.8);
      line-height: 1.3;
    }
    .subtitle {
      font-size: 0.95rem;
      color: rgba(255, 255, 255, 0.7);
      margin: 0;
    }
    /* Respeto por usuarios que prefieren menos animación */
    @media (prefers-reduced-motion: reduce) {
      .spinner { animation-duration: 2s; }
    }
  </style>

  <script>
    // Redirigir tras el delay (ajusta el número de ms a tu gusto)
    setTimeout(function () {
      window.location.replace(${JSON.stringify(destination.toString())});
    }, 1500);
  </script>
</head>
<body>
  <div class="container">
    <div class="spinner" aria-hidden="true"></div>
    <h1 class="title">${displayTitle}</h1>
    <p class="subtitle">Redirigiendo al reproductor…</p>
  </div>
</body>
</html>`;

  // ── 6. Devolver respuesta con caché corta ───────────────────────────
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300', // 5 min de caché
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}