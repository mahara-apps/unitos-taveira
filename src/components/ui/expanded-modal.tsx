"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * ExpandedModal — modal centralizado largo, substituto do padrão Sheet lateral.
 *
 * Construído sobre os primitivos Radix (e não sobre `DialogContent` do shadcn)
 * porque `DialogContent` já injeta overlay, `p-6` e um botão X absoluto, o que
 * duplicaria o X e conflitaria com header/footer fixos.
 *
 * Comportamento de fechamento intencionalmente idêntico ao Sheet anterior:
 * overlay, Esc e botão X. Sem guarda de "alterações não salvas".
 */

/**
 * Tamanhos espelham 1:1 as larguras dos Sheets que substituem.
 * NÃO alargar um size existente nem adicionar novos sem aprovação explícita.
 */
export const EXPANDED_MODAL_SIZES = {
  /** 448px — NotificationsDrawer, ManageSheet (canal social). */
  xs: "sm:max-w-md",
  /** 520px — CreateTaskDialog, AddMemberDrawer, QuickCreateCustomerDrawer, PersonaDrawer (Sheet original: 512px). */
  sm: "sm:max-w-[520px]",
  /** 640px — TaskDialog, TaskDrawer, TaskTimesheetSheet. */
  md: "sm:max-w-[640px]",
  /** 720px — AiReadingDrawer (documentos). */
  lg: "sm:max-w-[720px]",
  /** 672px — StrategyHistory run viewer. */
  xl: "sm:max-w-2xl",
  /**
   * 800px — EXCEÇÃO DOCUMENTADA, exclusiva do AgentDrawer.
   * O Sheet original tinha 672px, mas o conteúdo combina abas + editor de
   * prompt + playground de teste lado a lado, que ficam apertados em 672px
   * num modal centralizado. Aprovado caso a caso.
   * NÃO usar como precedente para alargar outros drawers em migrações futuras.
   */
  "xl-agent": "sm:max-w-[800px]",
  /** Quase tela cheia — ScheduleWizard. */
  full: "sm:max-w-[1400px] sm:w-[calc(100vw-4rem)]",
  /**
   * 1296px — Composer de publicação (ScheduleWizard).
   * Workspace compacto de 2 colunas (edição + preview/agenda). Aprovado
   * caso a caso para substituir a tela cheia anterior, que ocupava toda a
   * área disponível e exibia informação demais ao mesmo tempo.
   */
  composer: "sm:max-w-[1296px]",
} as const;

export type ExpandedModalSize = keyof typeof EXPANDED_MODAL_SIZES;

export type ExpandedModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Obrigatório para a11y do Radix; use `hideTitle` para esconder visualmente. */
  title: React.ReactNode;
  description?: React.ReactNode;
  hideTitle?: boolean;
  size?: ExpandedModalSize;
  /** Slot à direita do título, antes do X (badges, ações rápidas). */
  headerExtra?: React.ReactNode;
  /** Rodapé fixo opcional. Sem ele, nenhuma borda de rodapé é renderizada. */
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Override do corpo. Use `p-0 overflow-hidden` para abas full-bleed. */
  bodyClassName?: string;
  headerClassName?: string;
  footerClassName?: string;
  /**
   * Eleva o empilhamento quando este modal abre POR CIMA de outro modal.
   * Overlay/content padrão ficam em z-50 (igual Dialog/AlertDialog do projeto).
   */
  nested?: boolean;
};

export const ExpandedModal = React.forwardRef<HTMLDivElement, ExpandedModalProps>(
  function ExpandedModal(
    {
      open,
      onOpenChange,
      title,
      description,
      hideTitle,
      size = "md",
      headerExtra,
      footer,
      children,
      className,
      bodyClassName,
      headerClassName,
      footerClassName,
      nested,
    },
    ref,
  ) {
    const layer = nested ? "z-[60]" : "z-50";

    return (
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className={cn(
              "fixed inset-0 bg-black/80 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
              layer,
            )}
          />
          <DialogPrimitive.Content
            ref={ref}
            className={cn(
              // Mobile: ocupa quase a tela inteira, centralizado (nunca bottom sheet).
              // 100dvh evita estouro com a barra de endereço no Safari iOS.
              "fixed left-1/2 top-1/2 flex h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border/60 bg-background shadow-lg outline-none",
              "duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
              // Desktop: altura confortável e largura por porte.
              "sm:h-[calc(100dvh-4rem)] sm:max-h-[calc(100dvh-4rem)] sm:w-full",
              EXPANDED_MODAL_SIZES[size],
              layer,
              className,
            )}
          >
            <header
              className={cn(
                "flex shrink-0 items-start gap-3 border-b border-border/60 px-6 py-4",
                headerClassName,
              )}
            >
              <div className={cn("min-w-0 flex-1 space-y-1", hideTitle && "sr-only")}>
                <DialogPrimitive.Title className="truncate text-base font-semibold leading-tight tracking-tight">
                  {title}
                </DialogPrimitive.Title>
                {/* Description sempre presente (sr-only quando ausente) para
                    satisfazer o requisito de a11y do Radix. */}
                <DialogPrimitive.Description
                  className={cn("text-xs text-muted-foreground", !description && "sr-only")}
                >
                  {description ?? title}
                </DialogPrimitive.Description>
              </div>
              {headerExtra ? (
                <div className="flex shrink-0 items-center gap-2">{headerExtra}</div>
              ) : null}
              <DialogPrimitive.Close className="shrink-0 cursor-pointer rounded-sm p-1 text-muted-foreground opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
                <X className="h-4 w-4" />
                <span className="sr-only">Fechar</span>
              </DialogPrimitive.Close>
            </header>

            <div className={cn("flex-1 overflow-y-auto px-6 py-5", bodyClassName)}>{children}</div>

            {footer ? (
              <footer
                className={cn(
                  "flex shrink-0 flex-col-reverse gap-2 border-t border-border/60 bg-background/95 px-6 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-end",
                  footerClassName,
                )}
              >
                {footer}
              </footer>
            ) : null}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  },
);

/**
 * Corpo com abas full-bleed: passe como `bodyClassName` quando o filho for
 * um `<Tabs>` que precisa de `TabsList` fixa e `TabsContent` com scroll próprio.
 */
export const EXPANDED_MODAL_TABS_BODY = "flex flex-col overflow-hidden p-0";
