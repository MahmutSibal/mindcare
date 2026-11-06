-- MindCare sinyalleşme odaları. Burada klinik veri, danışan adı veya not TUTULMAZ.
-- Yalnızca oda kimliği, davet anahtarının SHA-256 özeti ve katılımcıların anonim kimlikleri.
create table public.call_rooms (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{22,64}$'),
  host_uid uuid not null default auth.uid(),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  guest_uid uuid,
  joined_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index call_rooms_host_idx on public.call_rooms(host_uid);

-- Doğrudan tablo erişimi yok; tüm işlemler aşağıdaki fonksiyonlardan geçer.
alter table public.call_rooms enable row level security;
revoke all on public.call_rooms from anon, authenticated;

-- Terapist: oda oluşturur. Davet süresi 5–240 dk.
create or replace function public.create_call_room(p_room text, p_token_hash text, p_ttl_minutes int)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare v_exp timestamptz;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  v_exp := now() + make_interval(mins => least(greatest(p_ttl_minutes, 5), 240));
  insert into public.call_rooms (id, host_uid, token_hash, expires_at)
  values (p_room, auth.uid(), lower(p_token_hash), v_exp);
  return v_exp;
end $$;

-- Danışan: davet anahtarıyla katılır. Tek kullanımlık: ilk katılan danışanın
-- anonim kimliği kaydedilir; aynı kimlik sayfayı yenileyip tekrar katılabilir.
create or replace function public.join_call_room(p_room text, p_token text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare r public.call_rooms;
begin
  if auth.uid() is null then return 'unauthenticated'; end if;
  select * into r from public.call_rooms where id = p_room for update;
  if not found then return 'not_found'; end if;
  if r.token_hash <> encode(sha256(convert_to(p_token, 'UTF8')), 'hex') then return 'not_found'; end if;
  if r.ended_at is not null then return 'ended'; end if;
  if r.guest_uid is not null and r.guest_uid <> auth.uid() then return 'used'; end if;
  if r.guest_uid is null and r.expires_at < now() then return 'expired'; end if;
  if r.host_uid = auth.uid() then return 'host'; end if;
  update public.call_rooms set guest_uid = auth.uid(), joined_at = coalesce(joined_at, now()) where id = p_room;
  return 'ok';
end $$;

-- Terapist: görüşmeyi kapatır; kanal erişimi hemen sona erer.
create or replace function public.end_call_room(p_room text)
returns void
language sql security definer set search_path = ''
as $$
  update public.call_rooms set ended_at = now()
  where id = p_room and host_uid = auth.uid() and ended_at is null;
$$;

-- Bir kullanıcının belirli bir Realtime konusuna erişimi var mı?
create or replace function public.is_call_member(p_topic text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.call_rooms r
    where 'room:' || r.id = p_topic
      and r.ended_at is null
      and r.created_at > now() - interval '8 hours'
      and auth.uid() in (r.host_uid, r.guest_uid)
  );
$$;

revoke all on function public.create_call_room(text, text, int) from public, anon;
revoke all on function public.join_call_room(text, text) from public, anon;
revoke all on function public.end_call_room(text) from public, anon;
revoke all on function public.is_call_member(text) from public, anon;
grant execute on function public.create_call_room(text, text, int) to authenticated;
grant execute on function public.join_call_room(text, text) to authenticated;
grant execute on function public.end_call_room(text) to authenticated;
grant execute on function public.is_call_member(text) to authenticated;

-- Realtime yetkilendirmesi: özel kanallarda yalnızca odanın iki katılımcısı
-- mesaj okuyabilir ve gönderebilir.
create policy "call members can receive"
  on realtime.messages for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence')
         and public.is_call_member((select realtime.topic())));

create policy "call members can send"
  on realtime.messages for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence')
              and public.is_call_member((select realtime.topic())));
