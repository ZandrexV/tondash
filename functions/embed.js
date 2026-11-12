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

  return new Response(renderEmbed(safeSrc), {
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

function renderEmbed(src) {
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
</body>
</html>`;
}