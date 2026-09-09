import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, History, Loader2, Pencil, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { listBriefingsForPlanFn, renameBriefingVersionFn } from "@/lib/monthly-plans.functions";

/**
 * Histórico de versões do briefing (auditoria de `brand_briefing_versions`).
 * Salvamentos seguidos da mesma sessão são agrupados no servidor; aqui o
 * usuário pode dar um nome a cada versão para reconhecê-la depois.
 */
export function BriefingVersionHistory({
  brandId,
  clientId,
}: {
  brandId: string;
  clientId: string;
}) {
  const listFn = useServerFn(listBriefingsForPlanFn);
  const renameFn = useServerFn(renameBriefingVersionFn);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const queryKey = ["briefing-versions", brandId, clientId] as const;
  const versionsQ = useQuery({
    queryKey,
    queryFn: () => listFn({ data: { brandId, clientId } }),
    enabled: Boolean(brandId && clientId),
  });

  const rename = useMutation({
    mutationFn: (input: { versionId: string; name: string | null }) =>
      renameFn({ data: { brandId, clientId, ...input } }),
    onSuccess: () => {
      setEditing(null);
      void qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: ["monthly-plan", "briefings", brandId, clientId] });
      toast.success("Nome da versão atualizado.");
    },
    onError: () => toast.error("Não foi possível renomear a versão."),
  });

  const rows = versionsQ.data ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-muted-foreground" />
          Histórico de versões
        </CardTitle>
        <CardDescription>
          Cada sessão de edição gera uma versão. Dê um nome para reconhecê-la depois.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {versionsQ.isLoading ? (
          <>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma versão registrada ainda. Salve o briefing para criar a primeira.
          </p>
        ) : (
          rows.map((v) => {
            const when = new Date(v.createdAt).toLocaleString("pt-BR", {
              dateStyle: "short",
              timeStyle: "short",
            });
            const isEditing = editing === v.id;
            return (
              <div
                key={v.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <Input
                        autoFocus
                        value={draft}
                        maxLength={80}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="Ex.: Briefing inicial"
                        className="h-8"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        disabled={rename.isPending}
                        onClick={() =>
                          rename.mutate({ versionId: v.id, name: draft.trim() || null })
                        }
                        aria-label="Salvar nome"
                      >
                        {rename.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => setEditing(null)}
                        aria-label="Cancelar"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <p className="truncate text-sm font-medium">{v.name ?? `Versão de ${when}`}</p>
                  )}
                  {!isEditing ? (
                    <p className="text-[11px] text-muted-foreground">
                      {when}
                      {v.completion == null ? "" : ` · ${v.completion}% completo`}
                    </p>
                  ) : null}
                </div>
                {!isEditing ? (
                  <div className="flex items-center gap-2">
                    {v.current ? (
                      <Badge variant="outline" className="text-[10px]">
                        Atual
                      </Badge>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => {
                        setEditing(v.id);
                        setDraft(v.name ?? "");
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Renomear
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
