// functions/api/verify-turnstile.js
// Verifica el token de Turnstile y genera un JWT de sesión.

import jwt from '@tsndr/cloudflare-worker-jwt'; // Añadir dependencia

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { turnstileToken, type, id, season, episode } = body;

  if (!turnstileToken) {
    return Response.json({ error: 'Missing Turnstile token' }, { status: 400 });
  }

  const secret = context.env.TURNSTILE_SECRET_KEY;
  const remoteip = context.request.headers.get('CF-Connecting-IP');

  // ── 1. Verificar token con Cloudflare ──────────────────────────────
  const formData = new URLSearchParams();
  formData.append('secret', secret);
  formData.append('response', turnstileToken);
  if (remoteip) formData.append('remoteip', remoteip);

  let verification;
  try {
    const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
    });
    verification = await verifyRes.json();
  } catch (e) {
    console.error('Turnstile siteverify error:', e);
    return Response.json({ error: 'Verification service unavailable' }, { status: 502 });
  }

  if (!verification.success) {
    return Response.json({ error: 'Human verification failed', details: verification }, { status: 403 });
  }

  // ── 2. Generar JWT de sesión ──────────────────────────────────────
  const jwtSecret = context.env.JWT_SECRET;
  if (!jwtSecret) {
    console.error('JWT_SECRET not configured');
    return Response.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const now = Math.floor(Date.now() / 1000);
  const tokenPayload = {
    sub: 'human-verified',
    iat: now,
    exp: now + 300, // Válido por 5 minutos (suficiente para la redirección)
    type,
    id,
    season: season || null,
    episode: episode || null,
  };

  let signedToken;
  try {
    signedToken = await jwt.sign(tokenPayload, jwtSecret);
  } catch (e) {
    console.error('JWT sign error:', e);
    return Response.json({ error: 'Token generation failed' }, { status: 500 });
  }

  // ── 3. Construir URL de destino con el JWT ───────────────────────
  const targetPath = type === 'movie'
    ? `/play/movie/${id}`
    : `/play/tv/${id}/${season}/${episode}`;

  const destination = new URL(`https://player.tonplayer.space${targetPath}`);
  destination.searchParams.set('auth', signedToken);

  return Response.json({ redirect: destination.toString() });
}
