// functions/play/[[path]].js
// Redirector con spinner violeta + backdrop de TMDB
// Soporta: /play/movie/:id  y  /play/tv/:id/:season/:episode

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const pathParts = url.pathname.split('/').filter(Boolean); // ["play","movie","123"]

  // ── 1. Validar la ruta ──────────────────────────────────────────────
  if (pathParts.length < 3 || pathParts[0] !== 'play') {
    return new Response('Ruta inválida', { status: 400 });
  }

  const type    = pathParts[1]; // "movie" o "tv"
  const id      = pathParts[2]; // ID de TMDB
  const season  = pathParts[3]; // (solo TV)
  const episode = pathParts[4]; // (solo TV)

  if (type !== 'movie' && type !== 'tv') {
    return new Response('Tipo inválido. Debe ser "movie" o "tv"', { status: 400 });
  }

  if (type === 'tv' && (!season || !episode)) {
    return new Response('Faltan temporada o episodio en la URL', { status: 400 });
  }

  if (!/^\d+$/.test(id)) {
    return new Response('ID de TMDB inválido', { status: 400 });
  }

  // ── 2. Obtener datos de TMDB (backdrop + título para metadatos) ─────
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

        if (data.backdrop_path) {
          backdropUrl = `https://image.tmdb.org/t/p/w1280${data.backdrop_path}`;
        }

        title = data.title || data.name || '';
        const dateStr = data.release_date || data.first_air_date || '';
        if (dateStr) year = dateStr.substring(0, 4);
      }
    } catch (e) {
      console.error('Error al consultar TMDB:', e);
    }
  }

  // ── 3. Construir URL de destino ─────────────────────────────────────
  const destination = new URL(url.pathname + url.search, 'https://player.tonplayer.space');

  // ── 4. Escapar título (para <title> y OG) ───────────────────────────
  const safeTitle = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const displayTitle = safeTitle
    ? `${safeTitle}${year ? ` (${year})` : ''}`
    : 'Cargando…';

  // ── 5. HTML de la página de redirección ─────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${displayTitle}</title>

  <!-- ═══ FAVICONS (compatibles con Google Search) ═══ -->
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192x192.png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">

  <!-- ═══ Open Graph ═══ -->
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
      overflow: hidden;
    }
    /* Overlay oscuro para destacar el spinner */
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      z-index: 1;
    }
    /* Spinner pequeño violeta, sin texto */
    .spinner {
      position: relative;
      z-index: 2;
      width: 28px;
      height: 28px;
      border: 3px solid rgba(139, 92, 246, 0.25); /* violeta tenue */
      border-top-color: #8b5cf6;                  /* violeta intenso */
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Respeta a usuarios con sensibilidad al movimiento */
    @media (prefers-reduced-motion: reduce) {
      .spinner { animation-duration: 1.8s; }
    }
  </style>

  <script>
    // Redirigir tras el delay (ajusta los ms si quieres)
    setTimeout(function () {
      window.location.replace(${JSON.stringify(destination.toString())});
    }, 1200);
  </script>
</head>
<body>
  <div class="spinner" role="status" aria-label="Cargando"></div>
</body>
</html>`;

  // ── 6. Devolver respuesta (sin noindex para permitir favicon a Google) ─
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      // ❌ Sin 'X-Robots-Tag': noindex
    },
  });
}