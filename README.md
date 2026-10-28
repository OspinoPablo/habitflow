# HabitFlow 🔥

Rutina diaria con rachas, hecha como app web instalable (PWA) para iPhone.
Fase 1: funciona 100 % en tu teléfono, sin servidor y sin costo.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Estructura de la app e íconos |
| `styles.css` | Diseño (modo oscuro) |
| `app.js` | Toda la lógica: rutina, rachas, calendario, perfil, respaldos |
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

1. Edita los archivos y súbelos de nuevo a GitHub (reemplazando los anteriores).
2. En `sw.js` cambia `VERSION` (por ejemplo `habitflow-v1.0.1`).
3. En el iPhone, cierra y abre la app un par de veces para que tome la versión nueva.

## Próximos pasos (Fase 2)

- Sincronización en la nube con **Supabase** (plan gratuito).
- Notificaciones push reales con tu nombre a la hora de cada hábito (requiere iOS 16.4 o superior y la app instalada en inicio).
