import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, Settings2, ShieldCheck, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientAccessWizard } from "@/components/customer/client-access-wizard";
import { listPortalContactsFn } from "@/lib/portal-accounts.functions";
import { getPortalAccessConfigFn } from "@/lib/portal-config.functions";
import { PORTAL_MODULES, PORTAL_PERMISSION_LABEL } from "@/lib/portal-permissions";

/**
 * Resumo do acesso do cliente ao portal (login e senha). A criação e a
 * configuração acontecem no assistente `ClientAccessWizard` — aqui só o estado
 * atual e a entrada para o assistente.
 */
export function PortalAccessSection({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const listContacts = useServerFn(listPortalContactsFn);
  const loadConfig = useServerFn(getPortalAccessConfigFn);

  const contactsQ = useQuery({
    queryKey: ["portal-contacts", clientId],
    queryFn: () => listContacts({ data: { clientId } }),
    staleTime: 30_000,
  });
  const configQ = useQuery({
    queryKey: ["portal-access-config", clientId],
    queryFn: () => loadConfig({ data: { clientId } }),
    staleTime: 30_000,
  });

  const contacts = contactsQ.data?.contacts ?? [];
  const pending = contacts.filter((c) => c.state === "pending_password").length;
  const permissions = configQ.data?.permissions;
  const activeModules = permissions
    ? PORTAL_MODULES.filter((m) => permissions[m.id] !== "none")
    : [];

  return (
    <div className="space-y-3 rounded-xl border border-primary/25 bg-primary/[0.04] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 shrink-0 text-primary" />
            <span className="text-sm font-semibold">Acesso do cliente (login e senha)</span>
            {contactsQ.isLoading ? null : (
              <Badge variant="outline" className="text-[10px]">
                {contacts.length} {contacts.length === 1 ? "contato" : "contatos"}
              </Badge>
            )}
            {pending > 0 && (
              <Badge className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-600">
                {pending} com senha pendente
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            O cliente entra pela mesma tela de login do sistema e cai direto na área dele.
          </p>
        </div>
        <Button size="sm" className="shrink-0 gap-1.5" onClick={() => setOpen(true)}>
          {contacts.length === 0 ? (
            <>
              <UserPlus className="h-3.5 w-3.5" /> Criar acesso
            </>
          ) : (
            <>
              <Settings2 className="h-3.5 w-3.5" /> Gerenciar acesso
            </>
          )}
        </Button>
      </div>

      {contactsQ.isLoading ? (
        <Skeleton className="h-10 w-full rounded-lg" />
      ) : contacts.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum contato com login ainda — o assistente cria em 3 passos: contatos, atendimento e
          permissões.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {contacts.slice(0, 6).map((c) => (
            <li
              key={c.userId}
              className="rounded-full border border-border/60 bg-background px-2.5 py-1 font-mono text-[11px]"
            >
              {c.email}
            </li>
          ))}
          {contacts.length > 6 && (
            <li className="px-2 py-1 text-[11px] text-muted-foreground">
              +{contacts.length - 6}
            </li>
          )}
        </ul>
      )}

      {permissions && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          {activeModules.length === 0 ? (
            <span>Nada liberado no portal.</span>
          ) : (
            activeModules.map((m) => (
              <Badge key={m.id} variant="outline" className="text-[10px]">
                {m.label} · {PORTAL_PERMISSION_LABEL[permissions[m.id]].toLowerCase()}
              </Badge>
            ))
          )}
        </div>
      )}

      <ClientAccessWizard
        open={open}
        onOpenChange={setOpen}
        clientId={clientId}
        {...(clientName ? { clientName } : {})}
      />
    </div>
  );
}
