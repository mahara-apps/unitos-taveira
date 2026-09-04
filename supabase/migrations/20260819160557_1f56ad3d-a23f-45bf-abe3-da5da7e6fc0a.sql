create extension if not exists supabase_vault with schema vault;

-- Define/rotaciona o segredo compartilhado dos jobs (chamado apenas pelo
-- service role; o valor nunca é gravado em código nem em tabela em claro).
create or replace function public.set_cron_secret(_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if _value is null or length(_value) < 16 then
    raise exception 'cron secret inválido';
  end if;
  select id into v_id from vault.secrets where name = 'cron_secret';
  if v_id is null then
    perform vault.create_secret(_value, 'cron_secret', 'Segredo compartilhado dos endpoints /api/public de cron');
  else
    perform vault.update_secret(v_id, _value, 'cron_secret', 'Segredo compartilhado dos endpoints /api/public de cron');
  end if;
end;
$$;

revoke all on function public.set_cron_secret(text) from public;
revoke all on function public.set_cron_secret(text) from anon;
revoke all on function public.set_cron_secret(text) from authenticated;
grant execute on function public.set_cron_secret(text) to service_role;

create or replace function public.cron_secret()
returns text
language sql
security definer
set search_path = public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1;
$$;

revoke all on function public.cron_secret() from public;
revoke all on function public.cron_secret() from anon;
revoke all on function public.cron_secret() from authenticated;
