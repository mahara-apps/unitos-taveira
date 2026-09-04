/**
 * Regras de conclusão da etapa "Ativos" da Meta.
 *
 * Ativar uma conta a torna disponível no WORKSPACE. Vincular a um cliente é um
 * segundo passo, explícito. Estas regras existem para que nenhum dos dois
 * caminhos fique implícito na UI.
 */
export type AssignFinishInput = {
  /** Nomes das contas ativadas nesta passagem. */
  activated: string[];
  /** Cliente já definido pelo contexto (aba do cliente). */
  clientId?: string | undefined;
  /** Cliente escolhido no seletor do rodapé. */
  target?: string | undefined;
};

export type AssignFinishState = {
  count: number;
  /** Habilita "Vincular e concluir". */
  canLink: boolean;
  /** Habilita "Concluir sem cliente". */
  canFinishWithoutClient: boolean;
  /** Precisa confirmar antes de fechar pelo "X". */
  needsCloseConfirm: boolean;
  message: string;
};

export function assignFinishState(input: AssignFinishInput): AssignFinishState {
  const activated = input.activated ?? [];
  const count = activated.length;
  const hasClient = Boolean(input.clientId ?? input.target);
  return {
    count,
    canLink: count > 0 && hasClient,
    canFinishWithoutClient: count > 0,
    needsCloseConfirm: count > 0 && !input.clientId && !input.target,
    message:
      count === 0
        ? "Ative acima as contas que você quer usar. Depois escolha o cliente e conclua."
        : `${count} ${count === 1 ? "conta ativada" : "contas ativadas"}: ${activated.join(", ")}`,
  };
}
