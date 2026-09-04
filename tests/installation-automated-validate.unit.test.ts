import { describe, expect, it } from "vitest";

import { classifyVerificationCheck } from "@/lib/installation/automation.server";
import { VALIDATE_STEPS } from "@/lib/installation/manager-contract";

const STEP_IDS = VALIDATE_STEPS.map((s) => s.id) as string[];

describe("validação automática — classificação das verificações", () => {
  it("mapeia cada verificação do verify para uma etapa existente da UI", () => {
    const names = [
      "isolamento: banco próprio (ref do projeto)",
      "isolamento: nenhuma referência ao MASTER em installation",
      "installation.app_url definido e https",
      "baseline: tabelas em public (esperado 95)",
      "baseline: enums em public (esperado 10)",
      "baseline: funções em public (esperado >= 250)",
      "baseline: policies em public (esperado >= 215)",
      "baseline: triggers próprios em public (esperado >= 100)",
      "RLS habilitado em todas as tabelas de public",
      "trigger on_auth_user_created em auth.users",
      "extensões obrigatórias (pgcrypto, uuid-ossp, vector, pg_net, pg_cron, supabase_vault)",
      "storage: 5 buckets privados esperados",
      "storage: policies em storage.objects (esperado >= 12)",
      "seeds: agent_prompts (esperado >= 9)",
      "sem dados de negócio herdados (marcas/clientes/posts/credenciais)",
      "vault: cron_secret presente e com tamanho mínimo",
      "cron: total de jobs (esperado 14+)",
      "brain_stats_mv existe e está populada",
    ];
    for (const name of names) {
      expect(STEP_IDS, name).toContain(classifyVerificationCheck(name));
    }
  });

  it("agrupa isolamento, storage e cron nas etapas corretas", () => {
    expect(classifyVerificationCheck("isolamento: banco próprio")).toBe("isolation");
    expect(classifyVerificationCheck("storage: 5 buckets privados esperados")).toBe("storage");
    expect(classifyVerificationCheck("cron: total de jobs")).toBe("cron");
    expect(classifyVerificationCheck("vault: cron_secret presente")).toBe("cron");
    expect(classifyVerificationCheck("RLS habilitado em todas as tabelas")).toBe("rls");
    expect(classifyVerificationCheck("baseline: tabelas em public")).toBe("database");
  });
});
