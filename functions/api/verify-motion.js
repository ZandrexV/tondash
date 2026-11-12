// functions/api/verify-motion.js
// Valida el CAPTCHA de movimiento y emite el JWT final.

import jwt from '@tsndr/cloudflare-worker-jwt';

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const {
    nonce, issuedAt, sig,
    events, distance, timeSpan, dirChanges, speedVariance,
    type, id, season, episode,
  } = body;

  if (!nonce || !issuedAt || !sig) {
    return Response.json({ error: 'Missing challenge' }, { status: 400 });
  }

  // ── 1. Verificar firma HMAC del desafío ────────────────────────────
  const expectedSig = await hmacSign(`challenge:${nonce}:${issuedAt}`, context.env.JWT_SECRET);
  if (expectedSig !== sig) {
    return Response.json({ error: 'Invalid challenge signature' }, { status: 403 });
  }

  // ── 2. Verificar frescura del desafío (2 minutos) ───────────────────
  const age = Date.now() - Number(issuedAt);
  if (age < -5000 || age > 120000) {
    return Response.json({ error: 'Challenge expired' }, { status: 403 });
  }

  // ── 3. Validar métricas de comportamiento humano ────────────────────
  const checks = [
    [events >= 30, 'Too few pointer events'],
    [distance >= 200, 'Too little movement'],
    [timeSpan >= 700, 'Movement too fast (bot-like)'],
    [timeSpan <= 60000, 'Movement too slow'],
    [dirChanges >= 2, 'Insufficient direction changes'],
    [speedVariance >= 0.0001, 'Speed too uniform (bot-like)'],
  ];
  for (const [ok, err] of checks) {
    if (!ok) return Response.json({ error: err }, { status: 403 });
  }

  // ── 4. Generar JWT de sesión ────────────────────────────────────────
  const now = Math.floor(Date.now() / 1000);
  const tokenPayload = {
    sub: 'human-verified',
    iat: now,
    exp: now + 300, // 5 minutos
    type, id,
    season: season || null,
    episode: episode || null,
  };

  let signedToken;
  try {
    signedToken = await jwt.sign(tokenPayload, context.env.JWT_SECRET);
  } catch (e) {
    console.error('JWT sign error:', e);
    return Response.json({ error: 'Token generation failed' }, { status: 500 });
  }

  // ── 5. Construir URL de destino con el JWT ──────────────────────────
  const targetPath = type === 'movie'
    ? `/play/movie/${id}`
    : `/play/tv/${id}/${season}/${episode}`;
  const destination = new URL(`https://player.tonplayer.space${targetPath}`);
  destination.searchParams.set('auth', signedToken);

  return Response.json({ redirect: destination.toString() });
}

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