-- Overnight picnic slots (e.g. 23:00 -> 01:00): slot_end_time < slot_start_time
-- now means "ends after midnight on the next day". Only end = start is invalid.
-- Patches the DEPLOYED function bodies in place (deployed = source of truth);
-- aborts if the expected check isn't found exactly once.
alter table public.bookings drop constraint bookings_slot_times_ordered;
alter table public.bookings add constraint bookings_slot_times_ordered
  check (slot_start_time is null or slot_end_time is null or slot_end_time <> slot_start_time);

do $$
declare
  fn   text;
  def  text;
  old_txt text := E'v_slot_end <= v_slot_start then\n    raise exception ''Slot end time (%) must be after the start time (%)'', v_slot_end, v_slot_start;';
  new_txt text := E'v_slot_end = v_slot_start then\n    -- end < start is allowed: an overnight slot that ends after midnight\n    raise exception ''Slot end time (%) cannot be the same as the start time (%)'', v_slot_end, v_slot_start;';
begin
  foreach fn in array array['admin_add_manual_booking(jsonb,jsonb)', 'admin_edit_booking(bigint,jsonb,jsonb)'] loop
    def := pg_get_functiondef(('public.' || fn)::regprocedure);
    if (length(def) - length(replace(def, old_txt, ''))) / length(old_txt) <> 1 then
      raise exception 'Expected exactly one slot check in %', fn;
    end if;
    execute replace(def, old_txt, new_txt);
  end loop;
end $$;
