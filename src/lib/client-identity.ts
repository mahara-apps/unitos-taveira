/**
 * Identidade do cliente ativo para o cabeçalho — resolvida a partir da lista de
 * clientes do workspace (já em cache do seletor), NUNCA de uma requisição.
 *
 * Regra: só devolve identidade quando o registro é EXATAMENTE do `clientId`
 * ativo. Nada do Cliente X pode aparecer enquanto Y está selecionado.
 */
export type ClientIdentity = { id: string; name: string; niche: string | null };

export function pickClientIdentity(
  clients: ReadonlyArray<{ id: string; name: string; niche?: string | null }> | undefined | null,
  clientId: string | null,
): ClientIdentity | null {
  if (!clientId || !clients) return null;
  const found = clients.find((c) => c.id === clientId);
  if (!found) return null;
  return { id: found.id, name: found.name, niche: found.niche ?? null };
}
