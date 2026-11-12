-- Grup görüşmeleri. Klinik veri, ad veya not TUTULMAZ: yalnızca oda kimliği, davet anahtarlarının
-- SHA-256 özetleri ve katılımcıların anonim kimlikleri. Her üyenin kendi tek kullanımlık daveti vardır.
create table public.group_rooms (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{22,64}$'),
  host_uid uuid not null default auth.uid(),
  max_guests int not null check (max_guests between 1 and 8),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index group_rooms_host_idx on public.group_rooms(host_uid);

create table public.group_invites (
  room text not null references public.group_rooms(id) on delete cascade,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  guest_uid uuid,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (room, token_hash)
);
create index group_invites_guest_idx on public.group_invites(room, guest_uid);

alter table public.group_rooms enable row level security;
alter table public.group_invites enable row level security;
revoke all on public.group_rooms, public.group_invites from anon, authenticated;

-- Terapist: grup odası açar.
create or replace function public.create_group_room(p_room text, p_max int)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.group_rooms (id, host_uid, max_guests) values (p_room, auth.uid(), least(greatest(p_max, 1), 8));
end $$;

-- Terapist: bir üye için tek kullanımlık davet ekler (oda kapasitesini aşamaz). Süre 5–1440 dk.
create or replace function public.add_group_invite(p_room text, p_token_hash text, p_ttl_minutes int)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare r public.group_rooms; v_exp timestamptz; v_n int;
begin
  select * into r from public.group_rooms where id = p_room and host_uid = auth.uid() and ended_at is null;
  if not found then raise exception 'room not found'; end if;
  select count(*) into v_n from public.group_invites where room = p_room;
  if v_n >= r.max_guests then raise exception 'room is full'; end if;
  v_exp := now() + make_interval(mins => least(greatest(p_ttl_minutes, 5), 1440));
  insert into public.group_invites (room, token_hash, expires_at) values (p_room, lower(p_token_hash), v_exp);
  return v_exp;
end $$;

-- Üye: davet anahtarıyla katılır. Aynı kimlik sayfayı yenileyip tekrar katılabilir.
create or replace function public.join_group_room(p_room text, p_token text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare r public.group_rooms; i public.group_invites;
begin
  if auth.uid() is null then return 'unauthenticated'; end if;
  select * into r from public.group_rooms where id = p_room;
  if not found then return 'not_found'; end if;
  select * into i from public.group_invites
    where room = p_room and token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') for update;
  if not found then return 'not_found'; end if;
  if r.ended_at is not null then return 'ended'; end if;
  if i.guest_uid is not null and i.guest_uid <> auth.uid() then return 'used'; end if;
  if i.guest_uid is null and i.expires_at < now() then return 'expired'; end if;
  if r.host_uid = auth.uid() then return 'host'; end if;
  update public.group_invites set guest_uid = auth.uid(), joined_at = coalesce(joined_at, now())
    where room = p_room and token_hash = i.token_hash;
  return 'ok';
end $$;

create or replace function public.end_group_room(p_room text)
returns void
language sql security definer set search_path = ''
as $$
  update public.group_rooms set ended_at = now() where id = p_room and host_uid = auth.uid() and ended_at is null;
$$;

-- Realtime konusu `group:<oda>`: yalnızca terapist ve katılmış üyeler.
create or replace function public.is_group_member(p_topic text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_rooms r
    where 'group:' || r.id = p_topic
      and r.ended_at is null
      and r.created_at > now() - interval '8 hours'
      and (auth.uid() = r.host_uid
           or exists (select 1 from public.group_invites i where i.room = r.id and i.guest_uid = auth.uid()))
  );
$$;

revoke all on function public.create_group_room(text, int) from public, anon;
revoke all on function public.add_group_invite(text, text, int) from public, anon;
revoke all on function public.join_group_room(text, text) from public, anon;
revoke all on function public.end_group_room(text) from public, anon;
revoke all on function public.is_group_member(text) from public, anon;
grant execute on function public.create_group_room(text, int) to authenticated;
grant execute on function public.add_group_invite(text, text, int) to authenticated;
grant execute on function public.join_group_room(text, text) to authenticated;
grant execute on function public.end_group_room(text) to authenticated;
grant execute on function public.is_group_member(text) to authenticated;

create policy "group members can receive"
  on realtime.messages for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence')
         and public.is_group_member((select realtime.topic())));

create policy "group members can send"
  on realtime.messages for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence')
              and public.is_group_member((select realtime.topic())));
