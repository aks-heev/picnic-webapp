-- T5: notify admin when a customer submits a menu selection (orders INSERT)
-- Mirrors the existing notify-* trigger pattern (uses call_edge_function + pg_net).

create or replace function public.trigger_notify_order_received()
returns trigger
language plpgsql
security definer
as $$
begin
  perform call_edge_function(
    'notify-order-received',
    jsonb_build_object('record', row_to_json(NEW)::jsonb)
  );
  return NEW;
end;
$$;

drop trigger if exists on_order_insert_notify on public.orders;

create trigger on_order_insert_notify
  after insert on public.orders
  for each row
  execute function public.trigger_notify_order_received();
