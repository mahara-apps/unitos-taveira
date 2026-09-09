import { createServerFn } from "@tanstack/react-start";

import type { ServiceStateInfo } from "./service-state";

/**
 * Leitura pública do estado operacional da instalação.
 *
 * Precisa ser pública: a tela de suspensão e a faixa de atualização aparecem
 * antes de qualquer sessão. Devolve apenas estado, mensagem e validade —
 * nenhum dado sensível.
 */
export const getServiceStateFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<ServiceStateInfo> => {
    const { getInstallationServiceState } = await import("@/lib/installation-settings.server");
    return getInstallationServiceState();
  },
);
