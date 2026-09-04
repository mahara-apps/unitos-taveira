/**
 * Regras puras de transição do contexto ativo (workspace/cliente).
 *
 * Ficam isoladas aqui para serem testáveis e para que UI e contexto apliquem
 * exatamente a mesma regra. Nada aqui concede acesso: a autorização continua
 * no servidor (RLS/guards); estas funções apenas decidem o que permanece
 * selecionado na interface.
 */

/** Só a troca REAL de workspace limpa o cliente ativo. */
export function shouldClearClientOnBrandChange(
  previousBrandId: string | null,
  nextBrandId: string | null,
): boolean {
  return previousBrandId !== nextBrandId;
}

/**
 * Revalidação do cliente persistido contra as fontes reais:
 *  - `allowedClientIds`: escopo autorizado do usuário (`null` = todo o workspace);
 *  - `brandClientIds`: clientes do workspace ativo (`null` = ainda carregando).
 *
 * Enquanto a lista do workspace não carregou, o cliente NÃO é limpo (evita o
 * flicker "volta para Todos os clientes" durante a hidratação).
 */
export function shouldClearClient(
  clientId: string | null,
  allowedClientIds: ReadonlySet<string> | null,
  brandClientIds: readonly string[] | null,
): boolean {
  if (!clientId) return false;
  if (allowedClientIds && !allowedClientIds.has(clientId)) return true;
  if (brandClientIds && !brandClientIds.includes(clientId)) return true;
  return false;
}
