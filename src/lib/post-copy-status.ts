/**
 * Estado da legenda de uma peça, derivado de `posts.ai_phase` + `copy`.
 * Fonte única para o selo do card, a faixa de pendentes e o diálogo da peça.
 * Nunca expõe texto técnico: o motivo vem de `ai_phase_error` (pt-BR curto).
 */
export type CopyStatusKind = "ready" | "running" | "pending" | "failed";

export type CopyStatus = {
  kind: CopyStatusKind;
  /** Rótulo curto para o selo. */
  label: string;
  /** Texto de apoio (tooltip / faixa). */
  hint: string;
};

const READY: CopyStatus = { kind: "ready", label: "Legenda pronta", hint: "Legenda escrita." };

export function copyStatusOf(post: {
  copy?: string | null;
  ai_phase?: string | null;
  ai_phase_error?: string | null;
}): CopyStatus {
  const hasCopy = (post.copy ?? "").trim().length > 0;
  if (hasCopy) return READY;

  const phase = post.ai_phase ?? null;
  if (phase === "copy_running") {
    return {
      kind: "running",
      label: "Legenda em produção",
      hint: "A IA está escrevendo a legenda desta peça.",
    };
  }
  if (phase === "copy_failed_permanent") {
    return {
      kind: "failed",
      label: "Legenda falhou",
      hint: post.ai_phase_error?.trim() || "A IA não conseguiu escrever a legenda.",
    };
  }
  if (phase === "copy_failed" || phase === "copy_failed_retryable") {
    return {
      kind: "pending",
      label: "Legenda pendente",
      hint: post.ai_phase_error?.trim() || "Nova tentativa automática em instantes.",
    };
  }
  return {
    kind: "pending",
    label: "Legenda pendente",
    hint: "Esta peça ainda não tem legenda escrita.",
  };
}

/** Resumo da fila de legendas para a faixa da tela de Conteúdo. */
export function summarizeCopyQueue(
  posts: Array<{ copy?: string | null; ai_phase?: string | null; ai_phase_error?: string | null }>,
): { running: number; pending: number; failed: number; total: number } {
  let running = 0;
  let pending = 0;
  let failed = 0;
  for (const p of posts) {
    const s = copyStatusOf(p);
    if (s.kind === "running") running += 1;
    else if (s.kind === "pending") pending += 1;
    else if (s.kind === "failed") failed += 1;
  }
  return { running, pending, failed, total: running + pending + failed };
}
