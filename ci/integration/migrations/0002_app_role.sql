-- The application connects as app_rw: it reads and writes data, nothing else.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_rw') then
    create role app_rw nologin;
  end if;
end
$$;

grant usage on schema public to app_rw;
grant select, insert, update on public.accounts, public.orders to app_rw;
revoke all on public.accounts, public.orders from public;
