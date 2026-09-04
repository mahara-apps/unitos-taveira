/**
 * Painel de contexto com abas — usado igual nos três níveis
 * (projeto, job, tarefa): Comentários · Anexos/Links · Timesheet · Histórico.
 * Apenas apresentação: o conteúdo de cada aba vem por slot.
 */
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type ContextTab = {
  value: string;
  label: string;
  content: ReactNode;
};

export function ContextTabs({
  tabs,
  defaultValue,
  className,
  contentClassName,
}: {
  tabs: ContextTab[];
  defaultValue?: string;
  className?: string;
  contentClassName?: string;
}) {
  const visible = tabs.filter(Boolean);
  if (visible.length === 0) return null;

  return (
    <Tabs
      defaultValue={defaultValue ?? visible[0]!.value}
      className={cn("flex min-h-0 flex-col", className)}
    >
      <div className="border-b border-border/60 bg-background/40 px-4 pt-2.5">
        <TabsList className="h-auto w-full justify-start gap-1 bg-transparent p-0">
          {visible.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="rounded-none border-b-2 border-transparent bg-transparent px-3 pb-2 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {visible.map((t) => (
        <TabsContent
          key={t.value}
          value={t.value}
          className={cn("mt-0 min-h-0 flex-1 overflow-y-auto p-4", contentClassName)}
        >
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
