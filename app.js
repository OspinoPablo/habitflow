/* ==========================================================
   HabitFlow — Fase 1 (100 % local, sin servidor)
   - Todo el estado vive en localStorage bajo una sola clave.
   - La capa "Store" está aislada a propósito: en la Fase 2
     la conectaremos a Supabase para sincronizar en la nube.
   ========================================================== */
'use strict';

/* ---------- Atajos de DOM ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------- Fechas (siempre en hora local, claves AAAA-MM-DD) ---------- */
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = () => keyOf(new Date());
const addDays = (date, n) => { const d = new Date(date); d.setDate(d.getDate() + n); return d; };
const LOCALE = /^es\b/i.test(navigator.language || '') ? navigator.language : 'es';
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const fmt = (d, opts) => new Intl.DateTimeFormat(LOCALE, opts).format(d);
const fmtLongDate = d => cap(fmt(d, { weekday: 'long', day: 'numeric', month: 'long' }));
const fmtMonth = (y, m) => cap(fmt(new Date(y, m, 1), { month: 'long', year: 'numeric' }));
function fmtTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return fmt(new Date(2000, 0, 1, h, m), { hour: 'numeric', minute: '2-digit' });
}

/* La semana empieza en lunes. "d" es el número de día de JavaScript (0 = domingo). */
const WEEK = [
  { d: 1, s: 'L', a: 'lun', l: 'Lunes' },
  { d: 2, s: 'M', a: 'mar', l: 'Martes' },
  { d: 3, s: 'X', a: 'mié', l: 'Miércoles' },
  { d: 4, s: 'J', a: 'jue', l: 'Jueves' },
  { d: 5, s: 'V', a: 'vie', l: 'Viernes' },
  { d: 6, s: 'S', a: 'sáb', l: 'Sábado' },
  { d: 0, s: 'D', a: 'dom', l: 'Domingo' },
];
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [6, 0];
const PRESETS = { all: ALL_DAYS, weekdays: WEEKDAYS, weekend: WEEKEND };

const EMOJIS = ['💧', '🏃', '💪', '🧘', '📖', '✍️', '🛏️', '🍎', '🥗', '💊', '🦷', '🚶', '🧠', '🎯', '💻', '🎧', '🎸', '🎨', '🧹', '🌱', '☀️', '🌙', '📵', '🙏'];
const COLORS = ['#FF7A45', '#FFC24B', '#FF5C8A', '#A08CFF', '#5AA9FF', '#3DDBD9', '#4ADE80', '#E879F9'];

const STARTERS = [
  { emoji: '🛏️', title: 'Tender la cama', color: '#A08CFF', time: '07:00' },
  { emoji: '💧', title: 'Tomar 2 litros de agua', color: '#5AA9FF', time: '' },
  { emoji: '🏃', title: 'Hacer ejercicio', color: '#FF7A45', time: '07:30' },
  { emoji: '📖', title: 'Leer 20 minutos', color: '#FFC24B', time: '21:00' },
  { emoji: '🧘', title: 'Meditar 10 minutos', color: '#3DDBD9', time: '' },
  { emoji: '📵', title: 'Nada de celular antes de dormir', color: '#FF5C8A', time: '22:30' },
];

/* ---------- Utilidades ---------- */
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const flameSvg = (cls = '') => `<svg class="flame ${cls}" aria-hidden="true"><use href="#i-flame"/></svg>`;
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
const isDateKey = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

function daysSummary(days) {
  if (sameSet(days, ALL_DAYS)) return 'Todos los días';
  if (sameSet(days, WEEKDAYS)) return 'Lunes a viernes';
  if (sameSet(days, WEEKEND)) return 'Fines de semana';
  const names = WEEK.filter(w => days.includes(w.d)).map(w => w.a);
  return cap(names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}` : names[0] || '');
}

/* ==========================================================
   Almacenamiento
   ========================================================== */
const STORAGE_KEY = 'habitflow:v1';

const Store = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  save(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch (err) { console.warn('No se pudo guardar', err); }
  },
  clear() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* sin acceso */ }
  },
};

function freshState() {
  return {
    version: 1,
    user: { name: '' },
    tasks: [],   // { id, title, emoji, color, time, days, createdAt, deletedAt, order }
    history: {}, // 'AAAA-MM-DD': { scheduled: [ids], done: [ids] }
    meta: { startDate: todayKey(), onboarded: false, installHintDismissed: false, updatedAt: Date.now() },
  };
}

function cleanTask(t) {
  const days = Array.isArray(t.days) ? [...new Set(t.days.map(Number).filter(n => n >= 0 && n <= 6))] : [...ALL_DAYS];
  return {
    id: String(t.id || uid()),
    title: String(t.title || 'Hábito').slice(0, 60),
    emoji: Array.from(String(t.emoji || '✨')).slice(0, 4).join(''),
    color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : COLORS[0],
    time: /^\d{2}:\d{2}$/.test(t.time) ? t.time : '',
    days: days.length ? days : [...ALL_DAYS],
    createdAt: isDateKey(t.createdAt) ? t.createdAt : todayKey(),
    deletedAt: isDateKey(t.deletedAt) ? t.deletedAt : null,
    order: Number(t.order) || Date.now(),
  };
}

function normalize(data) {
  const base = freshState();
  if (!data || typeof data !== 'object') return base;
  const history = {};
  if (data.history && typeof data.history === 'object') {
    for (const [k, rec] of Object.entries(data.history)) {
      if (!isDateKey(k) || !rec) continue;
      history[k] = {
        scheduled: Array.isArray(rec.scheduled) ? rec.scheduled.map(String) : [],
        done: Array.isArray(rec.done) ? rec.done.map(String) : [],
      };
    }
  }
  return {
    version: 1,
    user: { name: String(data.user?.name || '').slice(0, 24) },
    tasks: Array.isArray(data.tasks) ? data.tasks.map(cleanTask) : [],
    history,
    meta: {
      ...base.meta,
      ...(data.meta || {}),
      startDate: isDateKey(data.meta?.startDate) ? data.meta.startDate : base.meta.startDate,
    },
  };
}

let state = normalize(Store.load());

function commit() {
  state.meta.updatedAt = Date.now();
  Store.save(state);
}

/* ==========================================================
   Reglas de la rutina y la racha
   ========================================================== */
const activeTasks = () => state.tasks.filter(t => !t.deletedAt);
const taskById = id => state.tasks.find(t => t.id === id);
const byTime = (a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || a.order - b.order;

// Un hábito cuenta para un día si ese día de la semana está activo,
// ya existía y no se había eliminado todavía.
function isScheduledOn(task, key, weekday) {
  return task.days.includes(weekday) && task.createdAt <= key && (!task.deletedAt || task.deletedAt > key);
}
function scheduledIdsFor(key) {
  const wd = dateOf(key).getDay();
  return state.tasks.filter(t => isScheduledOn(t, key, wd)).map(t => t.id);
}

// Guarda una "foto" de los hábitos de hoy. Así, si cambias tu rutina
// mañana, los días pasados conservan lo que realmente tenían.
function syncToday() {
  const key = todayKey();
  const rec = state.history[key] || { scheduled: [], done: [] };
  rec.scheduled = scheduledIdsFor(key);
  state.history[key] = rec;
}

/* Estados posibles de un día:
   complete  → todo hecho (suma a la racha 🔥)
   partial   → día pasado con algo hecho (rompe la racha)
   missed    → día pasado sin nada hecho (rompe la racha)
   rest      → no había hábitos ese día (ni suma ni rompe)
   pending / progress → hoy, todavía en curso (no rompe)
   future / before    → fuera de rango */
function dayInfo(key, tKey = todayKey()) {
  if (key > tKey) return { status: 'future', scheduled: [], done: [], ratio: 0 };
  if (key < state.meta.startDate) return { status: 'before', scheduled: [], done: [], ratio: 0 };
  const rec = state.history[key];
  const scheduled = key === tKey || !rec ? scheduledIdsFor(key) : rec.scheduled;
  if (!scheduled.length) return { status: 'rest', scheduled, done: [], ratio: 0 };
  const done = (rec?.done || []).filter(id => scheduled.includes(id));
  const ratio = done.length / scheduled.length;
  let status;
  if (ratio >= 1) status = 'complete';
  else if (key === tKey) status = done.length ? 'progress' : 'pending';
  else status = done.length ? 'partial' : 'missed';
  return { status, scheduled, done, ratio };
}

function computeStreaks() {
  const tKey = todayKey();
  let run = 0, best = 0;
  const end = dateOf(tKey);
  for (let d = dateOf(state.meta.startDate); d <= end; d = addDays(d, 1)) {
    const s = dayInfo(keyOf(d), tKey).status;
    if (s === 'complete') { run++; best = Math.max(best, run); }
    else if (s === 'partial' || s === 'missed') run = 0;
  }
  return { current: run, best };
}

/* ==========================================================
   Vista: Hoy
   ========================================================== */
const RING_C = 2 * Math.PI * 52;
let lastRing = 0;
let lastToggled = null;

function greeting(h) {
  if (h < 6) return 'Buenas noches';
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function heroMessage({ status, doneN, remaining, streak, name, hasTasks }) {
  const n = name ? `, ${name}` : '';
  if (!hasTasks) return `Crea tu primer hábito para encender tu racha${n}.`;
  if (status === 'rest') return `Hoy toca descansar${n}. Tu racha sigue a salvo.`;
  if (status === 'complete') return `¡Día completado${n}! Tu fuego sigue vivo. Mañana seguimos.`;
  const faltan = remaining === 1 ? '1 hábito' : `${remaining} hábitos`;
  if (doneN === 0) {
    return streak > 0
      ? `Que no se apague${n}: te ${remaining === 1 ? 'espera' : 'esperan'} ${faltan} hoy.`
      : `Empecemos${n}. Hoy tienes ${faltan}.`;
  }
  return remaining === 1 ? '¡Ya casi! Solo te falta 1 hábito.' : `¡Vas muy bien! Te faltan ${faltan}.`;
}

const isStandalone = () => window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// El fuego dentro del anillo crece y se enciende según tu progreso del día.
function paintRing(root, p) {
  const bar = $('.ring-bar', root);
  const flame = $('.ring-flame .flame', root);
  const hero = $('.hero', root);
  if (!bar || !flame) return;
  bar.style.strokeDashoffset = (RING_C * (1 - p)).toFixed(2);
  bar.style.opacity = p > 0 ? 1 : 0;
  flame.style.transform = `scale(${(0.55 + p * 0.45).toFixed(3)})`;
  flame.style.filter = `grayscale(${(1 - p).toFixed(2)}) brightness(${(0.6 + p * 0.4).toFixed(2)})`;
  flame.style.opacity = (0.55 + p * 0.45).toFixed(2);
  hero?.style.setProperty('--glow', (0.25 + p * 0.75).toFixed(2));
}

function taskButton(t, isDone) {
  return `
    <button class="task ${isDone ? 'done' : ''} ${t.id === lastToggled ? 'pop' : ''}" data-action="toggle" data-id="${esc(t.id)}" style="--c:${t.color}" aria-pressed="${isDone}">
      <span class="task-emoji">${esc(t.emoji)}</span>
      <span class="task-body">
        <span class="task-title">${esc(t.title)}</span>
        ${t.time ? `<span class="task-meta">${icon('clock', 'ic-sm')}${fmtTime(t.time)}</span>` : ''}
      </span>
      <span class="check">${icon('check')}</span>
    </button>`;
}

function renderToday() {
  const el = $('#view-today');
  const now = new Date();
  const key = keyOf(now);
  const info = dayInfo(key);
  const { current } = computeStreaks();
  const name = state.user.name;
  const hasTasks = activeTasks().length > 0;
  const tasks = info.scheduled.map(taskById).filter(Boolean).sort(byTime);
  const doneSet = new Set(info.done);
  const total = tasks.length;
  const doneN = tasks.filter(t => doneSet.has(t.id)).length;
  const remaining = total - doneN;
  const p = total ? doneN / total : 0;
  const complete = info.status === 'complete';

  const installHint = isIOS() && !isStandalone() && !state.meta.installHintDismissed ? `
    <div class="hint">
      ${icon('share')}
      <div class="hint-body"><strong>Instala HabitFlow</strong><span>Toca Compartir y luego «Agregar a inicio» para usarla como app.</span></div>
      <button class="hint-x" data-action="dismiss-install" aria-label="Cerrar aviso">${icon('x')}</button>
    </div>` : '';

  let list;
  if (total) {
    list = `
      <div class="section-head"><h2>Tu rutina de hoy</h2><span class="muted">${doneN} de ${total}</span></div>
      <div class="task-list">${tasks.map(t => taskButton(t, doneSet.has(t.id))).join('')}</div>`;
  } else if (!hasTasks) {
    list = `
      <div class="empty">
        <div class="empty-art">🌱</div>
        <h3>Aún no tienes hábitos</h3>
        <p>Crea el primero y elige qué días quieres hacerlo.</p>
        <button class="btn btn-primary" data-action="new-task">${icon('plus')}Crear hábito</button>
      </div>`;
  } else {
    list = `
      <div class="empty">
        <div class="empty-art">🌙</div>
        <h3>Hoy es día libre</h3>
        <p>No tienes hábitos programados para hoy. Tu racha no se rompe.</p>
        <button class="btn btn-ghost" data-action="tab" data-tab="routine">Ver mi rutina</button>
      </div>`;
  }

  el.innerHTML = `
    <header class="page-head">
      <p class="page-date">${fmtLongDate(now)}</p>
      <h1 class="title">${greeting(now.getHours())}${name ? `,<br>${esc(name)}` : ''}</h1>
    </header>
    ${installHint}
    <div class="hero ${complete ? 'is-complete' : ''}">
      <div class="ring" role="img" aria-label="${total ? `${doneN} de ${total} hábitos completados hoy` : 'Sin hábitos hoy'}">
        <svg viewBox="0 0 120 120">
          <circle class="ring-track" cx="60" cy="60" r="52"/>
          <circle class="ring-bar" cx="60" cy="60" r="52" stroke-dasharray="${RING_C.toFixed(2)}"/>
        </svg>
        <div class="ring-flame">${flameSvg()}</div>
      </div>
      <div class="hero-main">
        <div class="streak-num">${current}</div>
        <div class="streak-label">${current === 1 ? 'día seguido' : 'días seguidos'}</div>
        <p class="hero-msg">${esc(heroMessage({ status: info.status, doneN, remaining, streak: current, name, hasTasks }))}</p>
      </div>
    </div>
    ${list}`;

  // Pinta el anillo con el valor anterior y luego anima hacia el nuevo.
  paintRing(el, lastRing);
  el.getBoundingClientRect();
  requestAnimationFrame(() => paintRing(el, p));
  lastRing = p;
  lastToggled = null;
}

function toggleTask(id) {
  syncToday();
  const key = todayKey();
  const rec = state.history[key];
  const before = dayInfo(key).status;
  const i = rec.done.indexOf(id);
  if (i >= 0) rec.done.splice(i, 1);
  else rec.done.push(id);
  commit();
  lastToggled = id;
  const after = dayInfo(key).status;
  renderToday();
  renderCalendar();
  if (after === 'complete' && before !== 'complete') celebrate();
}

function celebrate() {
  const { current } = computeStreaks();
  toast(`¡Día completado! Racha de ${current} ${current === 1 ? 'día' : 'días'} 🔥`);
  const flame = $('#view-today .ring-flame .flame');
  if (flame) {
    flame.classList.add('burst');
    setTimeout(() => flame.classList.remove('burst'), 1000);
  }
  sparks();
}

// Chispas al completar el día (se omite si el iPhone tiene "Reducir movimiento").
function sparks() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  document.body.appendChild(canvas);
  const dpr = window.devicePixelRatio || 1;
  const w = innerWidth, h = innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const ring = $('#view-today .ring')?.getBoundingClientRect();
  const ox = ring ? ring.left + ring.width / 2 : w / 2;
  const oy = ring ? ring.top + ring.height / 2 : h / 3;
  const colors = ['#FF4A1C', '#FF7A2E', '#FF9A3C', '#FFC24B', '#FFD27A', '#FFE6B0'];
  const parts = Array.from({ length: 90 }, () => {
    const a = Math.random() * Math.PI * 2;
    const v = 3 + Math.random() * 9;
    return { x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 5, r: 1.5 + Math.random() * 3, c: colors[(Math.random() * colors.length) | 0] };
  });
  const start = performance.now();
  const DURATION = 1600;
  function frame(t) {
    const elapsed = t - start;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = Math.max(0, 1 - elapsed / DURATION);
    for (const p of parts) {
      p.vy += 0.28;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (elapsed < DURATION) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}

/* ==========================================================
   Vista: Rutina
   ========================================================== */
let routineDay = new Date().getDay(); // número de día o 'all'

function routineRow(t) {
  return `
    <button class="task rtask" data-action="edit-task" data-id="${esc(t.id)}" style="--c:${t.color}">
      <span class="task-emoji">${esc(t.emoji)}</span>
      <span class="task-body">
        <span class="task-title">${esc(t.title)}</span>
        <span class="task-meta">${t.time ? `${icon('clock', 'ic-sm')}${fmtTime(t.time)}, ` : ''}${daysSummary(t.days).toLowerCase()}</span>
      </span>
      ${icon('chevron-right', 'chev')}
    </button>`;
}

function renderRoutine() {
  const active = activeTasks();
  const todayWd = new Date().getDay();
  const list = active.filter(t => routineDay === 'all' || t.days.includes(routineDay)).sort(byTime);
  const dayName = routineDay === 'all' ? '' : WEEK.find(w => w.d === routineDay).l;

  $('#view-routine').innerHTML = `
    <header class="page-head">
      <h1 class="title">Tu rutina</h1>
      <p class="subtitle">Elige un día para ver y ajustar sus hábitos.</p>
    </header>
    <div class="daybar" role="tablist" aria-label="Día de la semana">
      <button class="dpill ${routineDay === 'all' ? 'sel' : ''}" data-action="routine-day" data-day="all" role="tab" aria-selected="${routineDay === 'all'}">
        <b>Todos</b><small>${active.length}</small>
      </button>
      ${WEEK.map(w => {
        const count = active.filter(t => t.days.includes(w.d)).length;
        const sel = routineDay === w.d;
        return `<button class="dpill ${sel ? 'sel' : ''} ${w.d === todayWd ? 'today' : ''}" data-action="routine-day" data-day="${w.d}" role="tab" aria-selected="${sel}" aria-label="${w.l}, ${count} hábitos">
          <b>${w.s}</b><small>${count}</small>
        </button>`;
      }).join('')}
    </div>

    <div class="section-head">
      <h2>${routineDay === 'all' ? 'Todos tus hábitos' : dayName}</h2>
      <span class="muted">${list.length} ${list.length === 1 ? 'hábito' : 'hábitos'}</span>
    </div>
    ${list.length
      ? `<div class="task-list">${list.map(routineRow).join('')}</div>`
      : `<div class="empty small"><p>${routineDay === 'all' ? 'Aún no has creado hábitos.' : `No tienes hábitos para el ${dayName.toLowerCase()}.`}</p></div>`}
    <button class="btn btn-primary btn-block add-btn" data-action="new-task">
      ${icon('plus')}Agregar hábito${routineDay === 'all' ? '' : ` al ${dayName.toLowerCase()}`}
    </button>
    <p class="footnote">Toca un hábito para editarlo. Los cambios aplican desde hoy y no modifican tu historial.</p>`;
}

/* ---------- Editor de hábitos (hoja inferior) ---------- */
let draft = null;

function openEditor(id) {
  const t = id ? taskById(id) : null;
  const presetDays = routineDay === 'all' || $('#view-today').classList.contains('active') ? [...ALL_DAYS] : [routineDay];
  draft = t
    ? { id: t.id, emoji: t.emoji, color: t.color, days: [...t.days] }
    : { id: null, emoji: EMOJIS[0], color: COLORS[4], days: presetDays };

  openSheet(`
    <div class="sheet-head">
      <span class="task-emoji xl" id="ed-preview" style="--c:${draft.color}">${esc(draft.emoji)}</span>
      <div>
        <p class="sheet-kicker">${t ? 'Editar hábito' : 'Nuevo hábito'}</p>
        <h2 class="sheet-title" id="ed-preview-title">${t ? esc(t.title) : 'Sin nombre'}</h2>
      </div>
      <button class="icon-btn" data-action="close-sheet" aria-label="Cerrar">${icon('x')}</button>
    </div>

    <label class="field">
      <span class="label">Nombre</span>
      <input class="input" id="ed-title" maxlength="40" placeholder="Ej. Tomar agua" value="${t ? esc(t.title) : ''}" autocomplete="off" enterkeyhint="done">
    </label>

    <div class="field">
      <span class="label">Ícono</span>
      <div class="emoji-grid">
        ${EMOJIS.map(e => `<button class="emoji-opt ${e === draft.emoji ? 'sel' : ''}" data-action="ed-emoji" data-v="${e}">${e}</button>`).join('')}
      </div>
    </div>

    <div class="field">
      <span class="label">Color</span>
      <div class="color-row">
        ${COLORS.map(c => `<button class="color-opt ${c === draft.color ? 'sel' : ''}" data-action="ed-color" data-v="${c}" style="--c:${c}" aria-label="Color ${c}"></button>`).join('')}
      </div>
    </div>

    <div class="field">
      <span class="label">Hora (opcional)</span>
      <div class="time-row">
        <input class="input" type="time" id="ed-time" value="${t ? t.time : ''}">
        <button class="btn btn-ghost" data-action="ed-clear-time">Quitar</button>
      </div>
    </div>

    <div class="field">
      <span class="label">Días</span>
      <div class="days-pick">
        ${WEEK.map(w => `<button class="day-opt ${draft.days.includes(w.d) ? 'sel' : ''}" data-action="ed-day" data-v="${w.d}" aria-label="${w.l}" aria-pressed="${draft.days.includes(w.d)}">${w.s}</button>`).join('')}
      </div>
      <div class="chips">
        <button class="chip" data-action="ed-preset" data-v="all">Todos los días</button>
        <button class="chip" data-action="ed-preset" data-v="weekdays">Lunes a viernes</button>
        <button class="chip" data-action="ed-preset" data-v="weekend">Fines de semana</button>
      </div>
    </div>

    <div class="sheet-actions">
      <button class="btn btn-primary btn-block" data-action="ed-save">${t ? 'Guardar cambios' : 'Crear hábito'}</button>
      ${t ? `<button class="btn btn-danger btn-block" data-action="ed-delete">${icon('trash')}Eliminar hábito</button>` : ''}
    </div>`);
}

function refreshDayPicks() {
  $$('.day-opt').forEach(b => {
    const on = draft.days.includes(Number(b.dataset.v));
    b.classList.toggle('sel', on);
    b.setAttribute('aria-pressed', on);
  });
}

function saveDraft() {
  const title = $('#ed-title').value.trim();
  if (!title) { toast('Escribe un nombre para tu hábito'); $('#ed-title').focus(); return; }
  if (!draft.days.length) { toast('Elige al menos un día'); return; }
  const data = { title, emoji: draft.emoji, color: draft.color, time: $('#ed-time').value || '', days: [...draft.days] };
  const isNew = !draft.id;
  if (isNew) state.tasks.push(cleanTask({ id: uid(), ...data, createdAt: todayKey(), order: Date.now() }));
  else Object.assign(taskById(draft.id), data);
  syncToday();
  commit();
  closeSheet();
  renderAll();
  toast(isNew ? `Hábito creado ${data.emoji}` : 'Cambios guardados');
}

function deleteDraft() {
  const t = taskById(draft.id);
  if (!t) return;
  if (!confirm(`¿Eliminar «${t.title}»?\nLos días que ya pasaron conservan su historial.`)) return;
  const k = todayKey();
  if (t.createdAt === k) state.tasks = state.tasks.filter(x => x.id !== t.id); // creado hoy: se borra por completo
  else t.deletedAt = k;                                                       // si no, se archiva para el historial
  if (state.history[k]) state.history[k].done = state.history[k].done.filter(id => id !== t.id);
  syncToday();
  commit();
  closeSheet();
  renderAll();
  toast('Hábito eliminado');
}

/* ==========================================================
   Vista: Calendario
   ========================================================== */
let calY = new Date().getFullYear();
let calM = new Date().getMonth();
const STATUS_TEXT = {
  complete: 'completado', partial: 'completado a medias', missed: 'sin cumplir',
  rest: 'día de descanso', pending: 'pendiente', progress: 'en curso',
};

function renderCalendar() {
  const tKey = todayKey();
  const { current, best } = computeStreaks();
  const first = new Date(calY, calM, 1);
  const offset = (first.getDay() + 6) % 7; // lunes primero
  const daysInMonth = new Date(calY, calM + 1, 0).getDate();
  let completeN = 0, evaluatedN = 0;
  let cells = '<span class="cday blank"></span>'.repeat(offset);

  for (let d = 1; d <= daysInMonth; d++) {
    const key = keyOf(new Date(calY, calM, d));
    const info = dayInfo(key, tKey);
    const s = info.status;
    if (s === 'complete') completeN++;
    if (s === 'complete' || s === 'partial' || s === 'missed') evaluatedN++;
    const clickable = s !== 'future' && s !== 'before';
    let mark = '';
    if (s === 'complete') mark = flameSvg('sm');
    else if (s === 'partial' || s === 'progress') mark = `<span class="cbar"><i style="width:${Math.round(info.ratio * 100)}%"></i></span>`;
    else if (s === 'missed') mark = '<span class="cdot"></span>';
    const cls = `cday s-${s} ${key === tKey ? 'is-today' : ''}`;
    const label = `${d}${STATUS_TEXT[s] ? `, ${STATUS_TEXT[s]}` : ''}`;
    cells += clickable
      ? `<button class="${cls}" data-action="day" data-key="${key}" aria-label="${label}"><span class="cnum">${d}</span>${mark}</button>`
      : `<span class="${cls}" aria-label="${label}"><span class="cnum">${d}</span>${mark}</span>`;
  }

  const now = new Date();
  const isCurrent = calY === now.getFullYear() && calM === now.getMonth();
  const start = dateOf(state.meta.startDate);
  const canPrev = calY > start.getFullYear() || (calY === start.getFullYear() && calM > start.getMonth());
  const rate = evaluatedN ? Math.round((completeN / evaluatedN) * 100) : null;

  $('#view-calendar').innerHTML = `
    <header class="page-head">
      <h1 class="title">Calendario</h1>
      <p class="subtitle">Cada ${flameSvg('xs')} es un día que sumó a tu racha.</p>
    </header>
    <div class="stats">
      <div class="stat hot">${flameSvg(current > 0 ? '' : 'off')}<div><strong>${current}</strong><span>Racha actual</span></div></div>
      <div class="stat"><div><strong>${best}</strong><span>Mejor racha</span></div></div>
    </div>
    <div class="cal">
      <div class="cal-head">
        <button class="icon-btn" data-action="cal-prev" ${canPrev ? '' : 'disabled'} aria-label="Mes anterior">${icon('chevron-left')}</button>
        <div class="cal-head-mid">
          <div class="cal-title">${fmtMonth(calY, calM)}${isCurrent ? '' : '<button class="link-btn" data-action="cal-today">Hoy</button>'}</div>
          <p class="cal-sub">${rate === null ? 'Sin días registrados' : `${completeN} ${completeN === 1 ? 'día completo' : 'días completos'}, ${rate} % cumplido`}</p>
        </div>
        <button class="icon-btn" data-action="cal-next" ${isCurrent ? 'disabled' : ''} aria-label="Mes siguiente">${icon('chevron-right')}</button>
      </div>
      <div class="cal-grid cal-wd" aria-hidden="true">${WEEK.map(w => `<span>${w.s}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
    </div>
    <div class="legend">
      <span>${flameSvg('xs')}Completado</span>
      <span><i class="lg-bar"></i>Parcial</span>
      <span><i class="lg-dot"></i>Sin cumplir</span>
      <span><i class="lg-rest"></i>Descanso</span>
    </div>`;
}

function openDay(key) {
  const info = dayInfo(key);
  const d = dateOf(key);
  const tasks = info.scheduled.map(taskById).filter(Boolean).sort(byTime);
  const done = new Set(info.done);
  const pill = {
    complete: `${flameSvg('xs')}Sumó a tu racha`,
    partial: 'Completado a medias',
    missed: 'Sin cumplir',
    rest: 'Día de descanso',
    pending: 'En curso',
    progress: 'En curso',
  }[info.status] || '';

  openSheet(`
    <div class="sheet-head">
      <div>
        <p class="sheet-kicker">${cap(fmt(d, { weekday: 'long' }))}</p>
        <h2 class="sheet-title">${fmt(d, { day: 'numeric', month: 'long', year: 'numeric' })}</h2>
      </div>
      <button class="icon-btn" data-action="close-sheet" aria-label="Cerrar">${icon('x')}</button>
    </div>
    <div class="status-pill s-${info.status}">${pill}</div>
    ${tasks.length
      ? `<ul class="day-list">${tasks.map(t => `
          <li class="${done.has(t.id) ? 'done' : ''}" style="--c:${t.color}">
            <span class="task-emoji sm">${esc(t.emoji)}</span>
            <span class="dl-title">${esc(t.title)}${t.deletedAt ? ' <em>(eliminado)</em>' : ''}</span>
            <span class="dl-check">${done.has(t.id) ? icon('check') : ''}</span>
          </li>`).join('')}</ul>`
      : '<p class="muted center">No había hábitos programados este día.</p>'}
    ${key === todayKey() ? '<button class="btn btn-primary btn-block" data-action="go-today">Ir a Hoy</button>' : ''}`);
}

/* ==========================================================
   Vista: Perfil
   ========================================================== */
const initial = name => (name ? Array.from(name.trim())[0].toUpperCase() : '🙂');
const reminderText = name => `¡Hola${name ? ` ${name}` : ''}! 🔥 Tu rutina de HabitFlow te espera. No dejes que se apague tu racha.`;

function renderProfile() {
  const name = state.user.name;
  const activeN = activeTasks().length;
  $('#view-profile').innerHTML = `
    <header class="page-head"><h1 class="title">Perfil</h1></header>

    <div class="card profile-card">
      <div class="avatar" id="pf-avatar">${esc(initial(name))}</div>
      <label class="field">
        <span class="label">Tu nombre</span>
        <input class="input" id="pf-name" maxlength="24" value="${esc(name)}" placeholder="¿Cómo te llamamos?" autocomplete="given-name" enterkeyhint="done">
      </label>
    </div>
    <p class="footnote profile-note">HabitFlow usa este nombre para saludarte y en tus recordatorios.</p>

    <div class="card">
      <div class="card-head">${icon('bell')}<h2>Recordatorio diario</h2></div>
      <p class="card-text">Mientras llegan las notificaciones dentro de la app, crea un recordatorio con la app <b>Atajos</b> de tu iPhone. Es gratis y toma un minuto:</p>
      <ol class="steps">
        <li>Abre <b>Atajos</b>, ve a <b>Automatización</b> y crea una nueva.</li>
        <li>Elige <b>Hora del día</b>, pon la hora y haz que se ejecute de inmediato.</li>
        <li>Agrega la acción <b>Mostrar notificación</b> y pega este mensaje:</li>
      </ol>
      <div class="quote" id="pf-reminder">${esc(reminderText(name))}</div>
      <button class="btn btn-ghost btn-block" data-action="copy-reminder">${icon('copy')}Copiar mensaje</button>
    </div>

    <div class="card">
      <div class="card-head">${icon('cloud')}<h2>Tus datos</h2></div>
      <p class="card-text">Todo se guarda en este iPhone. Exporta un respaldo de vez en cuando y guárdalo en iCloud Drive para no perder tu historial.</p>
      <div class="btn-col">
        <button class="btn btn-ghost btn-block" data-action="export">${icon('download')}Exportar respaldo</button>
        <button class="btn btn-ghost btn-block" data-action="import">${icon('upload')}Restaurar respaldo</button>
        <button class="btn btn-danger btn-block" data-action="reset">${icon('trash')}Borrar todos los datos</button>
      </div>
    </div>

    <p class="footnote center">HabitFlow <span id="pf-version">1.0</span>. Usándola desde el ${fmt(dateOf(state.meta.startDate), { day: 'numeric', month: 'long', year: 'numeric' })}, con ${activeN} ${activeN === 1 ? 'hábito activo' : 'hábitos activos'}.</p>`;
}

async function copyReminder() {
  const text = reminderText(state.user.name);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Mensaje copiado');
}

async function exportData() {
  const json = JSON.stringify(state, null, 2);
  const filename = `habitflow-respaldo-${todayKey()}.json`;
  const file = new File([json], filename, { type: 'application/json' });
  try {
    // En iPhone abre el menú Compartir: "Guardar en Archivos" lo manda a iCloud Drive.
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Respaldo de HabitFlow' });
      return;
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast('Respaldo exportado');
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.tasks) || typeof data.history !== 'object') throw new Error('formato');
    if (!confirm('Esto reemplazará tus datos actuales por los del respaldo. ¿Continuar?')) return;
    state = normalize(data);
    state.meta.onboarded = true;
    syncToday();
    commit();
    renderAll();
    toast('Respaldo restaurado');
  } catch {
    toast('Ese archivo no es un respaldo de HabitFlow');
  }
}

function resetAll() {
  if (!confirm('¿Borrar todos tus hábitos, tu historial y tu racha? No se puede deshacer.')) return;
  Store.clear();
  state = freshState();
  lastRing = 0;
  showTab('today');
  renderAll();
  renderOnboarding();
}

/* ==========================================================
   Bienvenida (primer uso)
   ========================================================== */
function renderOnboarding() {
  const el = $('#onboarding');
  el.innerHTML = `
    <div class="onb-inner">
      <div class="onb-logo">${flameSvg()}</div>
      <h1 class="onb-title">HabitFlow</h1>
      <p class="onb-sub">Arma tu rutina, cúmplela cada día y mantén tu fuego encendido.</p>

      <label class="field">
        <span class="label">¿Cómo te llamas?</span>
        <input class="input" id="onb-name" maxlength="24" placeholder="Tu nombre" autocomplete="given-name" enterkeyhint="go">
      </label>

      <div class="field">
        <span class="label">Elige con qué hábitos empezar</span>
        <div class="starter-list">
          ${STARTERS.map((s, i) => `
            <button class="starter ${i < 3 ? 'sel' : ''}" data-action="onb-toggle" data-i="${i}" style="--c:${s.color}" aria-pressed="${i < 3}">
              <span class="task-emoji sm">${s.emoji}</span>
              <span class="starter-name">${s.title}</span>
              <span class="check">${icon('check')}</span>
            </button>`).join('')}
        </div>
        <p class="footnote">Después podrás editarlos, quitarlos y elegir sus días.</p>
      </div>

      <button class="btn btn-primary btn-block" data-action="onb-start">Comenzar</button>
    </div>`;
  el.hidden = false;
  document.body.classList.add('locked');
}

function finishOnboarding() {
  const name = $('#onb-name').value.trim().slice(0, 24);
  if (!name) { toast('Escribe tu nombre para empezar'); $('#onb-name').focus(); return; }
  const k = todayKey();
  state.user.name = name;
  state.meta.startDate = k;
  state.meta.onboarded = true;
  $$('.starter.sel').forEach((b, idx) => {
    const s = STARTERS[Number(b.dataset.i)];
    state.tasks.push(cleanTask({ ...s, id: uid(), days: [...ALL_DAYS], createdAt: k, order: Date.now() + idx }));
  });
  syncToday();
  commit();
  renderAll();
  const el = $('#onboarding');
  el.classList.add('leaving');
  setTimeout(() => {
    el.hidden = true;
    el.classList.remove('leaving');
    el.innerHTML = '';
    document.body.classList.remove('locked');
  }, 350);
  toast(`¡Hola, ${name}! Tu racha empieza hoy 🔥`);
}

/* ==========================================================
   Hoja inferior, toast y navegación
   ========================================================== */
let sheetTimer;
function openSheet(html) {
  clearTimeout(sheetTimer);
  const root = $('#sheet-root');
  $('.sheet', root).innerHTML = `<div class="sheet-grab"></div>${html}`;
  $('.sheet', root).scrollTop = 0;
  root.hidden = false;
  document.body.classList.add('locked');
  root.getBoundingClientRect();
  requestAnimationFrame(() => root.classList.add('open'));
}
function closeSheet() {
  const root = $('#sheet-root');
  root.classList.remove('open');
  document.body.classList.remove('locked');
  sheetTimer = setTimeout(() => { root.hidden = true; }, 320);
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function showTab(tab) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${tab}`));
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  window.scrollTo(0, 0);
}

function renderAll() {
  renderToday();
  renderRoutine();
  renderCalendar();
  renderProfile();
  showVersion();
}

// Muestra en Perfil la versión instalada (la toma del nombre de la caché, p. ej. habitflow-v1.0.1).
async function showVersion() {
  try {
    const keys = await caches.keys();
    const current = keys.filter(k => k.startsWith('habitflow-v')).sort().pop();
    const el = $('#pf-version');
    if (current && el) el.textContent = current.replace('habitflow-v', 'v');
  } catch { /* sin acceso a la caché */ }
}

/* ---------- Acciones (un solo listener para toda la app) ---------- */
const actions = {
  'tab': el => showTab(el.dataset.tab),
  'toggle': el => toggleTask(el.dataset.id),
  'dismiss-install': () => { state.meta.installHintDismissed = true; commit(); renderToday(); },

  'routine-day': el => { routineDay = el.dataset.day === 'all' ? 'all' : Number(el.dataset.day); renderRoutine(); },
  'new-task': () => openEditor(null),
  'edit-task': el => openEditor(el.dataset.id),
  'close-sheet': () => closeSheet(),

  'ed-emoji': el => {
    draft.emoji = el.dataset.v;
    $$('.emoji-opt').forEach(b => b.classList.toggle('sel', b === el));
    $('#ed-preview').textContent = draft.emoji;
  },
  'ed-color': el => {
    draft.color = el.dataset.v;
    $$('.color-opt').forEach(b => b.classList.toggle('sel', b === el));
    $('#ed-preview').style.setProperty('--c', draft.color);
  },
  'ed-day': el => {
    const d = Number(el.dataset.v);
    draft.days = draft.days.includes(d) ? draft.days.filter(x => x !== d) : [...draft.days, d];
    refreshDayPicks();
  },
  'ed-preset': el => { draft.days = [...PRESETS[el.dataset.v]]; refreshDayPicks(); },
  'ed-clear-time': () => { $('#ed-time').value = ''; },
  'ed-save': () => saveDraft(),
  'ed-delete': () => deleteDraft(),

  'cal-prev': () => { calM--; if (calM < 0) { calM = 11; calY--; } renderCalendar(); },
  'cal-next': () => { calM++; if (calM > 11) { calM = 0; calY++; } renderCalendar(); },
  'cal-today': () => { const n = new Date(); calY = n.getFullYear(); calM = n.getMonth(); renderCalendar(); },
  'day': el => openDay(el.dataset.key),
  'go-today': () => { closeSheet(); showTab('today'); },

  'copy-reminder': () => copyReminder(),
  'export': () => exportData(),
  'import': () => $('#import-file').click(),
  'reset': () => resetAll(),

  'onb-toggle': el => { const on = el.classList.toggle('sel'); el.setAttribute('aria-pressed', on); },
  'onb-start': () => finishOnboarding(),
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el, e); }
});

document.addEventListener('input', e => {
  if (e.target.id === 'pf-name') {
    state.user.name = e.target.value.trim().slice(0, 24);
    commit();
    $('#pf-avatar').textContent = initial(state.user.name);
    $('#pf-reminder').textContent = reminderText(state.user.name);
    renderToday();
  }
  if (e.target.id === 'ed-title') {
    $('#ed-preview-title').textContent = e.target.value.trim() || 'Sin nombre';
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#sheet-root').hidden) closeSheet();
  if (e.key === 'Enter' && e.target.id === 'onb-name') finishOnboarding();
  if (e.key === 'Enter' && (e.target.id === 'pf-name' || e.target.id === 'ed-title')) e.target.blur();
});

$('#import-file').addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (file) importData(file);
  e.target.value = '';
});

/* ---------- Cambio de día con la app abierta ---------- */
let lastKey = todayKey();
function checkNewDay() {
  const k = todayKey();
  if (k === lastKey) return;
  lastKey = k;
  routineDay = new Date().getDay();
  calY = new Date().getFullYear();
  calM = new Date().getMonth();
  lastRing = 0;
  syncToday();
  commit();
  renderAll();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkNewDay(); });
setInterval(checkNewDay, 60 * 1000);

/* ---------- Arranque ---------- */
function init() {
  syncToday();
  if (state.meta.onboarded) commit();
  renderAll();
  if (!state.meta.onboarded) renderOnboarding();

  // Pide al sistema que no borre los datos guardados.
  try { navigator.storage?.persist?.(); } catch { /* no soportado */ }

  // Service worker: permite usar la app sin internet (y en la Fase 2, recibir notificaciones).
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    // Si ya había una versión instalada y llega una nueva, la app se recarga sola una vez.
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      location.reload();
    });

    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        // iOS deja la app en segundo plano: al volver a ella, busca actualizaciones.
        document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
        navigator.serviceWorker.ready.then(showVersion);
      })
      .catch(err => console.warn('Service worker no registrado', err));
  }
}

init();
