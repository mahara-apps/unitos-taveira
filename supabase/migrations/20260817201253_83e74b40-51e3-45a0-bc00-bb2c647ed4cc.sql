create or replace function public.can_access_task(_task_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = _task_id
      and public.is_brand_member(t.brand_id, _user_id)
      and (t.client_id is null or public.can_access_client(t.client_id, _user_id))
  )
$$;

revoke all on function public.can_access_task(uuid, uuid) from public, anon;
grant execute on function public.can_access_task(uuid, uuid) to authenticated, service_role;

drop policy if exists "brand members manage task subtasks" on public.task_subtasks;

create policy "subtasks select via parent task"
on public.task_subtasks for select to authenticated
using (public.can_access_task(task_id, auth.uid()));

create policy "subtasks insert via parent task"
on public.task_subtasks for insert to authenticated
with check (public.can_access_task(task_id, auth.uid()));

create policy "subtasks update via parent task"
on public.task_subtasks for update to authenticated
using (public.can_access_task(task_id, auth.uid()))
with check (public.can_access_task(task_id, auth.uid()));

create policy "subtasks delete via parent task"
on public.task_subtasks for delete to authenticated
using (public.can_access_task(task_id, auth.uid()));