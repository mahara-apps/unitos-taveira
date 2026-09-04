/**
 * Timeout de query crítica de tela.
 *
 * Regra do sistema: nenhuma tela pode ficar presa em skeleton. Uma server
 * function que nunca resolve (rede pendurada, isolate travado) mantém a query
 * em `pending` para sempre — e o gate de loading nunca termina. Aqui a promise
 * é corrida contra um prazo: ao estourar, a query entra em `error` e a tela
 * mostra estado terminal com "Tentar novamente".
 */
export class QueryTimeoutError extends Error {
  constructor(label = "Consulta") {
    super(`${label} demorou demais para responder. Tente novamente.`);
    this.name = "QueryTimeoutError";
  }
}

export const DEFAULT_QUERY_TIMEOUT_MS = 20_000;

export function withQueryTimeout<T>(
  promise: Promise<T>,
  label = "Consulta",
  ms = DEFAULT_QUERY_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new QueryTimeoutError(label)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
