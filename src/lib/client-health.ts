/**
 * Score ponderado de saúde por cliente (0–100). Compartilhado entre o
 * Dashboard geral da agência e o Dashboard da conta individual — não
 * duplicar a fórmula em nenhum lugar novo, sempre importar daqui.
 */
export type ClientHealthBreakdown = {
  onTime: number;
  approvals: number;
  briefing: number;
  schedule: number;
};

export type ClientHealthInput = {
  now?: number;
  tasks: Array<{
    done: boolean;
    done_at: string | null;
    due_at: string | null;
  }>;
  posts: Array<{
    stage: string;
    scheduled_at: string | null;
    updated_at: string | null;
  }>;
  briefingUpdatedAt: string | null;
};

export type ClientHealthResult = {
  score: number;
  breakdown: ClientHealthBreakdown;
};

export function computeClientHealthScore({
  now = Date.now(),
  tasks,
  posts,
  briefingUpdatedAt,
}: ClientHealthInput): ClientHealthResult {
  const closedRecent = tasks.filter(
    (t) => t.done && t.done_at && new Date(t.done_at).getTime() > now - 30 * 86_400_000,
  );
  const onTimeRatio =
    closedRecent.length === 0
      ? 1
      : closedRecent.filter(
          (t) => !t.due_at || new Date(t.done_at!).getTime() <= new Date(t.due_at).getTime(),
        ).length / closedRecent.length;

  const inCycle = posts.filter(
    (p) => p.updated_at && new Date(p.updated_at).getTime() > now - 30 * 86_400_000,
  );
  const approvedRatio =
    inCycle.length === 0
      ? 1
      : inCycle.filter((p) => ["approved", "scheduled", "published"].includes(p.stage)).length /
        inCycle.length;

  const briefingScore = !briefingUpdatedAt
    ? 0
    : Math.max(0, 1 - (now - new Date(briefingUpdatedAt).getTime()) / (60 * 86_400_000));

  const scheduleScore = posts.some(
    (p) => p.scheduled_at && new Date(p.scheduled_at).getTime() > now,
  )
    ? 1
    : 0;

  const onTime = Math.round(onTimeRatio * 40);
  const approvals = Math.round(approvedRatio * 30);
  const briefing = Math.round(briefingScore * 15);
  const schedule = Math.round(scheduleScore * 15);
  return {
    score: onTime + approvals + briefing + schedule,
    breakdown: { onTime, approvals, briefing, schedule },
  };
}
