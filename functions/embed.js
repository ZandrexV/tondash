// functions/embed.js
// Wrapper para servir el player dentro de un iframe propio.
// Necesario para que el fullscreen funcione en la cadena de iframes.

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const src = url.searchParams.get('src');
  if (!src) return new Response('Missing src', { status: 400 });

  let parsed;
  try {
    parsed = new URL(src);
  } catch {
    return new Response('Bad src', { status: 400 });
  }

  const playerOrigin = new URL(env.PLAYER_URL).origin;
  if (parsed.origin !== playerOrigin) {
    return new Response('Forbidden origin', { status: 403 });
  }

  // Re-serializar para normalizar y evitar inyección en el atributo
  const safeSrc = escapeAttr(parsed.toString());

  // Ruta de vuelta al redirector (solo rutas internas /play/...)
  let ret = url.searchParams.get('ret') || '';
  if (!/^\/play\/[A-Za-z0-9\/]*$/.test(ret) || ret.startsWith('//')) ret = '';

  // Segundos hasta que caduque la cookie (se lee del propio valor, solo para el temporizador)
  let remaining = 3600;
  const m = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)captcha_pass=v1:(\d+):/);
  if (m) {
    const left = parseInt(m[1], 10) - Math.floor(Date.now() / 1000);
    if (Number.isFinite(left)) remaining = Math.min(3600, Math.max(5, left));
  }

  return new Response(renderEmbed(safeSrc, ret, remaining), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function renderEmbed(src, ret, remaining) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reproductor</title>
<style>
  html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden}
  iframe{display:block;width:100%;height:100%;border:0}
</style>
</head>
<body>
<iframe src="${src}"
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write; web-share"
        allowfullscreen
        referrerpolicy="origin"></iframe>
${ret ? `<script>
  // Al caducar la cookie (1h) vuelve al redirector: captcha + anuncio
  setTimeout(function () { location.replace(${JSON.stringify(ret)}); }, ${remaining} * 1000);
</script>` : ''}
</body>
</html>`;
}