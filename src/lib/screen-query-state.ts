/**
 * Máquina de estados de tela para queries críticas.
 *
 * Regra do sistema: nenhuma tela pode ficar em skeleton indefinidamente e
 * nenhuma atualização em andamento pode apagar dados já visíveis. Este
 * resolvedor é puro para poder ser testado sem React.
 *
 * - `ready`      → há dados; renderiza a tela.
 * - `refreshing` → há dados E existe fetch em andamento; renderiza a tela
 *                  (com indicador discreto), NUNCA skeleton.
 * - `stale-error`→ há dados, mas a última atualização falhou; renderiza a tela
 *                  com aviso acionável.
 * - `error`      → sem dados e falha (timeout, 500, permissão) → estado terminal.
 * - `empty`      → sem dados e a consulta terminou com sucesso → estado terminal.
 * - `loading`    → único estado de skeleton, e só enquanto há trabalho real.
 */
export type ScreenQueryState =
  | "loading"
  | "refreshing"
  | "ready"
  | "stale-error"
  | "empty"
  | "error";

export type ScreenQueryInput = {
  /** Identidade já resolvida (ou watchdog estourado). */
  sessionReady: boolean;
  /** Existe requisição em andamento agora. */
  isFetching: boolean;
  /** Última tentativa falhou. */
  isError: boolean;
  /** Já existe payload (cache incluso). */
  hasData: boolean;
  /** Consulta concluiu com sucesso ao menos uma vez. */
  isSuccess: boolean;
};

export function resolveScreenQueryState(i: ScreenQueryInput): ScreenQueryState {
  // Dados na mão sempre vencem: nada substitui a tela inteira por skeleton.
  if (i.hasData) {
    if (i.isError) return "stale-error";
    return i.isFetching ? "refreshing" : "ready";
  }
  // Sem dados: erro é terminal (não importa se um retry está a caminho).
  if (i.isError) return "error";
  if (i.isFetching) return "loading";
  // Sucesso sem payload = vazio (terminal), não loading.
  if (i.isSuccess) return "empty";
  // Ainda não começou: só é loading enquanto a identidade não liberou o gate.
  return i.sessionReady ? "empty" : "loading";
}

/** Erros de autorização/entrada inválida não devem ser repetidos. */
export function isNonRetriableQueryError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? "");
  return /QueryTimeoutError|row-level security|permission denied|unauthorized|forbidden|not authori[sz]ed|403|401|invalid input|validation/i.test(
    msg,
  );
}
