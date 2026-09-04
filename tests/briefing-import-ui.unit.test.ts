import { describe, expect, it } from "vitest";
import type { ImportChangeRow } from "@/lib/briefing-import.server";
import {
  ACCEPT_ATTRIBUTE,
  CHANGE_STATE_LABELS,
  changeState,
  confidenceLabel,
  defaultSelection,
  displayValue,
  fieldLabel,
  formatBytes,
  importErrorMessage,
  inferSourceKind,
  isReviewable,
  MAX_IMPORT_FILE_BYTES,
  shouldPollRun,
  summarizeChanges,
  uiStepFromRun,
  validateImportFile,
} from "@/lib/briefing-import-ui";

function change(over: Partial<ImportChangeRow>): ImportChangeRow {
  return {
    id: over.id ?? crypto.randomUUID(),
    run_id: "run",
    brand_id: "brand",
    client_id: "client",
    field: over.field ?? "positioning",
    action: over.action ?? "update",
    current_value: over.current_value ?? "atual",
    proposed_value: over.proposed_value ?? "proposto",
    confidence: over.confidence ?? 0.9,
    evidence: over.evidence ?? null,
    decision: over.decision ?? null,
    decided_by: null,
    decided_at: null,
    created_at: new Date().toISOString(),
  } as ImportChangeRow;
}

describe("validação de arquivo", () => {
  it("aceita formatos que o backend realmente lê", () => {
    for (const name of ["brief.pdf", "notas.txt", "dados.csv", "call.vtt", "logo.png"]) {
      expect(validateImportFile({ name, size: 1024 }).ok).toBe(true);
    }
  });

  it("rejeita .doc legado, arquivo vazio e acima do limite", () => {
    expect(validateImportFile({ name: "brief.doc", size: 10 }).ok).toBe(false);
    expect(validateImportFile({ name: "brief.pdf", size: 0 }).ok).toBe(false);
    expect(validateImportFile({ name: "brief.pdf", size: MAX_IMPORT_FILE_BYTES + 1 }).ok).toBe(
      false,
    );
    expect(ACCEPT_ATTRIBUTE).toContain(".docx");
  });


  it("formata tamanhos", () => {
    expect(formatBytes(0)).toBe("—");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
  });
});

describe("origem do material", () => {
  it("identifica transcrição por extensão e por nome", () => {
    expect(inferSourceKind("reuniao-cliente.vtt")).toBe("transcript");
    expect(inferSourceKind("Transcrição kickoff.txt")).toBe("transcript");
    expect(inferSourceKind("briefing-marca.pdf")).toBe("document");
  });
});

describe("máquina de estados do modal", () => {
  it("upload → analisando → revisão → aplicado", () => {
    expect(uiStepFromRun(null)).toBe("upload");
    expect(uiStepFromRun("queued")).toBe("analyzing");
    expect(uiStepFromRun("running")).toBe("analyzing");
    expect(uiStepFromRun("proposed")).toBe("review");
    expect(uiStepFromRun("applying")).toBe("review");
    expect(uiStepFromRun("applied")).toBe("applied");
  });

  it("falha vai para o estado de retry", () => {
    expect(uiStepFromRun("failed")).toBe("failed");
  });

  it("cancelada/descartada volta ao upload", () => {
    expect(uiStepFromRun("cancelled")).toBe("upload");
    expect(uiStepFromRun("discarded")).toBe("upload");
  });

  it("só faz polling enquanto a IA trabalha", () => {
    expect(shouldPollRun("running")).toBe(true);
    expect(shouldPollRun("applying")).toBe(true);
    expect(shouldPollRun("proposed")).toBe(false);
    expect(shouldPollRun("applied")).toBe(false);
    expect(shouldPollRun("failed")).toBe(false);
  });
});

describe("classificação e seleção de alterações", () => {
  it("classifica novo, atualização, conflito e sem alteração", () => {
    expect(changeState(change({ action: "create" }))).toBe("new");
    expect(changeState(change({ action: "update", confidence: 0.9 }))).toBe("update");
    expect(changeState(change({ action: "update", confidence: 0.2 }))).toBe("conflict");
    expect(changeState(change({ action: "update", evidence: { conflict: true } }))).toBe("conflict");
    expect(changeState(change({ action: "keep" }))).toBe("unchanged");
    expect(CHANGE_STATE_LABELS.conflict).toBe("Conflito");
  });

  it("pré-seleciona novidades e atualizações confiáveis, nunca conflitos", () => {
    const rows = [
      change({ field: "mission", action: "create" }),
      change({ field: "positioning", action: "update", confidence: 0.95 }),
      change({ field: "audience", action: "update", confidence: 0.1 }),
      change({ field: "goals", action: "keep" }),
      change({ field: "offer", action: "update", decision: "rejected" }),
    ];
    const selected = defaultSelection(rows);
    expect([...selected].sort()).toEqual(["mission", "positioning"]);
  });

  it("proposta vazia não gera nada revisável", () => {
    const rows = [change({ action: "keep" }), change({ field: "goals", action: "discard" })];
    expect(rows.filter((r) => isReviewable(r.action))).toHaveLength(0);
    expect(summarizeChanges(rows).reviewable).toBe(0);
  });

  it("resume contagens por estado", () => {
    const s = summarizeChanges([
      change({ field: "mission", action: "create" }),
      change({ field: "positioning", action: "update", confidence: 0.9 }),
      change({ field: "audience", action: "update", confidence: 0.1 }),
      change({ field: "goals", action: "keep" }),
    ]);
    expect(s).toMatchObject({ reviewable: 3, novos: 1, atualizacoes: 1, conflitos: 1, semAlteracao: 1 });
  });
});

describe("apresentação", () => {
  it("mostra valores de qualquer forma", () => {
    expect(displayValue(null)).toBe("");
    expect(displayValue("x")).toBe("x");
    expect(displayValue(["a", "b"])).toBe("a, b");
    expect(displayValue({ a: 1 })).toContain('"a": 1');
  });

  it("rotula campos e confiança", () => {
    expect(fieldLabel("positioning")).toBe("Posicionamento");
    expect(fieldLabel("campo_novo")).toBe("campo_novo");
    expect(confidenceLabel(0.87)).toBe("87% de confiança");
    expect(confidenceLabel(null)).toBeNull();
  });
});

describe("erros do fluxo", () => {
  it("traduz falhas conhecidas do backend", () => {
    expect(importErrorMessage(new Error("import_run_not_found"))).toBe("Execução não encontrada.");
    expect(importErrorMessage(new Error("no_accepted_fields"))).toBe(
      "Selecione ao menos um campo para aplicar.",
    );
    expect(importErrorMessage(new Error("import_run_not_retryable"))).toContain("falha");
  });

  it("trata negativa de permissão", () => {
    expect(importErrorMessage(new Error("new row violates row-level security policy"))).toContain(
      "permissão",
    );
    expect(importErrorMessage(new Error("Unauthorized"))).toContain("permissão");
  });

  it("mantém mensagem desconhecida legível", () => {
    expect(importErrorMessage(new Error("boom"))).toBe("boom");
    expect(importErrorMessage(null)).toBe("Falha na importação.");
  });

  it("explica quando o provider corta a saída estruturada", () => {
    const error = Object.assign(new Error("Failed to generate JSON"), {
      responseBody: JSON.stringify({
        error: { failed_generation: "max completion tokens reached before generating a valid document" },
      }),
    });
    expect(importErrorMessage(error)).toContain("maior que o limite de resposta");
  });
});

describe("entrada de material (texto + arquivos)", () => {
  it("aceita os formatos de documento pedidos e classifica a leitura", async () => {
    const { fileHandling } = await import("@/lib/briefing-import-ui");
    expect(fileHandling("brief.pdf")).toBe("server");
    expect(fileHandling("foto.PNG")).toBe("server");
    expect(fileHandling("brief.docx")).toBe("server");
    expect(fileHandling("planilha.xlsx")).toBe("server");
    expect(fileHandling("planilha.xls")).toBe("server");
    expect(fileHandling("dados.csv")).toBe("server");
    expect(fileHandling("notas.txt")).toBe("server");
    expect(fileHandling("video.mp4")).toBe("unsupported");
  });

  it("rejeita .doc legado com orientação clara", () => {
    const r = validateImportFile({ name: "antigo.doc", size: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/\.docx|PDF/);
  });

  it("aceita docx e planilhas dentro do limite", () => {
    expect(validateImportFile({ name: "brief.docx", size: 5000 }).ok).toBe(true);
    expect(validateImportFile({ name: "plan.xlsx", size: 5000 }).ok).toBe(true);
    expect(validateImportFile({ name: "grande.pdf", size: MAX_IMPORT_FILE_BYTES + 1 }).ok).toBe(false);
  });

  it("detecta transcrição de reunião no texto colado", async () => {
    const { looksLikeTranscript, inferPasteSourceKind } = await import("@/lib/briefing-import-ui");
    const transcript = [
      "Ana: bom dia, vamos falar do posicionamento",
      "Carlos: nosso público é B2B",
      "Ana: e o tom de voz?",
      "Carlos: mais técnico",
    ].join("\n");
    expect(looksLikeTranscript(transcript)).toBe(true);
    expect(inferPasteSourceKind(transcript)).toBe("transcript");

    const vtt = "00:00:01.000 --> 00:00:04.000\nfalamos sobre a marca";
    expect(looksLikeTranscript(vtt)).toBe(true);

    const plain = "A marca atua no varejo de moda com foco em conforto e preço acessível.";
    expect(looksLikeTranscript(plain)).toBe(false);
    expect(inferPasteSourceKind(plain)).toBe("paste");
  });

  it("compõe material de texto rotulado ignorando blocos vazios", async () => {
    const { composeTextMaterial } = await import("@/lib/briefing-import-extract");
    const out = composeTextMaterial([
      { label: "Texto colado", text: "conteúdo" },
      { label: "vazio.txt", text: "   " },
      { label: "brief.docx", text: "outro" },
    ]);
    expect(out).toContain("### Texto colado");
    expect(out).toContain("### brief.docx");
    expect(out).not.toContain("vazio.txt");
  });
});
