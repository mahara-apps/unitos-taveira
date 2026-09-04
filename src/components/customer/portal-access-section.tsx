import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, KeyRound, Loader2, RefreshCw, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  createPortalAccountFn,
  getPortalAccountFn,
  resetPortalAccountPasswordFn,
} from "@/lib/portal-accounts.functions";

const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR") : null;

/**
 * Fase C — "Acesso por login" dentro do card Portal do cliente.
 * O link por token continua funcionando em paralelo; esta seção só adiciona.
 * A senha provisória aparece uma única vez, no retorno da criação/reset.
 */
export function PortalAccessSection({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const load = useServerFn(getPortalAccountFn);
  const create = useServerFn(createPortalAccountFn);
  const resetPwd = useServerFn(resetPortalAccountPasswordFn);

  const [email, setEmail] = useState("");
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);

  const accountQ = useQuery({
    queryKey: ["portal-account", clientId],
    queryFn: () => load({ data: { clientId } }),
    staleTime: 30_000,
  });
  const acc = accountQ.data;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["portal-account", clientId] });

  const createMut = useMutation({
    mutationFn: (mail: string | undefined) =>
      create({ data: { clientId, ...(mail ? { email: mail } : {}) } }),
    onSuccess: (res) => {
      setSecret({ email: res.email, password: res.tempPassword });
      setEmail("");
      toast.success("Acesso criado.", { description: "Copie a senha provisória agora." });
      invalidate();
    },
    onError: (e: Error) => toast.error("Falha ao criar acesso", { description: e.message }),
  });

  const resetMut = useMutation({
    mutationFn: () => resetPwd({ data: { clientId } }),
    onSuccess: (res) => {
      setSecret({ email: res.email, password: res.tempPassword });
      toast.success("Nova senha provisória gerada.");
      invalidate();
    },
    onError: (e: Error) => toast.error("Falha ao gerar senha", { description: e.message }),
  });

  const copySecret = () => {
    if (!secret) return;
    navigator.clipboard.writeText(`E-mail: ${secret.email}\nSenha provisória: ${secret.password}`);
    toast.success("Credenciais copiadas.");
  };

  return (
    <div className="space-y-3 border-t border-border/60 px-6 pb-6 pt-4">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Acesso por login</span>
        {accountQ.isLoading ? null : acc?.state === "active" ? (
          <Badge className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-600">
            Conta ativa
          </Badge>
        ) : acc?.state === "pending_password" ? (
          <Badge className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-600">
            Senha pendente de troca
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">
            Sem conta
          </Badge>
        )}
      </div>

      {accountQ.isLoading ? (
        <Skeleton className="h-20 w-full rounded-lg" />
      ) : acc && acc.state !== "none" ? (
        <>
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs">
            <div className="font-medium">{acc.fullName ?? "Contato do cliente"}</div>
            <div className="mt-0.5 break-all font-mono">{acc.email}</div>
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              {acc.lastSeenAt ? `Último acesso ${fmtDateTime(acc.lastSeenAt)}` : "Nunca acessou"}
              {acc.createdAt ? ` · criado em ${fmtDateTime(acc.createdAt)}` : ""}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={resetMut.isPending}
            onClick={() => {
              if (!window.confirm("Gerar nova senha provisória? A senha atual deixa de funcionar."))
                return;
              resetMut.mutate();
            }}
          >
            {resetMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Nova senha provisória
          </Button>
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Cria uma conta para o contato do cliente acessar o portal com e-mail e senha, sem
            depender do link. O link por token continua funcionando.
          </p>
          {acc?.suggestedEmail ? (
            <p className="text-xs">
              E-mail do cadastro: <span className="font-mono">{acc.suggestedEmail}</span>
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor={`portal-email-${clientId}`} className="text-xs">
                E-mail do contato (o cadastro atual não serve para criar conta)
              </Label>
              <Input
                id={`portal-email-${clientId}`}
                type="email"
                placeholder="contato@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          )}
          <Button
            size="sm"
            className="gap-1.5"
            disabled={createMut.isPending || (!acc?.suggestedEmail && !email.trim())}
            onClick={() => createMut.mutate(email.trim() || undefined)}
          >
            {createMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <UserPlus className="h-3.5 w-3.5" />
            )}
            Criar acesso
          </Button>
        </div>
      )}

      {secret && (
        <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
          <div className="text-[11px] font-medium text-amber-600">
            Senha provisória — visível só agora. Copie e envie ao cliente por canal seguro.
          </div>
          <div className="break-all font-mono text-xs">
            {secret.email}
            <br />
            {secret.password}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={copySecret}>
              <Copy className="h-3.5 w-3.5" />
              Copiar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>
              Já copiei
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
