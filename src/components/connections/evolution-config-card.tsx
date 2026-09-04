// Coluna "Evolution API": mostra apenas estado não sensível (URL + configurada
// sim/não). A chave nunca é exibida; a edição acontece em um modal dedicado e a
// credencial só trafega no momento da gravação.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Loader2, PlugZap, Server, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  saveEvolutionConfig,
  testEvolutionConnection,
  type EvolutionStatus,
} from "@/lib/evolution.functions";

export function EvolutionConfigCard({
  brandId,
  status,
  canManage,
}: {
  brandId: string;
  status: EvolutionStatus | undefined;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const testFn = useServerFn(testEvolutionConnection);
  const [open, setOpen] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["evolution-status", brandId] });
    qc.invalidateQueries({ queryKey: ["evolution-instances", brandId] });
  };

  const test = useMutation({
    mutationFn: () => testFn({ data: { brandId } }),
    onSuccess: (result) => {
      if (result.ok) toast.success("Conexão com a Evolution confirmada.");
      else toast.error(result.message ?? "Não foi possível falar com a Evolution.");
      invalidate();
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Falha ao testar a conexão."),
  });

  const configured = !!status?.configured;

  return (
    <div className="flex h-full flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Settings2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            Evolution API
          </p>
          <p className="text-[11px] text-muted-foreground">
            Servidor usado pelo WhatsApp deste workspace.
          </p>
        </div>
        <Badge
          variant="outline"
          className={
            configured
              ? "shrink-0 gap-1.5 border-health-good/40 bg-health-good/10 text-[10px] text-health-good"
              : "shrink-0 gap-1.5 text-[10px] text-muted-foreground"
          }
        >
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${configured ? "bg-health-good" : "bg-muted-foreground/60"}`}
          />
          {configured ? "Configurada" : "Não configurada"}
        </Badge>
      </div>

      <dl className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-3 text-[11px]">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <dt className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <Server className="h-3 w-3 shrink-0" /> Servidor
          </dt>
          <dd className="max-w-[60%] truncate font-mono">{status?.baseUrl || "—"}</dd>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <dt className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <KeyRound className="h-3 w-3 shrink-0" /> Credencial
          </dt>
          <dd className={status?.hasApiKey ? "text-health-good" : "text-muted-foreground"}>
            {status?.hasApiKey ? "✓ Configurada" : "Não configurada"}
          </dd>
        </div>
      </dl>

      <div className="mt-auto flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          disabled={!configured || test.isPending || !canManage}
          onClick={() => test.mutate()}
        >
          {test.isPending ? (
            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
          ) : (
            <PlugZap className="mr-1.5 h-3 w-3" />
          )}
          Testar conexão
        </Button>
        {canManage ? (
          <Button
            size="sm"
            variant={configured ? "ghost" : "default"}
            className="h-8 text-xs"
            onClick={() => setOpen(true)}
          >
            Configurar credenciais
          </Button>
        ) : null}
      </div>

      {!canManage ? (
        <p className="text-[11px] text-muted-foreground">
          Somente o ADMIN do workspace pode configurar a Evolution.
        </p>
      ) : null}

      <CredentialsDialog
        open={open}
        onOpenChange={setOpen}
        brandId={brandId}
        currentBaseUrl={status?.baseUrl ?? ""}
        hasApiKey={!!status?.hasApiKey}
        onSaved={invalidate}
      />
    </div>
  );
}

function CredentialsDialog({
  open,
  onOpenChange,
  brandId,
  currentBaseUrl,
  hasApiKey,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brandId: string;
  currentBaseUrl: string;
  hasApiKey: boolean;
  onSaved: () => void;
}) {
  const saveFn = useServerFn(saveEvolutionConfig);
  const [baseUrl, setBaseUrl] = useState(currentBaseUrl);
  const [apiKey, setApiKey] = useState("");

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          brandId,
          baseUrl: baseUrl.trim(),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        },
      }),
    onSuccess: () => {
      setApiKey("");
      onOpenChange(false);
      toast.success("Configuração da Evolution salva.");
      onSaved();
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Falha ao salvar a configuração."),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // A chave nunca fica em estado após fechar o modal.
        if (!v) setApiKey("");
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Credenciais da Evolution</DialogTitle>
          <DialogDescription>
            A chave é armazenada de forma cifrada no servidor e nunca é devolvida ao navegador.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="evo-base-url">Servidor / Base URL</Label>
            <Input
              id="evo-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://evolution.suaempresa.com"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="evo-api-key">API Key</Label>
            <Input
              id="evo-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasApiKey ? "Manter a credencial atual" : "Chave da Evolution"}
              autoComplete="off"
            />
            <p className="text-[11px] text-muted-foreground">
              {hasApiKey
                ? "Deixe em branco para manter a credencial já cadastrada."
                : "Informe a chave da sua instalação Evolution."}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            size="sm"
            disabled={baseUrl.trim().length < 4 || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
