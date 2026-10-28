// ==========================================================
// HabitFlow · Edge Function "enviar-avisos"
//
// Corre en los servidores de Supabase. Cada minuto la despierta
// pg_cron y decide qué notificaciones enviar a cada usuario según
// su zona horaria, sus hábitos y lo que ya marcó hoy.
// También atiende el botón "Enviar aviso de prueba" de la app.
//
// Secretos que necesita (Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY   llave pública de notificaciones
//   VAPID_PRIVATE_KEY  llave privada de notificaciones
//   VAPID_SUBJECT      mailto:tu@correo.com
//   CRON_SECRET        contraseña que usa el reloj para llamar a esta función
//   SB_SECRET_KEY      tu clave sb_secret_... (para leer la base de datos)
//
// Abre https://TU-PROYECTO.supabase.co/functions/v1/enviar-avisos
// en el navegador para ver si todo está bien configurado.
// ==========================================================

const WINDOW_MIN = 10; // tolerancia en minutos si el reloj se retrasa un poco

/* ---------- Configuración ---------- */
const env = (k: string): string => String((globalThis as any).Deno?.env?.get(k) ?? '');

function cfg() {
  return {
    url: env('SUPABASE_URL').replace(/\/+$/, ''),
    key: env('SB_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY'),
    vapidPublic: env('VAPID_PUBLIC_KEY').trim(),
    vapidPrivate: env('VAPID_PRIVATE_KEY').trim(),
    subject: env('VAPID_SUBJECT').trim(),
    cronSecret: env('CRON_SECRET').trim(),
  };
}

function problems(c: any): string[] {
  const out: string[] = [];
  if (!c.url) out.push('SUPABASE_URL');
  if (!c.key) out.push('SB_SECRET_KEY');
  if (!c.vapidPublic) out.push('VAPID_PUBLIC_KEY');
  else if (safeLen(c.vapidPublic) !== 65) out.push('VAPID_PUBLIC_KEY (formato inválido)');
  if (!c.vapidPrivate) out.push('VAPID_PRIVATE_KEY');
  else if (safeLen(c.vapidPrivate) !== 32) out.push('VAPID_PRIVATE_KEY (formato inválido)');
  if (!/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(c.subject)) out.push('VAPID_SUBJECT (debe ser mailto:tu@correo.com)');
  if (!c.cronSecret) out.push('CRON_SECRET');
  return out;
}

/* ---------- Bytes y base64url ---------- */
const enc = new TextEncoder();

function b64uToBytes(s: string): any {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64u(bytes: any): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function safeLen(s: string): number {
  try { return b64uToBytes(s).length; } catch { return -1; }
}

function concat(...parts: any[]): any {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}

async function hmac(key: any, data: any): Promise<any> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/* ---------- Web Push: firma VAPID (RFC 8292) ---------- */
export async function vapidHeader(endpoint: string, c: any): Promise<string> {
  const header = bytesToB64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToB64u(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: c.subject,
  })));
  const pub = b64uToBytes(c.vapidPublic);
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: true,
    x: bytesToB64u(pub.slice(1, 33)),
    y: bytesToB64u(pub.slice(33, 65)),
    d: c.vapidPrivate,
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${bytesToB64u(sig)}, k=${c.vapidPublic}`;
}

/* ---------- Web Push: cifrado aes128gcm (RFC 8291) ---------- */
export async function encryptPayload(payload: any, p256dh: string, authSecret: string): Promise<any> {
  const uaPublic = b64uToBytes(p256dh);
  const auth = b64uToBytes(authSecret);
  const local: any = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as any, local.privateKey, 256));

  const one = new Uint8Array([1]);
  const prkKey = await hmac(auth, shared);
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic, one));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), one))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), one))).slice(0, 12);

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(payload, new Uint8Array([2]))));

  const head = new Uint8Array(21 + asPublic.length);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = asPublic.length;
  head.set(asPublic, 21);
  return concat(head, cipher);
}

export async function sendPush(sub: any, message: any, c: any, ttl = 3600) {
  try {
    const body = await encryptPayload(enc.encode(JSON.stringify(message)), sub.p256dh, sub.auth);
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidHeader(sub.endpoint, c),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttl),
        Urgency: 'high',
      },
      body,
    });
    const detail = res.ok ? '' : (await res.text()).slice(0, 300);
    return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410, detail };
  } catch (err: any) {
    return { ok: false, status: 0, gone: false, detail: String(err?.message || err) };
  }
}

/* ---------- Base de datos (API REST de Supabase) ---------- */
async function db(c: any, path: string, init: any = {}): Promise<any> {
  const res = await fetch(`${c.url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Base de datos (${res.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/* ---------- Fechas en la zona horaria de cada usuario ---------- */
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localNow(tz: string, now: Date) {
  let parts: any[];
  const opts: any = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' };
  try { parts = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz || 'UTC' }).formatToParts(now); }
  catch { parts = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).formatToParts(now); }
  const get = (t: string) => parts.find((p: any) => p.type === t)?.value || '';
  const hour = Number(get('hour')) % 24;
  return { key: `${get('year')}-${get('month')}-${get('day')}`, hour, minutes: hour * 60 + Number(get('minute')), weekday: WEEKDAYS[get('weekday')] };
}

export function addDaysKey(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function weekdayOfKey(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const toMinutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const validTime = (v: any) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : '');

function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

/* ---------- Reglas de la rutina (las mismas de la app) ---------- */
function isScheduled(h: any, key: string, wd: number): boolean {
  const created = String(h.created_on).slice(0, 10);
  const deleted = h.deleted_on ? String(h.deleted_on).slice(0, 10) : '';
  return (h.days || []).map(Number).includes(wd) && created <= key && (!deleted || deleted > key);
}

function dayStatus(key: string, todayKey: string, habits: any[], log: any): string {
  const wd = weekdayOfKey(key);
  const scheduled: string[] = key === todayKey || !log
    ? habits.filter(h => isScheduled(h, key, wd)).map(h => String(h.id))
    : (log.scheduled || []).map(String);
  if (!scheduled.length) return 'rest';
  const done = (log?.done || []).map(String).filter((id: string) => scheduled.includes(id));
  if (done.length >= scheduled.length) return 'complete';
  if (key === todayKey) return 'pending';
  return done.length ? 'partial' : 'missed';
}

export function computeStreak(habits: any[], logs: any[], startDate: string | null, todayKey: string): number {
  const byDay = new Map(logs.map((l: any) => [String(l.day).slice(0, 10), l]));
  let streak = 0;
  for (let i = 0; i < 400; i++) {
    const key = addDaysKey(todayKey, -i);
    if (startDate && key < startDate) break;
    const s = dayStatus(key, todayKey, habits, byDay.get(key));
    if (s === 'complete') streak++;
    else if (s === 'rest' || s === 'pending') continue;
    else break;
  }
  return streak;
}

function readPrefs(settings: any) {
  const n = (settings && settings.notif) || {};
  return {
    habits: n.habits !== false,
    summary: n.summary !== false,
    summaryTime: validTime(n.summaryTime) || '08:00',
    streak: n.streak !== false,
    streakTime: validTime(n.streakTime) || '21:00',
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/* ---------- Qué avisar a un usuario en este minuto ---------- */
export async function decide(p: any): Promise<any[]> {
  const { profile, habits, todayLog, local, getStreak } = p;
  const prefs = readPrefs(profile.settings);
  const name = String(profile.name || '').trim();
  const scheduled = habits.filter((h: any) => isScheduled(h, local.key, local.weekday));
  const done = new Set((todayLog?.done || []).map(String));
  const pending = scheduled.filter((h: any) => !done.has(String(h.id)));
  const due = (hhmm: string) => { const t = toMinutes(hhmm); return local.minutes >= t && local.minutes < t + WINDOW_MIN; };
  const out: any[] = [];

  if (prefs.habits) {
    for (const h of pending) {
      const t = validTime(h.time_of_day);
      if (!t || !due(t)) continue;
      const hora = fmtTime(t);
      const verbo = hora.startsWith('1:') ? 'es la' : 'son las';
      out.push({
        kind: 'habit', ref: String(h.id), ttl: 1800,
        message: {
          title: `Hora de ${h.emoji} ${h.title}`,
          body: `${name ? `${name}, ${verbo}` : cap(verbo)} ${hora} Márcalo cuando termines 🔥`, // la hora ya termina en «m.»
          tag: `habit-${h.id}`,
        },
      });
    }
  }

  const needSummary = prefs.summary && pending.length > 0 && due(prefs.summaryTime);
  const needStreak = prefs.streak && pending.length > 0 && due(prefs.streakTime);
  if (needSummary || needStreak) {
    const streak = await getStreak();
    const doneN = scheduled.length - pending.length;
    if (needSummary) {
      const greet = local.hour < 12 ? 'Buenos días' : local.hour < 19 ? 'Buenas tardes' : 'Buenas noches';
      const body = doneN === 0
        ? `Hoy tienes ${plural(scheduled.length, 'hábito', 'hábitos')}. ${streak > 0 ? `Tu racha va en ${plural(streak, 'día', 'días')} 🔥` : '¡A encender tu racha! 🔥'}`
        : `Llevas ${doneN} de ${scheduled.length}. ${pending.length === 1 ? 'Te falta 1 hábito' : `Te faltan ${pending.length}`} para completar el día.`;
      out.push({ kind: 'summary', ref: '', ttl: 3600, message: { title: `${greet}${name ? `, ${name}` : ''}`, body, tag: 'summary' } });
    }
    if (needStreak && streak > 0) {
      const falta = pending.length === 1 ? 'falta 1 hábito' : `faltan ${pending.length} hábitos`;
      out.push({
        kind: 'streak', ref: '', ttl: 3 * 3600,
        message: {
          title: `🔥 Tu racha de ${plural(streak, 'día', 'días')} está en riesgo`,
          body: `${name ? `${name}, te` : 'Te'} ${falta} para mantenerla. Se apaga a medianoche.`,
          tag: 'streak',
        },
      });
    }
  }
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- Cada minuto: revisar a todos los usuarios ---------- */
export async function tickAt(c: any, now: Date) {
  const subs = await db(c, 'push_subscriptions?select=id,user_id,endpoint,p256dh,auth');
  if (!subs.length) return { usuarios: 0, enviados: 0 };

  const ids = [...new Set(subs.map((s: any) => s.user_id))].join(',');
  const [profiles, habits] = await Promise.all([
    db(c, `profiles?select=id,name,timezone,start_date,settings&id=in.(${ids})`),
    db(c, `habits?select=user_id,id,title,emoji,time_of_day,days,created_on,deleted_on&user_id=in.(${ids})`),
  ]);
  const locals = new Map(profiles.map((p: any) => [p.id, localNow(p.timezone, now)]));
  const days = [...new Set([...locals.values()].map((l: any) => l.key))].join(',');
  const logs = await db(c, `day_logs?select=user_id,day,scheduled,done&user_id=in.(${ids})&day=in.(${days})`);

  let sent = 0, failed = 0;
  const removed = new Set();
  for (const profile of profiles) {
    const local: any = locals.get(profile.id);
    const mine = habits.filter((h: any) => h.user_id === profile.id);
    const todayLog = logs.find((l: any) => l.user_id === profile.id && String(l.day).slice(0, 10) === local.key);
    const items = await decide({
      profile, habits: mine, todayLog, local,
      getStreak: async () => {
        const since = addDaysKey(local.key, -400);
        const hist = await db(c, `day_logs?select=day,scheduled,done&user_id=eq.${profile.id}&day=gte.${since}&order=day.desc`);
        return computeStreak(mine, hist, profile.start_date ? String(profile.start_date).slice(0, 10) : null, local.key);
      },
    });
    if (!items.length) continue;

    // Se "reserva" cada aviso en el registro: si ya se había enviado hoy, no se repite.
    const claimed = await db(c, 'notification_log?on_conflict=user_id,day,kind,ref', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify(items.map((i: any) => ({ user_id: profile.id, day: local.key, kind: i.kind, ref: i.ref }))),
    });
    const fresh = items.filter((i: any) => (claimed || []).some((r: any) => r.kind === i.kind && String(r.ref) === i.ref));

    for (const item of fresh) {
      for (const sub of subs.filter((s: any) => s.user_id === profile.id && !removed.has(s.id))) {
        const r = await sendPush(sub, item.message, c, item.ttl);
        if (r.ok) sent++;
        else if (r.gone) { removed.add(sub.id); await db(c, `push_subscriptions?id=eq.${sub.id}`, { method: 'DELETE' }); }
        else { failed++; console.warn('Aviso no entregado', r.status, r.detail); }
      }
    }
  }
  return { usuarios: profiles.length, enviados: sent, fallidos: failed, eliminados: removed.size };
}

/* ---------- Botón "Enviar aviso de prueba" ---------- */
async function testPush(c: any, req: Request, json: any) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const userRes = await fetch(`${c.url}/auth/v1/user`, { headers: { apikey: c.key, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) return json({ error: 'Tu sesión expiró. Cierra sesión y vuelve a entrar.' }, 401);
  const user = await userRes.json();

  const [subs, profiles] = await Promise.all([
    db(c, `push_subscriptions?select=id,user_id,endpoint,p256dh,auth&user_id=eq.${user.id}`),
    db(c, `profiles?select=name&id=eq.${user.id}`),
  ]);
  if (!subs.length) return json({ error: 'Este usuario no tiene dispositivos con avisos activados.' }, 404);

  const name = String(profiles[0]?.name || '').trim();
  const message = { title: `¡Funciona${name ? `, ${name}` : ''}! 🔥`, body: 'Así te llegarán los avisos de HabitFlow.', tag: 'test' };
  let ok = 0;
  const errors: string[] = [];
  for (const sub of subs) {
    const r = await sendPush(sub, message, c, 600);
    if (r.ok) ok++;
    else if (r.gone) await db(c, `push_subscriptions?id=eq.${sub.id}`, { method: 'DELETE' });
    else errors.push(`${r.status} ${r.detail}`);
  }
  if (!ok) {
    const hint = errors.some(e => /jwt|vapid|403/i.test(e))
      ? 'Apple rechazó la firma: revisa VAPID_SUBJECT y que las llaves VAPID sean las del mismo par.'
      : 'No se pudo entregar el aviso.';
    return json({ error: hint, detalle: errors }, 502);
  }
  return json({ enviados: ok });
}

/* ---------- Diagnóstico (abrir la URL en el navegador) ---------- */
async function diagnose(c: any) {
  const faltan = problems(c);
  let baseDeDatos = 'sin probar';
  if (c.url && c.key) {
    try { await db(c, 'push_subscriptions?select=id&limit=1'); baseDeDatos = 'ok'; }
    catch (err: any) { baseDeDatos = String(err?.message || err); }
  }
  return { estado: !faltan.length && baseDeDatos === 'ok' ? 'listo' : 'revisar', faltan, base_de_datos: baseDeDatos };
}

/* ---------- Punto de entrada ---------- */
export async function handler(req: Request): Promise<Response> {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': req.headers.get('Access-Control-Request-Headers') || 'authorization, x-client-info, apikey, content-type',
  };
  const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data, null, 2), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const c = cfg();
  try {
    if (req.method === 'GET') return json(await diagnose(c));
    const body = await req.json().catch(() => ({}));

    if (body.action === 'public-key') {
      return c.vapidPublic ? json({ publicKey: c.vapidPublic }) : json({ error: 'Falta el secreto VAPID_PUBLIC_KEY en Supabase.' }, 500);
    }
    const faltan = problems(c);
    if (faltan.length) return json({ error: `Faltan o están mal estos secretos en Supabase: ${faltan.join(', ')}` }, 500);

    if (body.action === 'tick') {
      if (req.headers.get('x-cron-secret') !== c.cronSecret) return json({ error: 'No autorizado' }, 401);
      return json(await tickAt(c, new Date()));
    }
    if (body.action === 'test') return await testPush(c, req, json);
    return json({ error: 'Acción desconocida' }, 400);
  } catch (err: any) {
    console.error(err);
    return json({ error: String(err?.message || err) }, 500);
  }
}

const D = (globalThis as any).Deno;
if (D?.serve) D.serve(handler);
