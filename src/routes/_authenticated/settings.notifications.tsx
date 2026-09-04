import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCircle2,
  Loader2,
  MessageCircle,
  Save,
  Sparkles,
  UserPlus,
} from "lucide-react";
import {
  getMyProfile,
  updateNotificationPrefs,
  type NotificationPrefs,
} from "@/lib/profile.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { usePageHeader } from "@/hooks/use-page-header";
import { PageKpi, PageKpiGrid } from "@/components/ui/page-kpi";
import {
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFICATION_PREF_KEYS,
  normalizeNotificationPrefs,
} from "@/lib/notification-prefs";

export const Route = createFileRoute("/_authenticated/settings/notifications")({
  component: NotificationsPage,
});

/** Cada item aqui tem um emissor real no servidor. */
const PREF_ROWS: Array<{
  key: keyof NotificationPrefs;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}> = [
  {
    key: "comments",
    icon: <MessageCircle className="h-4 w-4 text-violet-500" />,
    title: "Menções em comentários",
    subtitle: "Quando alguém te menciona em um comentário de tarefa ou no portal do cliente.",
  },
  {
    key: "assignments",
    icon: <UserPlus className="h-4 w-4 text-sky-500" />,
    title: "Tarefas atribuídas a mim",
    subtitle: "Quando uma tarefa passa a ser sua responsabilidade.",
  },
  {
    key: "approvals",
    icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
    title: "Aprovações",
    subtitle: "Peças que entram em revisão e decisões de aprovação (equipe e cliente).",
  },
  {
    key: "deadlines",
    icon: <CalendarClock className="h-4 w-4 text-amber-500" />,
    title: "Prazos próximos",
    subtitle: "Tarefas e publicações agendadas nas próximas 24 horas.",
  },
  {
    key: "ai_jobs",
    icon: <Sparkles className="h-4 w-4 text-fuchsia-500" />,
    title: "Jobs de IA e avisos do sistema",
    subtitle: "Conclusão/falha de gerações de IA e alertas de modelos indisponíveis.",
  },
];

function NotificationsPage() {
  const qc = useQueryClient();
  const fetchProfile = useServerFn(getMyProfile);
  const savePrefs = useServerFn(updateNotificationPrefs);

  const { data, isLoading } = useQuery({
    queryKey: ["me", "profile"],
    queryFn: () => fetchProfile(),
  });

  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);

  useEffect(() => {
    if (!data) return;
    setPrefs(
      normalizeNotificationPrefs((data as { notification_prefs?: unknown }).notification_prefs),
    );
  }, [data]);

  const mutation = useMutation({
    mutationFn: async () => savePrefs({ data: { prefs } }),
    onSuccess: async () => {
      toast.success("Preferências salvas");
      await qc.invalidateQueries({ queryKey: ["me", "profile"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao salvar"),
  });

  usePageHeader(
    {
      title: "Notificações",
      subtitle: "Quais eventos geram aviso no app para você",
      actions: (
        <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Salvar preferências
        </Button>
      ),
    },
    [mutation.isPending, prefs],
  );

  const active = useMemo(() => NOTIFICATION_PREF_KEYS.filter((k) => prefs[k]).length, [prefs]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="w-full space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <PageKpiGrid>
        <PageKpi
          label="Eventos ativos"
          value={`${active}/${NOTIFICATION_PREF_KEYS.length}`}
          icon={<Bell className="h-4 w-4" />}
          status="info"
        />
        <PageKpi
          label="Aprovações"
          value={prefs.approvals ? "Ativo" : "Inativo"}
          icon={<CheckCircle2 className="h-4 w-4" />}
          status={prefs.approvals ? "success" : "neutral"}
        />
        <PageKpi
          label="Prazos"
          value={prefs.deadlines ? "Ativo" : "Inativo"}
          icon={<CalendarClock className="h-4 w-4" />}
          status={prefs.deadlines ? "success" : "neutral"}
        />
        <PageKpi
          label="Críticos"
          value="Sempre"
          description="Não podem ser desligados"
          icon={<AlertTriangle className="h-4 w-4" />}
          status="warning"
        />
      </PageKpiGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Eventos que geram notificação</CardTitle>
            <CardDescription>
              Cada opção corresponde a um evento real do Unitos e é aplicada no servidor.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {PREF_ROWS.map((row) => (
              <div
                key={row.key}
                className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-card p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">{row.icon}</div>
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium leading-none">{row.title}</p>
                    <p className="text-xs text-muted-foreground">{row.subtitle}</p>
                  </div>
                </div>
                <Switch
                  checked={prefs[row.key]}
                  onCheckedChange={(v) => setPrefs({ ...prefs, [row.key]: v })}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Avisos que não podem ser desligados</CardTitle>
            <CardDescription>
              Eventos operacionais críticos chegam sempre, independentemente das preferências.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
              <p className="font-medium">SLA vencido</p>
              <p className="text-xs text-muted-foreground">
                Atrasos de etapa notificam responsável e gestores do workspace.
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
              <p className="font-medium">Briefing recebido do cliente</p>
              <p className="text-xs text-muted-foreground">
                Envio de briefing público avisa a equipe da marca.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Canais como email, push e WhatsApp não têm envio automático no sistema hoje — por isso
              foram removidos desta tela. Toda notificação é entregue dentro do app.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
