/**
 * Identidade das pessoas — fonte única de nome/e-mail exibidos no sistema.
 *
 * O banco guarda `full_name` (pode ser nulo) e `email` em `public.user_profiles`.
 * Nunca exibir o e-mail cru como nome: quando falta nome, derivamos algo
 * apresentável a partir do trecho antes do `@`.
 */

export type IdentityLike = {
  full_name?: string | null;
  fullName?: string | null;
  name?: string | null;
  email?: string | null;
};

const TEST_DOMAINS = /@(unitos-tests\.dev|unitos-qa\.test)$/i;

/** Verdadeiro para contas geradas pelos testes automatizados. */
export function isTestIdentity(email?: string | null): boolean {
  return Boolean(email && TEST_DOMAINS.test(email.trim()));
}

function titleCase(word: string): string {
  if (!word) return word;
  const lower = word.toLocaleLowerCase("pt-BR");
  return lower.charAt(0).toLocaleUpperCase("pt-BR") + lower.slice(1);
}

/**
 * Nome apresentável derivado do e-mail: `joao.silva+tag@x.com` → "João Silva".
 * Remove sufixos técnicos (`+algo`), hashes e números soltos.
 */
export function nameFromEmail(email?: string | null): string | null {
  const local = (email ?? "").split("@")[0]?.trim();
  if (!local) return null;
  const cleaned = local
    .split("+")[0]!
    .replace(/[._-]+/g, " ")
    .replace(/\b[0-9a-f]{6,}\b/gi, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.split(" ").map(titleCase).join(" ");
}

/** Nome a exibir, na ordem: nome informado → derivado do e-mail → "Sem nome". */
export function displayName(person?: IdentityLike | null, fallback = "Sem nome"): string {
  const given =
    person?.full_name?.trim() || person?.fullName?.trim() || person?.name?.trim() || "";
  if (given) return given;
  return nameFromEmail(person?.email) ?? fallback;
}

/** "Nome · email@dominio" — usado em listas onde há homônimos. */
export function identityLabel(person?: IdentityLike | null): string {
  const name = displayName(person);
  const email = person?.email?.trim();
  return email ? `${name} · ${email}` : name;
}

/** Iniciais (máx. 2 letras) do nome exibido. */
export function initialsOf(person?: IdentityLike | string | null): string {
  const name = typeof person === "string" ? person : displayName(person, "");
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  const out = parts.map((p) => p[0]?.toLocaleUpperCase("pt-BR") ?? "").join("");
  return out || "?";
}

/** Verdadeiro quando a pessoa ainda precisa informar o nome real. */
export function needsRealName(person?: IdentityLike | null): boolean {
  const given = person?.full_name?.trim() || person?.fullName?.trim() || "";
  return given.length < 3 || !/\s/.test(given);
}
