# Guía de despliegue — StreamAdmin en Cloudflare Pages

Esta carpeta contiene todo lo necesario para publicar el panel en Cloudflare Pages.

## Archivos incluidos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Tu panel de administración (antes `admin.html`) |
| `config.js` | Tus credenciales (Supabase, TMDB) y personalización de marca. **Edítalo antes de desplegar.** |
| `_headers` | Cabeceras de seguridad HTTP (CSP, anti-clickjacking, HSTS, etc.) |
| `_redirects` | Evita errores 404 en rutas no encontradas |
| `robots.txt` | Evita que Google/Bing indexen el panel |

**Importante:** `config.js` debe subirse junto a `index.html` en la misma carpeta — el panel no funcionará si falta (mostrará un aviso claro en pantalla indicándolo). Si subes el proyecto a un repositorio Git público, considera agregar `config.js` a tu `.gitignore` y subirlo por separado, ya que contiene tus API keys.

No necesitas modificar `_headers`, `_redirects` ni `robots.txt` — ya están configurados con los dominios exactos que usa tu panel (Supabase, TMDB, Tailwind, FontAwesome, Google Fonts).

---

## Opción A: Despliegue con Git (recomendado)

1. Sube esta carpeta a un repositorio de GitHub o GitLab (puede ser privado).
2. Entra a [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → pestaña **Pages** → **Connect to Git**.
3. Selecciona tu repositorio.
4. En **Build settings**:
   - **Framework preset**: `None`
   - **Build command**: (déjalo vacío)
   - **Build output directory**: `/` (o el nombre de esta carpeta si el repo tiene más contenido)
5. Click **Save and Deploy**.
6. En unos segundos tendrás una URL tipo `https://tu-proyecto.pages.dev`.

Con esta opción, cada vez que subas un cambio al repositorio, Cloudflare vuelve a desplegar automáticamente.

## Opción B: Subida directa (sin Git)

1. Entra a [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → pestaña **Pages** → **Upload assets**.
2. Arrastra **todos los archivos de esta carpeta** (no la carpeta en sí, sino su contenido: `index.html`, `_headers`, `_redirects`, `robots.txt`).
3. Ponle un nombre al proyecto y click **Deploy site**.
4. Cada vez que quieras actualizar, repite el proceso subiendo los archivos de nuevo desde el dashboard del proyecto.

---

## Dominio propio (opcional)

Si tienes un dominio ya en Cloudflare:
1. En tu proyecto de Pages → **Custom domains** → **Set up a custom domain**.
2. Escribe tu dominio o subdominio (ej. `admin.tudominio.com`).
3. Cloudflare configura el DNS y el certificado HTTPS automáticamente.

---

## Verificación post-despliegue

Después de desplegar, revisa que todo funcione:
- [ ] La pantalla de login carga correctamente
- [ ] Puedes iniciar sesión con tu usuario de Supabase Auth
- [ ] El buscador de TMDB devuelve resultados
- [ ] Puedes guardar una película/serie de prueba
- [ ] Los íconos de FontAwesome se ven (si no aparecen, revisa la consola del navegador por errores de CSP)

## Sobre las API keys visibles en el código

Este panel es 100% frontend (sin servidor propio), así que las keys de Supabase y TMDB seguirán siendo visibles en el código fuente sin importar dónde lo hostees — esto es así con cualquier hosting estático (Cloudflare, Vercel, Netlify, etc.), no es una limitación de Cloudflare.

Lo que sí puedes controlar:
- Usa siempre la key **`anon`/`publishable`** de Supabase, nunca la `service_role`.
- Activa **Row Level Security (RLS)** en tus tablas de Supabase para que, aunque alguien tenga la key, solo pueda hacer lo que tus políticas permitan.
- El archivo `robots.txt` evita que buscadores indexen el panel, pero no es una protección real — solo reduce exposición pasiva.

## Personalizar logo y nombre

Puedes cambiar el logo (por URL de imagen) y el nombre del panel de dos formas:
- **Por defecto para todos los que abran el panel**: edita `BRAND_LOGO_URL` y `BRAND_NAME` en `config.js`.
- **Solo para ti, sin tocar código**: entra al panel → Ajustes → Perfil → "Marca del panel". Esta opción se guarda en tu navegador y no afecta a otros usuarios ni requiere volver a desplegar.
