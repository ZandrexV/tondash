/**
 * config.js — Configuración de StreamAdmin
 * -----------------------------------------------------------------------
 * Edita este archivo con tus propias credenciales antes de desplegar.
 * No mezclar con index.html: así puedes hacer .gitignore de este archivo
 * si subes el proyecto a un repositorio público, y actualizar credenciales
 * sin tocar el código de la aplicación.
 *
 * IMPORTANTE: este archivo se descarga y ejecuta en el navegador del
 * usuario, igual que cualquier otro script del sitio. Sirve para mantener
 * el código organizado, pero NO oculta estos valores de alguien que
 * inspeccione el sitio (DevTools → pestaña Network/Sources). La protección
 * real de tus datos viene de Row Level Security (RLS) en Supabase, no de
 * dónde vive este archivo.
 * -----------------------------------------------------------------------
 */
window.STREAM_CONFIG = {

  // ---- TMDB ----
  TMDB_API_KEY: "0f7eed19a94a6e48e44b703f8bea6368",

  // ---- Supabase: proyecto de contenido (películas/series/enlaces) ----
  SUPABASE_URL: "https://gvhdetdmrspltcpkifzo.supabase.co",
  SUPABASE_KEY: "sb_publishable_WxDRaDsNApxVCES9NL48dg_L6X9aJv0",
  TABLA_ENLACES: "enlaces",

  // ---- Supabase: proyecto separado, usado solo para autenticación (login/logout) ----
  AUTH_SUPABASE_URL: "https://szhmqobdqatunuqbibpa.supabase.co",
  AUTH_SUPABASE_KEY: "sb_publishable_MroA7EQkDVZRnHNCDN-CmA_x4Q0a0HA",

  // ---- Personalización de marca ----
  // Deja BRAND_LOGO_URL vacío ("") para usar el ícono de reproducción por defecto.
  BRAND_LOGO_URL: "https://i.ibb.co/HJksbsd/20260712-180104.png",
  BRAND_NAME: "StreamAdmin",

};
