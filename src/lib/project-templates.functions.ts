import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ProjectTemplate = {
  id: string;
  brand_id: string | null;
  name: string;
  description: string | null;
  icon: string | null;
  is_system: boolean;
  jobs_count?: number;
  tasks_count?: number;
};

export const listTemplatesFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ brandId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<ProjectTemplate[]> => {
    const { data: rows, error } = await context.supabase
      .from("project_templates")
      .select("id, brand_id, name, description, icon, is_system")
      .or(`is_system.eq.true,brand_id.eq.${data.brandId}`)
      .order("is_system", { ascending: false })
      .order("name", { ascending: true });
    if (error) throw error;
    const templates = (rows ?? []) as ProjectTemplate[];
    if (templates.length === 0) return [];
    const ids = templates.map((t) => t.id);
    const { data: jobs } = await context.supabase
      .from("project_template_jobs")
      .select("id, template_id")
      .in("template_id", ids);
    const jobRows = (jobs ?? []) as Array<{ id: string; template_id: string }>;
    const jobIds = jobRows.map((j) => j.id);
    const { data: tasks } = jobIds.length
      ? await context.supabase
          .from("project_template_tasks")
          .select("id, template_job_id")
          .in("template_job_id", jobIds)
      : { data: [] };
    const taskRows = (tasks ?? []) as Array<{ id: string; template_job_id: string }>;
    const jobToTpl = new Map(jobRows.map((j) => [j.id, j.template_id]));
    const jobsCount = new Map<string, number>();
    const tasksCount = new Map<string, number>();
    for (const j of jobRows) jobsCount.set(j.template_id, (jobsCount.get(j.template_id) ?? 0) + 1);
    for (const t of taskRows) {
      const tplId = jobToTpl.get(t.template_job_id);
      if (tplId) tasksCount.set(tplId, (tasksCount.get(tplId) ?? 0) + 1);
    }
    return templates.map((t) => ({
      ...t,
      jobs_count: jobsCount.get(t.id) ?? 0,
      tasks_count: tasksCount.get(t.id) ?? 0,
    }));
  });

export const instantiateTemplateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        templateId: z.string().uuid(),
        brandId: z.string().uuid(),
        clientId: z.string().uuid().nullable().optional(),
        projectName: z.string().trim().min(2).max(120),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: projectId, error } = await context.supabase.rpc("instantiate_project_template", {
      _template_id: data.templateId,
      _brand_id: data.brandId,
      _client_id: (data.clientId ?? null) as string,
      _project_name: data.projectName,
    });
    if (error) throw error;
    return { projectId: (projectId as unknown as string) ?? "" };
  });
