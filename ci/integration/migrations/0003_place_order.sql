-- An RPC: validates its input and writes one order.
create or replace function public.place_order(p_account uuid, p_amount numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;
  if not exists (select 1 from accounts where id = p_account) then
    raise exception 'unknown account' using errcode = 'P0002';
  end if;
  insert into orders (account_id, amount) values (p_account, p_amount) returning id into v_id;
  return v_id;
end
$$;

revoke all on function public.place_order(uuid, numeric) from public;
grant execute on function public.place_order(uuid, numeric) to app_rw;
