/**
 * Matriz compacta Unidade × Rede do painel lateral do projeto.
 * Quando o projeto não tem unidades informadas, agrupa tudo em "Geral" e
 * explica a ausência — nada é inventado.
 */
import { Badge } from "@/components/ui/badge";
import { unitChipClass } from "@/lib/content-stage-tokens";
import { cn } from "@/lib/utils";

export function UnitNetworkMatrix({
  items,
}: {
  items: Array<{ unitLabel: string | null; channelLabel: string | null }>;
}) {
  const hasUnits = items.some((i) => !!i.unitLabel);
  const rows = Array.from(new Set(items.map((i) => i.unitLabel ?? "Geral"))).sort();
  const cols = Array.from(new Set(items.map((i) => i.channelLabel ?? "Sem rede"))).sort();
  const count = (r: string, c: string) =>
    items.filter((i) => (i.unitLabel ?? "Geral") === r && (i.channelLabel ?? "Sem rede") === c)
      .length;

  if (items.length === 0) {
    return (
      <p className="px-4 py-3 text-[11px] text-muted-foreground">
        Sem itens de conteúdo para distribuir por rede.
      </p>
    );
  }

  return (
    <div className="space-y-2 px-4 py-3">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="pb-1.5 text-left text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Unidade
              </th>
              {cols.map((c) => (
                <th
                  key={c}
                  className="pb-1.5 pl-2 text-left text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r} className="border-t border-border/60">
                <td className="py-1.5 pr-2">
                  <Badge
                    variant="outline"
                    className={cn("h-5 rounded-full px-2 text-[10px]", unitChipClass(r))}
                  >
                    {r}
                  </Badge>
                </td>
                {cols.map((c) => (
                  <td key={c} className="py-1.5 pl-2 tabular-nums text-muted-foreground">
                    {count(r, c) || "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!hasUnits ? (
        <p className="text-[11px] text-muted-foreground">
          Este projeto não separa os itens por unidade, então tudo aparece como “Geral”.
        </p>
      ) : null}
    </div>
  );
}
