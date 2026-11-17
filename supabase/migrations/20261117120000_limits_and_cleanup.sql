-- Kötüye kullanım sınırı ve eski kayıtların temizliği. Klinik veri yine TUTULMAZ.

-- Bir terapist (anonim kimlik) aynı anda en fazla 20 açık oda tutabilir.
create or replace function public.create_call_room(p_room text, p_token_hash text, p_ttl_minutes int)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare v_exp timestamptz;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if (select count(*) from public.call_rooms
        where host_uid = auth.uid() and ended_at is null and created_at > now() - interval '8 hours') >= 20 then
    raise exception 'too many open rooms';
  end if;
  v_exp := now() + make_interval(mins => least(greatest(p_ttl_minutes, 5), 240));
  insert into public.call_rooms (id, host_uid, token_hash, expires_at)
  values (p_room, auth.uid(), lower(p_token_hash), v_exp);
  return v_exp;
end $$;

create or replace function public.create_group_room(p_room text, p_max int)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if (select count(*) from public.group_rooms
        where host_uid = auth.uid() and ended_at is null and created_at > now() - interval '8 hours') >= 20 then
    raise exception 'too many open rooms';
  end if;
  insert into public.group_rooms (id, host_uid, max_guests) values (p_room, auth.uid(), least(greatest(p_max, 1), 8));
end $$;

-- 7 günden eski odaları siler (group_invites zincirleme silinir).
create or replace function private.purge_old_rooms()
returns void
language sql security definer set search_path = ''
as $$
  delete from public.call_rooms where created_at < now() - interval '7 days';
  delete from public.group_rooms where created_at < now() - interval '7 days';
$$;
revoke all on function private.purge_old_rooms() from public, anon, authenticated;

-- pg_cron etkinse günlük çalıştırın (Dashboard → Database → Extensions → pg_cron):
--   select cron.schedule('purge-old-rooms', '17 3 * * *', 'select private.purge_old_rooms()');
