/* ==========================================================
   HabitFlow — sincronización con Supabase (Fase 2)
   Todo lo que habla con la nube vive aquí.
   La app sigue funcionando sin internet: guarda primero en el
   teléfono y sube los cambios cuando vuelve la conexión.
   Si el mismo dato cambió en dos lugares, gana el más reciente.
   ========================================================== */
'use strict';

const Cloud = (() => {
  const cfg = window.HABITFLOW_CONFIG || {};
  const url = String(cfg.supabaseUrl || '').trim().replace(/\/+$/, '');
  const key = String(cfg.supabaseKey || '').trim();

  // Revisa config.js y se niega a usar una clave secreta en el navegador.
  let problem = '';
  if (!/^https:\/\/\S+$/.test(url) || url.includes('TU-PROYECTO') || key.length < 20 || key.includes('PEGA_AQUI')) {
    problem = 'Para activar la sincronización, pega la URL y la clave publishable de Supabase en config.js y vuelve a publicar.';
  } else if (key.startsWith('sb_secret_') || isServiceRoleJwt(key)) {
    problem = '⚠️ En config.js pusiste la clave SECRETA. Bórrala de inmediato, usa la publishable y, por seguridad, genera una clave secreta nueva en Supabase.';
  }

  let sb = null;
  if (!problem) {
    try {
      sb = window.supabase.createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'habitflow-auth' },
      });
    } catch (err) {
      console.warn('Supabase no disponible', err);
      problem = 'No se pudo cargar la librería de Supabase (vendor/supabase.js).';
    }
  }

  const PAGE = 1000;          // filas por consulta
  const RECENT_DAYS = 60;     // en sincronizaciones normales solo se bajan los últimos 60 días
  let session = null;
  let phase = 'idle';         // idle | syncing | offline | error
  let lastError = '';
  let running = null;
  let queued = null;
  let pushTimer = null;
  let lastPullAt = 0;
  const listeners = { data: [], status: [] };

  /* ---------- Utilidades ---------- */
  function isServiceRoleJwt(k) {
    if (!k.startsWith('eyJ')) return false;
    try { return JSON.parse(atob(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role'; }
    catch { return false; }
  }
  const iso = ms => new Date(ms || 0).toISOString();
  const msOf = v => (v ? Date.parse(v) || 0 : 0);
  const emit = type => listeners[type].forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  const timezone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
  const isNetworkError = err => !navigator.onLine || /failed to fetch|load failed|networkerror|network request failed/i.test(String(err?.message || err || ''));

  function friendlyError(err) {
    const code = String(err?.code || '');
    const m = String(err?.message || err || '').toLowerCase();
    if (isNetworkError(err)) return 'Sin conexión a internet.';
    if (code === 'invalid_credentials' || m.includes('invalid login credentials')) return 'Correo o contraseña incorrectos.';
    if (code === 'user_already_exists' || m.includes('already registered')) return 'Ya existe una cuenta con ese correo. Usa «Iniciar sesión».';
    if (code === 'email_not_confirmed' || m.includes('email not confirmed')) return 'Tu correo no está confirmado. Desactiva «Confirm email» en Supabase o confírmalo desde tu correo.';
    if (code === 'weak_password' || m.includes('password should')) return 'La contraseña debe tener al menos 6 caracteres.';
    if (code === 'email_address_invalid' || m.includes('invalid format')) return 'Ese correo no parece válido.';
    if (code.startsWith('over_') || m.includes('rate limit') || m.includes('too many')) return 'Demasiados intentos. Espera un momento y vuelve a intentar.';
    if (code === 'signup_disabled' || m.includes('signups not allowed')) return 'El registro de cuentas está desactivado en Supabase.';
    if (m.includes('api key')) return 'La clave de config.js no es válida. Revisa que sea la publishable.';
    if (m.includes('does not exist') || m.includes('schema cache')) return 'Faltan tablas en Supabase. Ejecuta de nuevo 01_esquema.sql.';
    if (code === '42501' || m.includes('permission denied') || m.includes('row-level security')) return 'Supabase rechazó el acceso. Revisa que ejecutaste 01_esquema.sql completo.';
    return err?.message || 'Error desconocido.';
  }

  function setPhase(p, err) {
    phase = p;
    lastError = err ? friendlyError(err) : '';
    emit('status');
  }

  /* ---------- Cambios pendientes de subir ---------- */
  const dirty = () => state.sync.dirty;
  const mark = (kind, id) => { if (!dirty()[kind].includes(id)) dirty()[kind].push(id); };
  const unmark = (kind, id) => { const arr = dirty()[kind]; const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); };
  const pendingCount = () => (dirty().profile ? 1 : 0) + dirty().tasks.length + dirty().days.length;
  function markAll() {
    dirty().profile = true;
    dirty().tasks = state.tasks.map(t => t.id);
    dirty().days = Object.keys(state.history);
  }

  /* ---------- Conversión app ⇄ base de datos ---------- */
  const profileRow = uid => ({
    id: uid,
    name: state.user.name || '',
    timezone: timezone(),
    start_date: state.meta.startDate,
    settings: state.settings || {},
    updated_at: iso(state.user.updatedAt),
  });
  const habitRow = (uid, t) => ({
    user_id: uid, id: t.id, title: t.title, emoji: t.emoji, color: t.color,
    time_of_day: t.time || '', days: t.days, created_on: t.createdAt, deleted_on: t.deletedAt || null,
    sort_order: Math.round(t.order || 0), updated_at: iso(t.updatedAt),
  });
  const fromHabitRow = r => cleanTask({
    id: r.id, title: r.title, emoji: r.emoji, color: r.color, time: r.time_of_day, days: r.days,
    createdAt: r.created_on, deletedAt: r.deleted_on, order: r.sort_order, updatedAt: msOf(r.updated_at),
  });
  const dayRow = (uid, k, rec) => ({ user_id: uid, day: k, scheduled: rec.scheduled, done: rec.done, updated_at: iso(rec.updatedAt) });

  /* ---------- Bajar de la nube ---------- */
  async function fetchAll(table, uid, orderCol, sinceDay) {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      let q = sb.from(table).select('*').eq('user_id', uid);
      if (sinceDay) q = q.gte('day', sinceDay);
      const { data, error } = await q.order(orderCol).range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < PAGE) return rows;
    }
  }

  async function pull(uid, full) {
    const since = full ? null : keyOf(addDays(new Date(), -RECENT_DAYS));
    const [profileRes, habits, days] = await Promise.all([
      sb.from('profiles').select('*').eq('id', uid).maybeSingle(),
      fetchAll('habits', uid, 'id'),
      fetchAll('day_logs', uid, 'day', since),
    ]);
    if (profileRes.error) throw profileRes.error;
    const prof = profileRes.data;
    let changed = false;

    // Perfil
    if (prof) {
      const remoteAt = msOf(prof.updated_at);
      const localAt = state.user.updatedAt || 0;
      if (remoteAt > localAt) {
        state.user.name = String(prof.name || '').slice(0, 24) || state.user.name;
        state.user.updatedAt = remoteAt;
        state.settings = prof.settings && typeof prof.settings === 'object' ? prof.settings : {};
        dirty().profile = false;
        changed = true;
      } else if (remoteAt < localAt) {
        dirty().profile = true;
      } else {
        dirty().profile = false;
      }
      // La fecha de inicio siempre conserva la más antigua (para no perder historial)
      if (isDateKey(prof.start_date) && prof.start_date !== state.meta.startDate) {
        if (prof.start_date < state.meta.startDate) {
          state.meta.startDate = prof.start_date;
          changed = true;
        } else {
          state.user.updatedAt = Math.max(Date.now(), remoteAt + 1);
          dirty().profile = true;
        }
      }
    } else {
      dirty().profile = true;
    }

    // Hábitos
    for (const row of habits) {
      const remoteAt = msOf(row.updated_at);
      const local = state.tasks.find(t => t.id === row.id);
      if (!local) { state.tasks.push(fromHabitRow(row)); changed = true; }
      else if (remoteAt > (local.updatedAt || 0)) { Object.assign(local, fromHabitRow(row)); unmark('tasks', row.id); changed = true; }
      else if (remoteAt < (local.updatedAt || 0)) mark('tasks', row.id);
      else unmark('tasks', row.id);
    }

    // Días
    for (const row of days) {
      const k = String(row.day).slice(0, 10);
      if (!isDateKey(k)) continue;
      const remoteAt = msOf(row.updated_at);
      const local = state.history[k];
      if (!local || remoteAt > (local.updatedAt || 0)) {
        state.history[k] = { scheduled: (row.scheduled || []).map(String), done: (row.done || []).map(String), updatedAt: remoteAt };
        unmark('days', k);
        changed = true;
      } else if (remoteAt < (local.updatedAt || 0)) mark('days', k);
      else unmark('days', k);
    }

    lastPullAt = Date.now();
    if (changed) emit('data'); // la app recalcula y vuelve a pintar (antes de subir)
  }

  /* ---------- Subir a la nube ---------- */
  async function upsert(table, rows, onConflict) {
    const { error } = await sb.from(table).upsert(rows, { onConflict });
    if (error) throw error;
  }

  async function push(uid) {
    if (dirty().profile) {
      const sent = JSON.stringify(profileRow(uid));
      await upsert('profiles', [JSON.parse(sent)], 'id');
      if (JSON.stringify(profileRow(uid)) === sent) dirty().profile = false;
    }

    dirty().tasks = dirty().tasks.filter(id => state.tasks.some(t => t.id === id));
    const tasks = dirty().tasks.map(id => state.tasks.find(t => t.id === id));
    for (const group of chunks(tasks, 200)) {
      const sent = group.map(t => [t.id, JSON.stringify(habitRow(uid, t))]);
      await upsert('habits', sent.map(([, json]) => JSON.parse(json)), 'user_id,id');
      // Si cambió mientras se subía, se queda pendiente para la próxima vez
      for (const [id, json] of sent) {
        const t = state.tasks.find(x => x.id === id);
        if (t && JSON.stringify(habitRow(uid, t)) === json) unmark('tasks', id);
      }
    }

    dirty().days = dirty().days.filter(k => state.history[k]);
    for (const group of chunks([...dirty().days], 200)) {
      const sent = group.map(k => [k, JSON.stringify(dayRow(uid, k, state.history[k]))]);
      await upsert('day_logs', sent.map(([, json]) => JSON.parse(json)), 'user_id,day');
      for (const [k, json] of sent) {
        if (state.history[k] && JSON.stringify(dayRow(uid, k, state.history[k])) === json) unmark('days', k);
      }
    }
  }

  /* ---------- Sincronización completa ---------- */
  function sync(opts = {}) {
    if (!sb || !session) return Promise.resolve();
    if (running) {
      queued = { pull: !!(queued?.pull || opts.pull !== false), full: !!(queued?.full || opts.full) };
      return running;
    }
    running = (async () => {
      const uid = session.user.id;
      const full = !!opts.full || state.sync.userId !== uid || state.sync.needsFull;
      setPhase('syncing');
      try {
        if (full) {
          state.sync.userId = uid;
          state.sync.email = session.user.email || '';
          state.sync.needsFull = true;
          markAll();
        }
        if (opts.pull !== false || full) await pull(uid, full);
        await push(uid);
        state.sync.needsFull = false;
        state.sync.lastSyncAt = Date.now();
        setPhase('idle');
      } catch (err) {
        console.warn('Error de sincronización', err);
        setPhase(isNetworkError(err) ? 'offline' : 'error', err);
      } finally {
        Store.save(state);
        running = null;
        if (queued) { const next = queued; queued = null; sync(next); }
      }
    })();
    return running;
  }

  // Después de cada cambio en la app: espera un momento y sube (agrupa varios toques seguidos).
  function schedulePush() {
    if (!sb || !session) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => sync({ pull: false }), 1500);
  }

  /* ---------- Cuenta ---------- */
  async function afterAuth(data) {
    session = data.session;
    await sync({ full: true });
    return { ok: true };
  }

  async function signUp(email, password) {
    if (!sb) return { error: problem };
    try {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) return { error: friendlyError(error) };
      if (!data.session) return { needsConfirmation: true };
      return await afterAuth(data);
    } catch (err) { return { error: friendlyError(err) }; }
  }

  async function signIn(email, password) {
    if (!sb) return { error: problem };
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return { error: friendlyError(error) };
      return await afterAuth(data);
    } catch (err) { return { error: friendlyError(err) }; }
  }

  async function signOut() {
    if (!sb) return;
    clearTimeout(pushTimer);
    if (session) await sync({ pull: false }); // sube lo pendiente antes de salir
    try { await sb.auth.signOut({ scope: 'local' }); } catch { /* sin conexión: igual se cierra aquí */ }
    session = null;
    state.sync = freshSync();
    Store.save(state);
    setPhase('idle');
  }

  /* ---------- Arranque ---------- */
  async function init() {
    if (!sb) { emit('status'); return; }
    try {
      const { data } = await sb.auth.getSession();
      session = data?.session || null;
    } catch (err) { console.warn('No se pudo leer la sesión', err); }

    sb.auth.onAuthStateChange((event, s) => {
      session = s;
      emit('status');
    });
    window.addEventListener('online', () => sync());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - lastPullAt > 30 * 1000) sync();
    });
    emit('status');
    if (session) sync();
  }

  return {
    init,
    sync: (opts) => sync(opts),
    schedulePush,
    signUp,
    signIn,
    signOut,
    available: () => !!sb,
    problem: () => problem,
    signedIn: () => !!session,
    email: () => session?.user?.email || state.sync.email || '',
    status: () => ({ phase, error: lastError, lastSyncAt: state.sync.lastSyncAt, pending: pendingCount() }),
    on: (type, fn) => listeners[type]?.push(fn),
  };
})();
