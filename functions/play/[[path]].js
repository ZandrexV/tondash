// functions/play/[[path]].js
// Redirector con spinner violeta + CAPTCHA de movimiento de ratón/touch.

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

  // ── Generar desafío HMAC ────────────────────────────────────────────
  const jwtSecret = context.env.JWT_SECRET;
  const nonce = crypto.randomUUID();
  const issuedAt = Date.now();
  const challengeStr = `challenge:${nonce}:${issuedAt}`;
  const challengeSig = await hmacSign(challengeStr, jwtSecret);

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${displayTitle}</title>
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192x192.png">
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
      overflow: hidden;
      user-select: none;
      -webkit-user-select: none;
      touch-action: none;
    }
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      z-index: 1;
    }
    .center {
      position: relative;
      z-index: 2;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }
    .spinner {
      width: 28px;
      height: 28px;
      border: 3px solid rgba(139, 92, 246, 0.25);
      border-top-color: #8b5cf6;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .progress-bar {
      width: 120px;
      height: 3px;
      background: rgba(139, 92, 246, 0.15);
      border-radius: 2px;
      overflow: hidden;
      opacity: 0;
      transition: opacity 0.25s ease;
    }
    .progress-bar.visible { opacity: 1; }
    .progress-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #8b5cf6, #a78bfa);
      border-radius: 2px;
      transition: width 0.05s linear;
    }
    @media (prefers-reduced-motion: reduce) {
      .spinner { animation-duration: 1.8s; }
    }
  </style>
</head>
<body>
  <div class="center">
    <div class="spinner" role="status" aria-label="Cargando"></div>
    <div class="progress-bar" id="progressBar" aria-hidden="true">
      <div class="progress-fill" id="progressFill"></div>
    </div>
  </div>

  <script>
    window.__CAPTCHA = {
      nonce: ${JSON.stringify(nonce)},
      issuedAt: ${JSON.stringify(issuedAt)},
      sig: ${JSON.stringify(challengeSig)},
      meta: ${JSON.stringify({ type, id, season: season || null, episode: episode || null })}
    };
  </script>

  <script>
    (function() {
      const DIST_THRESHOLD = 280;   // píxeles para llenar la barra
      const MIN_EVENTS = 40;         // eventos mínimos para completar
      const fill = document.getElementById('progressFill');
      const bar = document.getElementById('progressBar');
      const meta = window.__CAPTCHA;

      const state = {
        events: 0,
        distance: 0,
        dirChanges: 0,
        speeds: [],
        firstTime: 0,
        lastTime: 0,
        lastTimeAtMove: 0,
        lastX: null,
        lastY: null,
        lastDx: 0,
        lastDy: 0,
        done: false,
      };

      function track(x, y) {
        if (state.done) return;
        const now = performance.now();
        state.events++;
        if (!state.firstTime) state.firstTime = now;
        state.lastTime = now;

        if (state.lastX !== null) {
          const dx = x - state.lastX;
          const dy = y - state.lastY;
          const dist = Math.hypot(dx, dy);
          if (dist > 0.3) {
            state.distance += dist;
            const dt = Math.max(now - state.lastTimeAtMove, 8);
            state.speeds.push(dist / dt);
            if (Math.abs(dx) > 3 && state.lastDx !== 0 && Math.sign(dx) !== Math.sign(state.lastDx)) {
              state.dirChanges++;
            }
            if (Math.abs(dy) > 3 && state.lastDy !== 0 && Math.sign(dy) !== Math.sign(state.lastDy)) {
              state.dirChanges++;
            }
            if (Math.abs(dx) > 0.5) state.lastDx = dx;
            if (Math.abs(dy) > 0.5) state.lastDy = dy;
          }
          state.lastTimeAtMove = now;
        }

        state.lastX = x;
        state.lastY = y;

        const progress = Math.min(state.distance / DIST_THRESHOLD, 1);
        fill.style.width = (progress * 100).toFixed(1) + '%';
        bar.classList.add('visible');

        if (progress >= 1 && state.events >= MIN_EVENTS) {
          complete();
        }
      }

      function complete() {
        if (state.done) return;
        state.done = true;
        fill.style.width = '100%';

        // Varianza de velocidad (detecta bots uniformes)
        let variance = 0;
        if (state.speeds.length > 1) {
          const mean = state.speeds.reduce((a, b) => a + b, 0) / state.speeds.length;
          variance = state.speeds.reduce((a, b) => a + (b - mean) ** 2, 0) / state.speeds.length;
        }

        const payload = {
          nonce: meta.nonce,
          issuedAt: meta.issuedAt,
          sig: meta.sig,
          events: state.events,
          distance: Math.round(state.distance),
          timeSpan: Math.round(state.lastTime - state.firstTime),
          dirChanges: state.dirChanges,
          speedVariance: variance,
          speedsSample: state.speeds.slice(-20).map(s => Math.round(s * 1000) / 1000),
          ...meta.meta,
        };

        fetch('/api/verify-motion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        .then(async res => {
          const data = await res.json().catch(() => ({}));
          if (data.redirect) {
            window.location.replace(data.redirect);
          } else {
            console.error('Verificación fallida:', res.status, data);
            reset();
          }
        })
        .catch(err => {
          console.error('Error en verify:', err);
          reset();
        });
      }

      function reset() {
        state.events = 0;
        state.distance = 0;
        state.dirChanges = 0;
        state.speeds = [];
        state.firstTime = 0;
        state.lastTime = 0;
        state.lastTimeAtMove = 0;
        state.lastX = null;
        state.lastY = null;
        state.lastDx = 0;
        state.lastDy = 0;
        state.done = false;
        fill.style.width = '0%';
        bar.classList.remove('visible');
      }

      function handler(e) { track(e.clientX, e.clientY); }

      if ('onpointermove' in window) {
        document.addEventListener('pointermove', handler, { passive: true });
      } else {
        document.addEventListener('mousemove', handler, { passive: true });
        document.addEventListener('touchmove', function(e) {
          if (e.touches.length > 0) {
            const t = e.touches[0];
            track(t.clientX, t.clientY);
          }
        }, { passive: true });
      }
    })();
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

// ── Utilidad HMAC-SHA256 (WebCrypto) ──────────────────────────────────
async function hmacSign(data, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const bytes = new Uint8Array(sig);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}