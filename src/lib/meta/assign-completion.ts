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
  /** Nome do cliente de destino, quando conhecido (só apresentação). */
  clientName?: string | undefined;
  /** Quebra por canal das contas ativadas, ex.: `{ facebook: 2, instagram: 1 }`. */
  channels?: Partial<Record<"facebook" | "instagram" | "threads" | "ads", number>> | undefined;
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
  /** Resumo curto por canal, ex.: "2 Páginas · 1 Instagram". */
  breakdown: string;
  /** Frase do destino: para qual cliente vai, ou o que acontece sem cliente. */
  destination: string;
};

const CHANNEL_NAMES: Record<"facebook" | "instagram" | "threads" | "ads", [string, string]> = {
  facebook: ["Página", "Páginas"],
  instagram: ["conta do Instagram", "contas do Instagram"],
  threads: ["perfil do Threads", "perfis do Threads"],
  ads: ["Conta de Anúncios", "Contas de Anúncios"],
};

function breakdownOf(channels: AssignFinishInput["channels"]): string {
  if (!channels) return "";
  return (Object.keys(CHANNEL_NAMES) as Array<keyof typeof CHANNEL_NAMES>)
    .filter((c) => (channels[c] ?? 0) > 0)
    .map((c) => {
      const n = channels[c] as number;
      const [one, many] = CHANNEL_NAMES[c];
      return `${n} ${n === 1 ? one : many}`;
    })
    .join(" · ");
}

export function assignFinishState(input: AssignFinishInput): AssignFinishState {
  const activated = input.activated ?? [];
  const count = activated.length;
  const hasClient = Boolean(input.clientId ?? input.target);
  const breakdown = breakdownOf(input.channels);
  const destination =
    count === 0
      ? "Nada será conectado enquanto nenhuma conta estiver ativada."
      : hasClient
        ? `Ao concluir, ${count === 1 ? "esta conta" : `estas ${count} contas`} ${
            count === 1 ? "vai" : "vão"
          } para o cliente${input.clientName ? ` ${input.clientName}` : " selecionado"}.`
        : `Sem cliente, ${count === 1 ? "a conta fica" : "as contas ficam"} disponível${
            count === 1 ? "" : "eis"
          } no workspace para vincular depois.`;

  return {
    count,
    canLink: count > 0 && hasClient,
    canFinishWithoutClient: count > 0,
    needsCloseConfirm: count > 0 && !input.clientId && !input.target,
    breakdown,
    destination,
    message:
      count === 0
        ? "Ative acima as contas que você quer usar. Depois escolha o cliente e conclua."
        : `${count} ${count === 1 ? "conta ativada" : "contas ativadas"}${
            breakdown ? ` (${breakdown})` : ""
          }: ${activated.join(", ")}`,
  };
}
