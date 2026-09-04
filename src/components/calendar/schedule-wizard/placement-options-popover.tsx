import { Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  PLACEMENT_OPTION_DEFS,
  countPlacementOptions,
  optionsForDestination,
  type PlacementOptionKey,
  type PlacementOptions,
} from "@/lib/placement-options";
import type { PlacementFormat } from "@/lib/scheduling-formats";
import type { SocialChannel } from "@/lib/social-core/capabilities";
import { cn } from "@/lib/utils";

/**
 * Opções avançadas do destino (canal + formato) — só aparece quando o destino
 * tem opções na matriz oficial. Puramente de apresentação: o pai guarda o
 * estado e o servidor normaliza/aplica.
 */
export function PlacementOptionsPopover({
  channel,
  format,
  value,
  onChange,
}: {
  channel: SocialChannel;
  format: PlacementFormat;
  value: PlacementOptions;
  onChange: (next: PlacementOptions) => void;
}) {
  const keys = optionsForDestination(channel, format);
  if (!keys.length) return null;
  const count = countPlacementOptions(value);

  const set = (key: PlacementOptionKey, next: unknown) => {
    const draft: Record<string, unknown> = { ...value };
    if (next === "" || next === undefined || (Array.isArray(next) && next.length === 0)) {
      delete draft[key];
    } else {
      draft[key] = next;
    }
    onChange(draft as PlacementOptions);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Opções avançadas deste destino"
          className={cn(
            "inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground",
            count > 0 && "text-foreground",
          )}
        >
          <Settings2 className="h-3 w-3" />
          {count > 0 ? (
            <Badge variant="outline" className="h-4 border-none bg-muted px-1 text-[9px]">
              {count}
            </Badge>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] p-3">
        <div className="mb-2">
          <p className="text-xs font-semibold capitalize">
            Opções · {channel} {format}
          </p>
          <p className="text-[10.5px] text-muted-foreground">
            Só aparecem as opções válidas para este destino.
          </p>
        </div>
        <div className="max-h-[340px] space-y-3 overflow-y-auto pr-1">
          {keys.map((key) => {
            const def = PLACEMENT_OPTION_DEFS[key];
            const raw = (value as Record<string, unknown>)[key];
            return (
              <div key={key} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-[11px]">{def.label}</Label>
                  {def.apiApplied ? null : (
                    <Badge
                      variant="outline"
                      className="h-4 border-none bg-muted px-1 text-[9px] text-muted-foreground"
                    >
                      anotação
                    </Badge>
                  )}
                </div>
                {def.kind === "boolean" ? (
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={raw === true}
                      onCheckedChange={(c) => set(key, c ? true : "")}
                    />
                    <span className="text-[10.5px] text-muted-foreground">{def.hint}</span>
                  </div>
                ) : def.kind === "list" ? (
                  <>
                    <Input
                      className="h-8 text-xs"
                      placeholder={def.placeholder}
                      value={Array.isArray(raw) ? (raw as string[]).join(", ") : ""}
                      onChange={(e) =>
                        set(
                          key,
                          e.target.value
                            .split(",")
                            .map((v) => v.trim())
                            .filter(Boolean),
                        )
                      }
                    />
                    <p className="text-[10px] text-muted-foreground">
                      {def.hint} Separe por vírgula.
                    </p>
                  </>
                ) : key === "firstComment" ? (
                  <>
                    <Textarea
                      className="min-h-[64px] text-xs"
                      placeholder={def.placeholder}
                      maxLength={def.maxLength}
                      value={typeof raw === "string" ? raw : ""}
                      onChange={(e) => set(key, e.target.value)}
                    />
                    <p className="text-[10px] text-muted-foreground">{def.hint}</p>
                  </>
                ) : (
                  <>
                    <Input
                      className="h-8 text-xs"
                      placeholder={def.placeholder}
                      maxLength={def.maxLength}
                      value={typeof raw === "string" ? raw : ""}
                      onChange={(e) => set(key, e.target.value)}
                    />
                    <p className="text-[10px] text-muted-foreground">{def.hint}</p>
                  </>
                )}
              </div>
            );
          })}
        </div>
        {count > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 h-7 w-full text-[11px]"
            onClick={() => onChange({})}
          >
            Limpar opções deste destino
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
