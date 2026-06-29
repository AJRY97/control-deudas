# Control de deudas Alan/Mairon

App Vite + React + TypeScript para administrar deudas, cuotas, pagos mensuales y proyecciones de Alan y Mairon.

La version web usa Supabase desde el frontend con la anon public key. No usa contrasenas ni service role key en el navegador.

## Supabase

1. En Supabase abre tu proyecto.
2. Ve a `SQL Editor`.
3. Copia y ejecuta el contenido de [`supabase/schema.sql`](supabase/schema.sql).
4. Ve a `Project Settings` -> `API`.
5. Copia estos valores:
   - `Project URL`
   - `anon public`

## Variables de entorno

Localmente crea `frontend/.env`:

```env
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-public-key
```

En Vercel agrega las mismas variables en `Project Settings` -> `Environment Variables`:

- `VITE_SUPABASE_URL`: pega el `Project URL` de Supabase.
- `VITE_SUPABASE_ANON_KEY`: pega la `anon public key` de Supabase.

No pegues la contrasena de Supabase en Vercel ni en el frontend.
No uses la `service_role key` en el frontend.

## Ejecutar local

```powershell
pnpm install
pnpm build
pnpm dev
```

La app local abre el frontend Vite. Los datos se guardan en Supabase.

## Deploy en Vercel

El repo incluye `vercel.json` para construir `frontend/` y publicar `frontend/dist`.

Si GitHub ya esta conectado a Vercel, al hacer push a `main` Vercel deberia desplegar automaticamente.

## Datos

La tabla principal es `debts`.

Tambien se crea `monthly_payments` para guardar la confirmacion de pago mensual por persona.

Campos principales de `debts`:

- `title`
- `category`
- `total_amount`
- `monthly_installment`
- `installments_total`
- `start_month`
- `alan_monthly`
- `mairon_monthly`
- `payer_mode`
- `source`
- `notes`
- `is_paid`
- `paid_at`

## Seguridad

Este setup usa la anon public key porque la app escribe desde el navegador. Las politicas RLS del SQL permiten CRUD a `anon` para una app personal sin login.

Si despues quieres que solo tu puedas entrar, el siguiente paso es agregar Supabase Auth y cambiar las politicas RLS por usuario autenticado.
