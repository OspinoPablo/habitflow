# HabitFlow 🔥

Rutina diaria con rachas, hecha como app web instalable (PWA) para iPhone.
Fase 1: funciona 100 % en tu teléfono, sin servidor y sin costo.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Estructura de la app e íconos |
| `styles.css` | Diseño (modo oscuro) |
| `app.js` | Toda la lógica: rutina, rachas, calendario, perfil, respaldos |
| `sync.js` | Cuenta y sincronización con Supabase |
| `config.js` | URL y clave publishable de tu proyecto de Supabase |
| `vendor/supabase.js` | Librería oficial de Supabase (v2.117.3, licencia MIT) |
| `supabase/01_esquema.sql` | Tablas y reglas de seguridad de la base de datos |
| `supabase/02_avisos.sql` | Reloj de avisos cada minuto y limpieza diaria |
| `supabase/functions/enviar-avisos/index.ts` | Función que decide y envía las notificaciones |
| `herramientas/generar-llaves.html` | Genera las llaves de notificaciones (se abre con doble clic) |
| `sw.js` | Hace que funcione sin internet (y en la Fase 2, recibirá notificaciones) |
| `manifest.webmanifest` | Nombre, colores e íconos de la app instalada |
| `icons/` | Íconos para la pantalla de inicio |

## Publicarla gratis con GitHub Pages

1. Crea una cuenta en https://github.com
2. Crea un repositorio nuevo **público** llamado `habitflow`.
3. Entra a *Add file → Upload files* y arrastra **el contenido** de esta carpeta (no la carpeta en sí). Confirma con *Commit changes*.
4. Ve a *Settings → Pages*, en *Branch* elige `main` y `/ (root)`, y guarda.
5. En 1–2 minutos tu app estará en `https://TU-USUARIO.github.io/habitflow/`

## Instalarla en el iPhone

1. Abre esa dirección en **Safari** (tiene que ser Safari).
2. Toca **Compartir** y luego **Agregar a inicio**.
3. Ábrela siempre desde el ícono: así se ve como app, a pantalla completa y sin barra de Safari.

> Ojo: los datos de la app instalada y los de Safari son independientes. Úsala siempre desde el ícono.

## Probarla en tu PC con Windows

Con Python: abre una terminal en esta carpeta y ejecuta `python -m http.server 8000`, luego entra a http://localhost:8000
O en VS Code, instala la extensión **Live Server** y haz clic en *Go Live*.

## Publicar cambios

1. Edita los archivos y, en `sw.js`, sube el número de `VERSION` (por ejemplo `habitflow-v1.0.2`).
2. Súbelos a GitHub con *Add file → Upload files* (reemplazan a los anteriores) y confirma con *Commit changes*.
3. Espera la palomita verde en la pestaña *Actions* (1–2 minutos).
4. Abre la app en el iPhone: detecta la versión nueva y se recarga sola. Revisa el número en Perfil.

Actualizar nunca borra tus hábitos ni tu racha.

## Sincronización (Fase 2)

1. En Supabase, ejecuta `supabase/01_esquema.sql` en el SQL Editor.
2. En `config.js` pega la Project URL y la clave **publishable** (`sb_publishable_…`). Nunca la secreta.
3. En la app: Perfil → Cuenta y sincronización → Crear cuenta.
4. En otro teléfono: en la bienvenida toca «¿Ya tienes cuenta? Inicia sesión».

La app funciona sin internet y sube los cambios cuando vuelve la conexión. Si un dato cambió en dos lugares, gana el más reciente.

## Notificaciones (Fase 2, etapa 3)

Requieren iOS 16.4 o superior y abrir la app desde el ícono de inicio.

- Revisar la configuración: abre `https://TU-PROYECTO.supabase.co/functions/v1/enviar-avisos` en el navegador. Debe decir `"estado": "listo"`.
- Revisar el reloj (SQL Editor):
  `select status_code, content from net._http_response order by created desc limit 5;`
  200 = bien · 401 = desactiva «Verify JWT» en la función · 404 = la función no se llama `enviar-avisos`.
- Las llaves privadas y el CRON_SECRET viven solo en Supabase → Edge Functions → Secrets. Nunca en GitHub.

## Nota para trabajar con Claude

Cuando pidas cambios, recuérdale: «Incluye siempre `sw.js` con la versión incrementada y no me reemplaces `config.js`».
