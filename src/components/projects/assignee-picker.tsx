/**
 * Seletor de responsável: exatamente 1 usuário por projeto/job/tarefa.
 * A lista de opções vem da equipe da workspace (com destaque para envolvidos).
 */
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { displayName, initialsOf as identityInitials } from "@/lib/identity";
import { cn } from "@/lib/utils";

export type TeamOption = {
  user_id: string;
  full_name: string | null;
  email?: string | null;
  avatar_url?: string | null;
};

const NONE = "__none__";

/** Reexport da identidade canônica (mantido para os imports existentes). */
export function initialsOf(name: string | null | undefined) {
  return identityInitials(name ?? null);
}

/** Nome exibido de uma opção de equipe. */
export function optionName(o: TeamOption) {
  return displayName({ full_name: o.full_name, email: o.email ?? null });
}

export function AssigneePicker({
  value,
  options,
  onChange,
  disabled,
  placeholder = "Sem responsável",
  className = "h-8 w-[190px]",
  compact = false,
}: {
  value: string | null;
  options: TeamOption[];
  onChange: (userId: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Só o avatar no gatilho (listas densas). O nome vem no tooltip nativo. */
  compact?: boolean;
}) {
  const current = value ? options.find((o) => o.user_id === value) : undefined;
  const currentLabel = current ? optionName(current) : placeholder;
  if (compact) {
    return (
      <Select
        value={value ?? NONE}
        disabled={disabled}
        onValueChange={(v) => onChange(v === NONE ? null : v)}
      >
        <SelectTrigger
          className={cn(
            "h-8 w-8 shrink-0 justify-center rounded-full border-none p-0 shadow-none focus:ring-1 [&>svg]:hidden",
            className,
          )}
          aria-label={`Responsável: ${currentLabel}`}
          title={currentLabel}
        >
          {current ? (
            <Avatar className="h-6 w-6">
              {current.avatar_url ? <AvatarImage src={current.avatar_url} alt="" /> : null}
              <AvatarFallback className="text-[9px]">
                {identityInitials({ full_name: current.full_name, email: current.email ?? null })}
              </AvatarFallback>
            </Avatar>
          ) : (
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-border text-[10px] text-muted-foreground">
              —
            </span>
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{placeholder}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.user_id} value={o.user_id}>
              <span className="flex items-center gap-2">
                <Avatar className="h-5 w-5">
                  {o.avatar_url ? <AvatarImage src={o.avatar_url} alt="" /> : null}
                  <AvatarFallback className="text-[9px]">
                    {identityInitials({ full_name: o.full_name, email: o.email ?? null })}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">{optionName(o)}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <Select
      value={value ?? NONE}
      disabled={disabled}
      onValueChange={(v) => onChange(v === NONE ? null : v)}
    >
      <SelectTrigger className={className} aria-label="Responsável">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{placeholder}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.user_id} value={o.user_id}>
            <span className="flex items-center gap-2">
              <Avatar className="h-5 w-5">
                {o.avatar_url ? <AvatarImage src={o.avatar_url} alt="" /> : null}
                <AvatarFallback className="text-[9px]">
                  {identityInitials({ full_name: o.full_name, email: o.email ?? null })}
                </AvatarFallback>
              </Avatar>
              <span className="truncate">{optionName(o)}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Avatar somente-leitura do responsável (usado em listas densas). */
export function AssigneeAvatar({
  userId,
  options,
  className = "h-6 w-6",
}: {
  userId: string | null;
  options: TeamOption[];
  className?: string;
}) {
  if (!userId) return null;
  const person = options.find((o) => o.user_id === userId);
  return (
    <Avatar className={className} title={person ? optionName(person) : "Responsável"}>
      {person?.avatar_url ? <AvatarImage src={person.avatar_url} alt="" /> : null}
      <AvatarFallback className="text-[9px]">
        {identityInitials(
          person ? { full_name: person.full_name, email: person.email ?? null } : null,
        )}
      </AvatarFallback>
    </Avatar>
  );
}
