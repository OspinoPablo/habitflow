-- =========================================================
-- HabitFlow · Fase 2 · Etapa 3: reloj de avisos
--
-- ✏️ ANTES DE EJECUTAR: reemplaza los DOS valores de la sección 2
--    (tu Project URL y tu CRON_SECRET del generador de llaves).
-- Luego: Supabase → SQL Editor → New query → pegar todo → Run.
-- Se puede ejecutar varias veces sin problema.
-- =========================================================


-- ---------- 1. Extensiones: el reloj y las llamadas web ----------
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;


-- ---------- 2. Datos privados del reloj (guardados cifrados en Vault) ----------
do $$
declare
  v_url    text := 'https://TU-PROYECTO.supabase.co';    -- ✏️ tu Project URL
  v_secret text := 'PEGA_AQUI_TU_CRON_SECRET';           -- ✏️ el CRON_SECRET del generador
begin
  v_url := rtrim(trim(v_url), '/');
  v_secret := trim(v_secret);
  if v_url like '%TU-PROYECTO%' or v_url !~ '^https://[a-z0-9-]+\.supabase\.co$' then
    raise exception 'Revisa la Project URL en la sección 2 (debe verse como https://abcd1234.supabase.co).';
  end if;
  if v_secret like 'PEGA_AQUI%' or length(v_secret) < 20 then
    raise exception 'Pega en la sección 2 el CRON_SECRET que te dio el generador de llaves.';
  end if;

  perform vault.update_secret(id, v_url) from vault.secrets where name = 'habitflow_url';
  if not found then perform vault.create_secret(v_url, 'habitflow_url'); end if;

  perform vault.update_secret(id, v_secret) from vault.secrets where name = 'habitflow_cron_secret';
  if not found then perform vault.create_secret(v_secret, 'habitflow_cron_secret'); end if;
end
$$;


-- ---------- 3. Cada minuto: despertar la función de avisos ----------
select cron.schedule(
  'habitflow-avisos',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'habitflow_url') || '/functions/v1/enviar-avisos',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'habitflow_cron_secret')
    ),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 20000
  );
  $job$
);


-- ---------- 4. Limpieza diaria (para que la base de datos no crezca) ----------
-- 3:15 a. m. en Colombia (8:15 UTC): borra el historial del reloj de más de 3 días…
select cron.schedule(
  'habitflow-limpieza-reloj',
  '15 8 * * *',
  $job$ delete from cron.job_run_details where end_time < now() - interval '3 days' $job$
);
-- …y los avisos enviados de hace más de 30 días.
select cron.schedule(
  'habitflow-limpieza-avisos',
  '20 8 * * *',
  $job$ delete from public.notification_log where day < current_date - 30 $job$
);


-- ---------- 5. Comprobación: deben aparecer 3 tareas activas ----------
select jobname as tarea, schedule as horario, active as activa
from cron.job
where jobname like 'habitflow%'
order by jobname;


-- =========================================================
-- Para revisar que el reloj funciona, espera 2 minutos y ejecuta
-- estas consultas en una pestaña nueva del SQL Editor:
--
--   select status, return_message, start_time
--   from cron.job_run_details order by start_time desc limit 5;
--
--   select status_code, content
--   from net._http_response order by created desc limit 5;
--
-- status_code 200 = todo bien · 401 = desactiva "Verify JWT" en la función
-- 404 = la función no se llama exactamente enviar-avisos
-- =========================================================
