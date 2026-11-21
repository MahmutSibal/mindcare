-- Cihazlar arası eşitleme (telefon ↔ bilgisayar). Sunucu YALNIZCA şifreli paketleri tutar: kayıt kimliği
-- (tablo ve satır anahtarından üretilmiş anlamsız bir özet), zaman damgası, cihaz kimliği ve şifreli veri.
-- Şifreleme anahtarı hiçbir zaman sunucuya gelmez; terapistin kurtarma anahtarından cihazda türetilir.
--
-- Kasa kimliği ve erişim belirteci de aynı anahtardan türetilir; hesap/parola yoktur. Belirtecin yalnızca
-- SHA-256 özeti saklanır. Tablolara doğrudan erişim kapalıdır; her şey aşağıdaki işlevlerden geçer.

create table public.sync_vaults (
  id text primary key check (id ~ '^[0-9a-f]{64}$'),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create sequence public.sync_seq;

create table public.sync_records (
  vault text not null references public.sync_vaults(id) on delete cascade,
  rec text not null check (rec ~ '^[0-9a-f]{64}$'),
  seq bigint not null default nextval('public.sync_seq'),
  ts bigint not null,
  device text not null check (length(device) between 1 and 64),
  deleted boolean not null default false,
  data text check (data is null or length(data) <= 24000000),
  size int not null default 0,
  primary key (vault, rec)
);
create index sync_records_seq_idx on public.sync_records(vault, seq);

alter table public.sync_vaults enable row level security;
alter table public.sync_records enable row level security;
revoke all on public.sync_vaults, public.sync_records from anon, authenticated;
revoke all on sequence public.sync_seq from anon, authenticated;

-- Bu kadar kasa ve kasa başına bu kadar veri: tek klinik için fazlasıyla yeterli, kötüye kullanıma karşı sınır.
create or replace function private.sync_check(p_vault text, p_token text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform 1 from public.sync_vaults
    where id = p_vault and token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found then raise exception 'denied'; end if;
  update public.sync_vaults set last_seen = now() where id = p_vault;
end $$;
revoke all on function private.sync_check(text, text) from public, anon, authenticated;

-- İlk cihaz: kasayı açar (varsa belirteç doğrulanır). 'ok' | 'denied' | 'capacity'.
create or replace function public.sync_open(p_vault text, p_token text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare v_hash text := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_vault !~ '^[0-9a-f]{64}$' or length(p_token) < 32 then return 'denied'; end if;
  perform 1 from public.sync_vaults where id = p_vault;
  if found then
    perform 1 from public.sync_vaults where id = p_vault and token_hash = v_hash;
    if not found then return 'denied'; end if;
    return 'ok';
  end if;
  if (select count(*) from public.sync_vaults) >= 50 then return 'capacity'; end if;
  insert into public.sync_vaults (id, token_hash) values (p_vault, v_hash);
  return 'ok';
end $$;

-- Değişiklikleri yazar. Aynı kayıt için daha yeni (ts) olan kazanır; eşitse cihaz kimliği büyük olan.
-- Dönüş: kasadaki en büyük sıra numarası. Her çağrıda en çok 100 kayıt, kasa başına 250 MB.
create or replace function public.sync_push(p_vault text, p_token text, p_items jsonb)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare it jsonb; v_size bigint; v_max bigint;
begin
  perform private.sync_check(p_vault, p_token);
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then raise exception 'bad request'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    insert into public.sync_records as r (vault, rec, ts, device, deleted, data, size)
    values (p_vault, it->>'rec', (it->>'ts')::bigint, it->>'device', coalesce((it->>'deleted')::boolean, false),
            it->>'data', coalesce(length(it->>'data'), 0))
    on conflict (vault, rec) do update
      set seq = nextval('public.sync_seq'), ts = excluded.ts, device = excluded.device,
          deleted = excluded.deleted, data = excluded.data, size = excluded.size
      where excluded.ts > r.ts or (excluded.ts = r.ts and excluded.device > r.device);
  end loop;
  select coalesce(sum(size), 0) into v_size from public.sync_records where vault = p_vault;
  if v_size > 250000000 then raise exception 'quota exceeded'; end if;
  select coalesce(max(seq), 0) into v_max from public.sync_records where vault = p_vault;
  return v_max;
end $$;

-- Sıra numarasından sonraki değişiklikleri verir (en çok 50 kayıt).
create or replace function public.sync_pull(p_vault text, p_token text, p_after bigint, p_limit int default 50)
returns table (seq bigint, rec text, ts bigint, device text, deleted boolean, data text)
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.sync_check(p_vault, p_token);
  return query
    select r.seq, r.rec, r.ts, r.device, r.deleted, r.data
    from public.sync_records r
    where r.vault = p_vault and r.seq > p_after
    order by r.seq
    limit least(greatest(p_limit, 1), 50);
end $$;

-- Eşitlemeyi kapatır: kasa ve içindeki her şey sunucudan silinir (yerel veriler olduğu gibi kalır).
create or replace function public.sync_wipe(p_vault text, p_token text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.sync_check(p_vault, p_token);
  delete from public.sync_vaults where id = p_vault;
end $$;

revoke all on function public.sync_open(text, text) from public, anon;
revoke all on function public.sync_push(text, text, jsonb) from public, anon;
revoke all on function public.sync_pull(text, text, bigint, int) from public, anon;
revoke all on function public.sync_wipe(text, text) from public, anon;
grant execute on function public.sync_open(text, text) to authenticated;
grant execute on function public.sync_push(text, text, jsonb) to authenticated;
grant execute on function public.sync_pull(text, text, bigint, int) to authenticated;
grant execute on function public.sync_wipe(text, text) to authenticated;
