import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  MessageCircle,
  RefreshCw,
  Settings2,
  ShieldOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpandedModal } from "@/components/ui/expanded-modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getPortalLinkFn,
  revokePortalTokenFn,
  updatePortalTokenFn,
} from "@/lib/customer-dashboard.functions";
import { PortalThemeForm } from "@/components/customer/portal-theme-form";
import { PortalAccessSection } from "@/components/customer/portal-access-section";

const EXPIRY_OPTIONS = [
  { value: "never", label: "Sem expiração" },
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "60", label: "60 dias" },
  { value: "90", label: "90 dias" },
] as const;

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR") : null;
const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR") : null;

/**
 * Fase 2 — card único de gestão do link público do cliente.
 * Substitui o ClientPortalCard do dashboard: aqui fica a fonte única de
 * verdade (URL, copiar, WhatsApp, badge, último acesso, rotação/desligar).
 */
export function PortalLinkCard({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName?: string | null;
}) {
  const qc = useQueryClient();
  const load = useServerFn(getPortalLinkFn);
  const revoke = useServerFn(revokePortalTokenFn);
  const update = useServerFn(updatePortalTokenFn);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  const linkQ = useQuery({
    queryKey: ["portal-link", clientId],
    queryFn: () => load({ data: { clientId } }),
    staleTime: 30_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["portal-link", clientId] });
    qc.invalidateQueries({ queryKey: ["customer-dashboard"] });
    qc.invalidateQueries({ queryKey: ["brand-team"] });
  };

  const rotateMut = useMutation({
    mutationFn: (label: string) =>
      revoke({ data: { clientId, mode: "revokeAndCreate", label, expiresInDays: null } }),
    onSuccess: (res) => {
      toast.success("Novo link gerado.", {
        description:
          res.revokedCount > 0
            ? `${res.revokedCount} link(s) anterior(es) invalidado(s).`
            : undefined,
      });
      invalidate();
    },
    onError: (e: Error) => toast.error("Falha ao gerar link", { description: e.message }),
  });

  const shutdownMut = useMutation({
    mutationFn: () => revoke({ data: { clientId, mode: "revoke" } }),
    onSuccess: (res) => {
      toast.success("Portal desligado.", {
        description: `${res.revokedCount} link(s) invalidado(s). O cliente perdeu o acesso.`,
      });
      invalidate();
    },
    onError: (e: Error) => toast.error("Falha ao desligar portal", { description: e.message }),
  });

  const updateMut = useMutation({
    mutationFn: (vars: { tokenId: string; label: string; expiresInDays?: number | null }) =>
      update({ data: { clientId, ...vars } }),
    onSuccess: () => {
      toast.success("Personalização salva.");
      setCustomizeOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error("Falha ao salvar", { description: e.message }),
  });

  const active = linkQ.data?.active ?? null;
  const url =
    active && typeof window !== "undefined"
      ? `${window.location.origin}/portal/${active.token}`
      : "";
  const isExpired = active?.expires_at ? new Date(active.expires_at).getTime() < Date.now() : false;

  const copy = () => {
    navigator.clipboard.writeText(url);
    toast.success("Link copiado.");
  };
  const whatsapp = () => {
    const text = `Olá${clientName ? `, ${clientName}` : ""}! Este é o seu portal para acompanhar e aprovar os conteúdos: ${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noreferrer");
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4 text-muted-foreground" />
            Portal do cliente
            {linkQ.isLoading ? null : active && !isExpired ? (
              <Badge className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-600">
                Ativo
              </Badge>
            ) : active && isExpired ? (
              <Badge variant="outline" className="text-[10px]">
                Expirado
              </Badge>
            ) : (
              <Badge variant="destructive" className="text-[10px]">
                Revogado
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Acesso por login e senha para o cliente. O link sem senha é apenas acompanhamento
            (somente leitura).
          </CardDescription>
        </div>
        {active && (
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5"
            onClick={() => setCustomizeOpen(true)}
          >
            <Settings2 className="h-3.5 w-3.5" />
            Personalizar
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <PortalAccessSection
          clientId={clientId}
          {...(clientName ? { clientName } : {})}
        />

        <div className="border-t border-border/60 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Link de acompanhamento (sem senha, somente leitura)
        </div>

        {linkQ.isLoading ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : active ? (
          <>
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {active.label ?? "Portal do cliente"}
              </div>
              <div className="mt-0.5 break-all font-mono text-xs">{url}</div>
              <div className="mt-1.5 text-[11px] text-muted-foreground">
                {active.expires_at ? `Expira em ${fmtDate(active.expires_at)}` : "Sem expiração"}
                {" · "}
                {active.last_seen_at
                  ? `último acesso ${fmtDateTime(active.last_seen_at)}`
                  : "nunca acessado"}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={copy}>
                <Copy className="h-3.5 w-3.5" />
                Copiar link
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={whatsapp}>
                <MessageCircle className="h-3.5 w-3.5" />
                WhatsApp
              </Button>
              <a href={url} target="_blank" rel="noreferrer">
                <Button size="sm" variant="ghost" className="gap-1.5">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Abrir
                </Button>
              </a>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
              <Button
                size="sm"
                className="gap-1.5"
                disabled={rotateMut.isPending}
                onClick={() => {
                  if (
                    !window.confirm(
                      "Revogar o link atual e gerar um novo? O link antigo deixará de funcionar imediatamente.",
                    )
                  )
                    return;
                  rotateMut.mutate(active.label ?? "Portal do cliente");
                }}
              >
                {rotateMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Revogar e gerar novo
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-muted-foreground hover:text-destructive"
                disabled={shutdownMut.isPending}
                onClick={() => {
                  if (
                    !window.confirm(
                      "Desligar o portal deste cliente? Ele ficará sem nenhum link ativo até você gerar um novo.",
                    )
                  )
                    return;
                  shutdownMut.mutate();
                }}
              >
                <ShieldOff className="h-3.5 w-3.5" />
                Desligar portal
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Este cliente não tem link ativo
              {linkQ.data?.lastRevokedAt
                ? ` — último revogado em ${fmtDateTime(linkQ.data.lastRevokedAt)}.`
                : "."}
            </p>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={rotateMut.isPending}
              onClick={() => rotateMut.mutate("Portal do cliente")}
            >
              {rotateMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Link2 className="h-3.5 w-3.5" />
              )}
              Gerar link
            </Button>
          </div>
        )}
      </CardContent>

      {active && (
        <CustomizeModal
          open={customizeOpen}
          onOpenChange={setCustomizeOpen}
          clientId={clientId}
          initialLabel={active.label ?? "Portal do cliente"}
          expiresAt={active.expires_at}
          isSaving={updateMut.isPending}
          onSave={(label, expiresInDays) =>
            updateMut.mutate({ tokenId: active.id, label, expiresInDays })
          }
        />
      )}
    </Card>
  );
}

function CustomizeModal({
  open,
  onOpenChange,
  clientId,
  initialLabel,
  expiresAt,
  isSaving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  initialLabel: string;
  expiresAt: string | null;
  isSaving: boolean;
  onSave: (label: string, expiresInDays: number | null | undefined) => void;
}) {
  // "keep" só existe quando o link já tem prazo — evita zerar a validade sem intenção.
  const initialExpiry = expiresAt ? "keep" : "never";
  const [label, setLabel] = useState(initialLabel);
  const [expiry, setExpiry] = useState<string>(initialExpiry);

  useEffect(() => {
    if (!open) return;
    setLabel(initialLabel);
    setExpiry(initialExpiry);
  }, [open, initialLabel, initialExpiry]);

  return (
    <ExpandedModal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Personalizar portal"
      description="Rótulo interno, validade do link e identidade visual do portal."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancelar
          </Button>
          <Button
            disabled={isSaving || !label.trim()}
            onClick={() =>
              onSave(
                label.trim(),
                expiry === "keep" ? undefined : expiry === "never" ? null : Number(expiry),
              )
            }
          >
            {isSaving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Salvar
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="portal-label">Rótulo do link</Label>
          <Input
            id="portal-label"
            value={label}
            maxLength={80}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Portal do cliente"
          />
          <p className="text-[11px] text-muted-foreground">
            Uso interno — não aparece para o cliente.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Validade</Label>
          <Select value={expiry} onValueChange={setExpiry}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {expiresAt && (
                <SelectItem value="keep">Manter validade atual ({fmtDate(expiresAt)})</SelectItem>
              )}
              {EXPIRY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {expiresAt
              ? `Hoje expira em ${fmtDate(expiresAt)}. Escolher um prazo recalcula a partir de agora; "Sem expiração" remove o prazo.`
              : "Este link não expira — o padrão para links novos."}
          </p>
        </div>
        <PortalThemeForm clientId={clientId} />
      </div>
    </ExpandedModal>
  );
}
