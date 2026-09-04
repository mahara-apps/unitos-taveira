/**
 * Registro eager de todos os módulos `*.functions.ts` no grafo do servidor.
 *
 * Por quê: rotas protegidas rodam com `ssr: false`, então os módulos de server
 * functions usados só por elas nunca entram no grafo do servidor. Na primeira
 * chamada RPC o dev server tenta resolver o id pelo caminho de fallback e
 * falha com `Invalid server function ID` (HTTP 500 / tela branca).
 *
 * Importar todos os módulos aqui (a partir do server entry) garante que cada
 * server function esteja registrada antes da primeira chamada. É código de
 * servidor apenas — nada disso entra no bundle do cliente.
 */
// Rotas públicas com SSR já registram suas próprias funções no grafo normal.
// O registro complementar cobre somente funções que podem ser alcançadas pelas
// subárvores `/_authenticated` e `/_portal`, ambas com `ssr: false`.
const modules = import.meta.glob(
  [
    "/src/lib/**/*.functions.ts",
    "!/src/lib/approval.functions.ts",
    "!/src/lib/password.functions.ts",
    "!/src/lib/portal-public.functions.ts",
    "!/src/lib/media-plan-public.functions.ts",
    "!/src/lib/monthly-plan-public.functions.ts",
  ],
  { eager: true },
);

export const registeredServerFnModules = Object.keys(modules).length;
