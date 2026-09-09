/**
 * Blocos de filtro reutilizados nos menus "⋯" dos três níveis (projeto, job, tarefa).
 * Apenas apresentação — a regra dos filtros vive em `src/lib/work-visibility.ts`.
 */
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  DUE_FILTERS,
  DUE_LABELS,
  VISIBILITY_FILTERS,
  VISIBILITY_LABELS,
  type DueFilter,
  type VisibilityFilter,
} from "@/lib/work-visibility";

export function VisibilityMenuBlock({
  value,
  onChange,
  label = "Exibir",
  withSeparator = true,
}: {
  value: VisibilityFilter;
  onChange: (v: VisibilityFilter) => void;
  label?: string;
  withSeparator?: boolean;
}) {
  return (
    <>
      {withSeparator ? <DropdownMenuSeparator /> : null}
      <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as VisibilityFilter)}>
        {VISIBILITY_FILTERS.map((f) => (
          <DropdownMenuRadioItem key={f} value={f} className="text-xs">
            {VISIBILITY_LABELS[f]}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}

export function DueMenuBlock({
  value,
  onChange,
  label = "Prazo",
  withSeparator = true,
}: {
  value: DueFilter;
  onChange: (v: DueFilter) => void;
  label?: string;
  withSeparator?: boolean;
}) {
  return (
    <>
      {withSeparator ? <DropdownMenuSeparator /> : null}
      <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as DueFilter)}>
        {DUE_FILTERS.map((f) => (
          <DropdownMenuRadioItem key={f} value={f} className="text-xs">
            {DUE_LABELS[f]}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}
