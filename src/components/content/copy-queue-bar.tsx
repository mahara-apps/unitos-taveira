/**
 * Faixa da tela de Conteúdo com o estado da fila de legendas.
 * Mostra quantas peças estão sem legenda e permite retomar em lote (usa a
 * rotina oficial do servidor, a mesma da retomada automática). Enquanto houver
 * peça em produção, atualiza o quadro sozinho.
 */
import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { resumePendingPostsFn } from "@/lib/content.functions";
import { summarizeCopyQueue } from "@/lib/post-copy-status";

export function CopyQueueBar({
  brandId,
  clientId,
  posts,
  invalidateKey,
}: {
  brandId: string;
  clientId: string;
  posts: Array<{ copy?: string | null; ai_phase?: string | null; ai_phase_error?: string | null }>;
  invalidateKey: readonly unknown[];
}) {
  const qc = useQueryClient();
  const resume = useServerFn(resumePendingPostsFn);
  const { running, pending, failed, total } = summarizeCopyQueue(posts);

  // A legenda chega por evento: o quadro acompanha as peças deste cliente em
  // tempo real, sem ficar consultando o banco de tempos em tempos.
  useEffect(() => {
    if (!clientId) return;
    const channel = supabase
      .channel(`copy-queue-${clientId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "posts", filter: `client_id=eq.${clientId}` },
        () => qc.invalidateQueries({ queryKey: invalidateKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [clientId, qc, invalidateKey]);

  const retry = useMutation({
    mutationFn: () => resume({ data: { brandId, clientId, limit: 5 } }),
    onSuccess: (res) => {
      if (res.candidates === 0) toast.success("Nenhuma legenda pendente por aqui.");
      else if (res.generated > 0) toast.success(`${res.generated} legenda(s) concluída(s).`);
      else toast.message("Retomada iniciada. As legendas aparecem em instantes.");
      qc.invalidateQueries({ queryKey: invalidateKey });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Não foi possível retomar as legendas."),
  });

  if (total === 0) return null;

  const parts: string[] = [];
  if (running > 0) parts.push(`${running} em produção`);
  if (pending > 0) parts.push(`${pending} pendente${pending > 1 ? "s" : ""}`);
  if (failed > 0) parts.push(`${failed} com falha`);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
      {failed > 0 ? (
        <TriangleAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
      ) : running > 0 ? (
        <Loader2 className="h-4 w-4 animate-spin text-amber-600 dark:text-amber-400" />
      ) : (
        <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400" />
      )}
      <span className="text-xs font-medium">
        {total} peça{total > 1 ? "s" : ""} sem legenda
        <span className="ml-1 font-normal text-muted-foreground">({parts.join(" · ")})</span>
      </span>
      <span className="hidden text-[11px] text-muted-foreground sm:inline">
        A escrita continua sozinha em segundo plano.
      </span>
      <Button
        size="sm"
        variant="outline"
        className="ml-auto h-7 gap-1.5 text-xs"
        disabled={retry.isPending}
        onClick={() => retry.mutate()}
      >
        {retry.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        Gerar legendas pendentes
      </Button>
    </div>
  );
}
