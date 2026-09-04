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

export type TeamOption = {
  user_id: string;
  full_name: string | null;
  avatar_url?: string | null;
};

const NONE = "__none__";

export function initialsOf(name: string | null | undefined) {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function AssigneePicker({
  value,
  options,
  onChange,
  disabled,
  placeholder = "Sem responsável",
  className = "h-8 w-[190px]",
}: {
  value: string | null;
  options: TeamOption[];
  onChange: (userId: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
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
                <AvatarFallback className="text-[9px]">{initialsOf(o.full_name)}</AvatarFallback>
              </Avatar>
              <span className="truncate">{o.full_name ?? "Usuário"}</span>
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
    <Avatar className={className} title={person?.full_name ?? "Responsável"}>
      {person?.avatar_url ? <AvatarImage src={person.avatar_url} alt="" /> : null}
      <AvatarFallback className="text-[9px]">{initialsOf(person?.full_name)}</AvatarFallback>
    </Avatar>
  );
}
