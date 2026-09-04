// Fonte única do alerta de briefing no painel do cliente.
// Regra: o alerta NUNCA depende da data da última atualização. Ele considera
// o estado real de conclusão (clients.briefing_status) e a completude canônica
// do brand_hub. Briefing concluído = sem alerta.
export type BriefingAlert = {
  severity: "critical" | "warning" | "info";
  title: string;
  description?: string;
};

export const CONCLUDED_BRIEFING_STATUSES = ["submitted", "in_review", "approved"] as const;

export function isBriefingConcluded(status: string | null | undefined, completion: number): boolean {
  if (status && (CONCLUDED_BRIEFING_STATUSES as readonly string[]).includes(status)) return true;
  return completion >= 100;
}

export function buildBriefingAlert(args: {
  status: string | null | undefined;
  completion: number;
}): BriefingAlert | null {
  const { status, completion } = args;
  // Regra explícita de atualização pendente: agência solicitou novo briefing.
  if (status === "requested") {
    return {
      severity: "warning",
      title: "Atualização de briefing pendente",
      description: "Foi solicitada uma atualização do briefing ao cliente",
    };
  }
  if (isBriefingConcluded(status, completion)) return null;
  if (completion === 0) {
    return {
      severity: "critical",
      title: "Briefing não preenchido",
      description: "Cérebro da marca ainda sem informações",
    };
  }
  return {
    severity: "warning",
    title: "Briefing incompleto",
    description: `Cérebro da marca ${completion}% preenchido`,
  };
}
