/**
 * Dupla confirmação para AÇÕES CRÍTICAS (nível master e exclusões).
 *
 * Padrão único do sistema: nenhuma ação de risco executa com um clique. O botão
 * só habilita quando o nome exato do alvo é digitado. A autorização real
 * continua na RLS/server function — aqui é proteção contra clique acidental.
 */
import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { matchesConfirmLabel } from "@/lib/critical-actions";
import { cn } from "@/lib/utils";

export type CriticalConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Verbo real da ação: "Excluir cliente", "Atualizar instalação". */
  title: string;
  /** O que muda / o que se perde. */
  impact: ReactNode;
  /** Texto exato que o usuário precisa digitar (nome do alvo). */
  confirmText: string;
  /** Rótulo do campo. Padrão: "Digite o nome exato para confirmar". */
  fieldLabel?: string;
  /** Rótulo do botão de ação. */
  actionLabel?: string;
  irreversible?: boolean;
  pending?: boolean;
  /** Linhas de contexto extra (ex.: versão atual → versão de destino). */
  details?: { label: string; value: ReactNode }[];
  onConfirm: () => void | Promise<void>;
};

export function CriticalConfirmDialog({
  open,
  onOpenChange,
  title,
  impact,
  confirmText,
  fieldLabel,
  actionLabel,
  irreversible = false,
  pending = false,
  details,
  onConfirm,
}: CriticalConfirmDialogProps) {
  const [typed, setTyped] = useState("");

  // Fechar/reabrir sempre limpa o texto digitado.
  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const valid = matchesConfirmLabel(typed, confirmText);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 shrink-0 text-destructive" aria-hidden />
            <span className="min-w-0 break-words">{title}</span>
          </DialogTitle>
          <DialogDescription>
            Ação crítica: exige confirmação por escrito e fica registrada no histórico.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            className={cn(
              "rounded-lg border p-3 text-sm",
              irreversible
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-amber-500/40 bg-amber-500/10 text-foreground",
            )}
          >
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0">
                {impact}
                {irreversible ? (
                  <strong className="mt-1 block">
                    Esta ação é irreversível e os dados não poderão ser recuperados.
                  </strong>
                ) : null}
              </span>
            </p>
          </div>

          {details && details.length > 0 ? (
            <dl className="space-y-1.5 rounded-lg border bg-muted/40 p-3 text-sm">
              {details.map((d) => (
                <div key={d.label} className="flex items-start justify-between gap-3">
                  <dt className="text-muted-foreground">{d.label}</dt>
                  <dd className="min-w-0 break-words text-right font-medium">{d.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="critical-confirm-input">
              {fieldLabel ?? "Digite o nome exato para confirmar"}
            </Label>
            <p className="truncate text-xs text-muted-foreground" title={confirmText}>
              <code className="rounded bg-muted px-1 py-0.5">{confirmText}</code>
            </p>
            <Input
              id="critical-confirm-input"
              value={typed}
              autoComplete="off"
              disabled={pending}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={confirmText}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={!valid || pending}
            onClick={() => void onConfirm()}
          >
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            {actionLabel ?? title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
