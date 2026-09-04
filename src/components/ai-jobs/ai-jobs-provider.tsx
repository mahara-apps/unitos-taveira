import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getCachedUser } from "@/lib/auth-cache";
import { describeError } from "@/lib/errors";
import {
  listMyAiJobs,
  dismissAiJob,
  clearFinishedAiJobs,
  type AiJobRow,
} from "@/lib/ai-jobs.functions";

type Ctx = {
  jobs: AiJobRow[];
  active: AiJobRow[];
  finished: AiJobRow[];
  dismiss: (id: string) => Promise<void>;
  clearFinished: () => Promise<void>;
  refetch: () => void;
};

const AiJobsCtx = createContext<Ctx | null>(null);

const AI_JOBS_KEY = ["ai_jobs", "me"] as const;

export function AiJobsProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const router = useRouter();
  const listFn = useServerFn(listMyAiJobs);
  const dismissFn = useServerFn(dismissAiJob);
  const clearFn = useServerFn(clearFinishedAiJobs);

  const query = useQuery({
    queryKey: AI_JOBS_KEY,
    queryFn: () => listFn(),
    staleTime: 15_000,
  });

  // Track which finished-job IDs we've already notified about (per session).
  const notifiedRef = useRef<Set<string>>(new Set());
  const prevStatusRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    let userId: string | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      const user = await getCachedUser();
      if (cancelled) return;
      userId = user?.id ?? null;
      if (!userId) return;
      channel = supabase
        .channel(`rt:ai_jobs:${userId}`)

        .on(
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table: "ai_jobs",
            filter: `user_id=eq.${userId}`,
          },
          () => {
            qc.invalidateQueries({ queryKey: AI_JOBS_KEY });
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [qc]);

  // Emit toasts on status transitions.
  useEffect(() => {
    const jobs = query.data ?? [];
    for (const j of jobs) {
      const prev = prevStatusRef.current.get(j.id);
      if (prev !== j.status) {
        if (
          (j.status === "succeeded" || j.status === "failed") &&
          !notifiedRef.current.has(j.id) &&
          prev
        ) {
          notifiedRef.current.add(j.id);
          if (j.status === "succeeded") {
            toast.success(`Concluído: ${j.title}`, {
              description: j.result?.injected ? "Adicionado ao seu pipeline." : "Geração pronta.",
              action: j.target_route
                ? {
                    label: "Abrir",
                    onClick: () => router.navigate({ to: j.target_route as "/content" }),
                  }
                : undefined,
            });
            // Invalidate downstream data when a draft was injected.
            if (j.result?.injected) {
              qc.invalidateQueries({ queryKey: ["board"] });
              qc.invalidateQueries({ queryKey: ["posts"] });
            }
          } else {
            toast.error(`Falhou: ${j.title}`, {
              // Traduz códigos/erros do backend; nunca exibe objeto cru no toast.
              description: j.error ? describeError(j.error) : "Erro desconhecido.",
            });
          }
        }
        prevStatusRef.current.set(j.id, j.status);
      }
    }
  }, [query.data, qc, router]);

  const dismiss = useCallback(
    async (id: string) => {
      await dismissFn({ data: { id } });
      qc.invalidateQueries({ queryKey: AI_JOBS_KEY });
    },
    [dismissFn, qc],
  );

  const clearFinished = useCallback(async () => {
    await clearFn();
    qc.invalidateQueries({ queryKey: AI_JOBS_KEY });
  }, [clearFn, qc]);

  const value = useMemo<Ctx>(() => {
    const jobs = query.data ?? [];
    return {
      jobs,
      active: jobs.filter((j) => j.status === "queued" || j.status === "running"),
      finished: jobs.filter(
        (j) => j.status === "succeeded" || j.status === "failed" || j.status === "cancelled",
      ),
      dismiss,
      clearFinished,
      refetch: () => qc.invalidateQueries({ queryKey: AI_JOBS_KEY }),
    };
  }, [query.data, dismiss, clearFinished, qc]);

  return <AiJobsCtx.Provider value={value}>{children}</AiJobsCtx.Provider>;
}

export function useAiJobs(): Ctx {
  const v = useContext(AiJobsCtx);
  if (!v) throw new Error("useAiJobs requires <AiJobsProvider>");
  return v;
}
