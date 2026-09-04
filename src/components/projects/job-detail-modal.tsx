/**
 * Modal amplo do JOB — mesma anatomia da referência de gestão de projetos:
 *   [Concluir] [responsável] [datas] [status] ⋮ ✕
 *   Título                                    Cliente › Projeto
 *   ┌ tarefas / briefing ──────┬ abas de contexto ┐
 * Componente apenas de apresentação: conteúdo e ações vêm por slots.
 */
import type { ReactNode } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export function JobDetailModal({
  open,
  onOpenChange,
  title,
  breadcrumb,
  done = false,
  onToggleDone,
  controls,
  menu,
  main,
  aside,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  breadcrumb?: ReactNode;
  done?: boolean;
  onToggleDone?: () => void;
  /** Responsável, status e datas. */
  controls?: ReactNode;
  menu?: ReactNode;
  main: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-h-[90vh] w-[min(1200px,96vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogTitle className="sr-only">{title}</DialogTitle>

        {/* Barra de ações */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/40 px-5 py-3 pr-14">
          {onToggleDone ? (
            <Button
              size="sm"
              variant={done ? "secondary" : "default"}
              className="h-9 gap-1.5 rounded-full px-4"
              onClick={onToggleDone}
            >
              {done ? (
                <>
                  <RotateCcw className="h-3.5 w-3.5" /> Reabrir
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Concluir
                </>
              )}
            </Button>
          ) : null}
          {controls}
          <div className="ml-auto flex items-center gap-1">{menu}</div>
        </div>

        {/* Título + trilha */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-4 sm:flex sm:justify-between">
          <h2 className="truncate text-xl font-semibold leading-tight sm:text-2xl">{title}</h2>
          {breadcrumb ? (
            <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              {breadcrumb}
            </div>
          ) : null}
        </div>

        {/* Corpo em duas colunas */}
        <div className="grid min-h-0 flex-1 grid-cols-1 border-t border-border/60 lg:grid-cols-[minmax(0,1fr)_min(600px,45vw)]">
          <div className="min-h-0 min-w-0 overflow-y-auto lg:border-r lg:border-border/60">
            {main}
          </div>
          {aside ? <div className="flex min-h-0 min-w-0 flex-col lg:pl-8">{aside}</div> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
