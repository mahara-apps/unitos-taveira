import type { ReactNode } from "react";
import { StatCard, type StatCardTone } from "@/components/ui/stat-card";

/**
 * SettingsStatCard — adaptador fino para o `StatCard` canônico do
 * DESIGN_SYSTEM.md. Mantém a API histórica das telas de configurações
 * (`label`, `value`, `hint`, `icon`, `tone`) e delega toda a apresentação
 * ao primitivo compartilhado.
 *
 * Ao contrário da versão anterior, NÃO aceita `className` para colorir o
 * valor: a cor semântica é comunicada exclusivamente pelo `tone` (barra
 * superior + chip do ícone), conforme a regra "uma cor = um significado
 * por tela".
 */
export function SettingsStatCard({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: StatCardTone;
}) {
  return (
    <StatCard label={label} value={value as number | string} sub={hint} icon={icon} tone={tone} />
  );
}
