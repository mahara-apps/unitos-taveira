import { Fragment } from "react";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MODULE_GROUPS,
  MODULE_LEVEL_HINT,
  MODULE_LEVEL_LABEL,
  MODULES,
  levelsForModule,
  type ModuleKey,
  type ModuleLevel,
  type PartialModulePermissions,
} from "@/lib/module-permissions";

/**
 * Editor da matriz de permissões por módulo. Puramente visual: recebe o mapa
 * atual e devolve alterações. Quem autoriza é o servidor.
 */
export function ModulePermissionsEditor({
  value,
  onChange,
  disabled = false,
  /** Mapa do perfil selecionado — usado para sinalizar ajustes individuais. */
  baseline,
}: {
  value: PartialModulePermissions;
  onChange: (moduleKey: ModuleKey, level: ModuleLevel) => void;
  disabled?: boolean;
  baseline?: PartialModulePermissions;
}) {
  return (
    <div className="divide-y divide-border/60 rounded-lg border border-border/60">
      {MODULE_GROUPS.map((group) => {
        const items = MODULES.filter((m) => m.group === group);
        if (items.length === 0) return null;
        return (
          <Fragment key={group}>
            <div className="bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {group}
            </div>
            {items.map((m) => {
              const level = value[m.key] ?? "none";
              const changed = baseline ? (baseline[m.key] ?? "none") !== level : false;
              return (
                <div
                  key={m.key}
                  className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_220px_minmax(0,1.2fr)] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Label className="truncate text-sm font-medium">{m.label}</Label>
                      {changed ? (
                        <Badge variant="secondary" className="h-5 shrink-0 text-[10px]">
                          ajustado
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{m.description}</p>
                  </div>
                  <Select
                    value={level}
                    onValueChange={(v) => onChange(m.key, v as ModuleLevel)}
                    disabled={disabled}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {levelsForModule(m.key).map((lv) => (
                        <SelectItem key={lv} value={lv}>
                          {MODULE_LEVEL_LABEL[lv]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {MODULE_LEVEL_HINT[level]}
                  </p>
                </div>
              );
            })}
          </Fragment>
        );
      })}
    </div>
  );
}
