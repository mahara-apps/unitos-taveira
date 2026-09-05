/** Pilha de avatares sobrepostos — leitura rápida de quem está envolvido. */
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { optionName, type TeamOption } from "./assignee-picker";
import { initialsOf } from "@/lib/identity";

export function AvatarStack({
  people,
  max = 5,
  className,
}: {
  people: TeamOption[];
  max?: number;
  className?: string;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className={cn("flex items-center", className)}>
      {shown.map((p) => (
        <Avatar
          key={p.user_id}
          className="-ml-1.5 h-7 w-7 ring-2 ring-background first:ml-0"
          title={optionName(p)}
        >
          {p.avatar_url ? <AvatarImage src={p.avatar_url} alt="" /> : null}
          <AvatarFallback className="text-[9px]">{initialsOf({ full_name: p.full_name, email: p.email ?? null })}</AvatarFallback>
        </Avatar>
      ))}
      {rest > 0 ? (
        <span className="-ml-1.5 grid h-7 w-7 place-items-center rounded-full border border-border/60 bg-muted text-[10px] font-medium tabular-nums ring-2 ring-background">
          +{rest}
        </span>
      ) : null}
      {people.length === 0 ? (
        <span className="text-xs text-muted-foreground">Ninguém envolvido</span>
      ) : null}
    </span>
  );
}
