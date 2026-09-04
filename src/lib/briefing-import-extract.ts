/**
 * Composição do material de TEXTO enviado à importação de briefing.
 *
 * Arquivos (docx, planilhas, PDF, imagens, legendas, texto) são lidos no
 * SERVIDOR por `document-extract.server.ts` — o navegador não extrai nada,
 * justamente para não depender de bibliotecas de parsing no bundle do cliente.
 * Aqui fica apenas a formatação do texto colado pelo usuário.
 */

/** Limite defensivo por bloco: mantém o prompt dentro de um tamanho sadio. */
export const MAX_EXTRACTED_CHARS = 60_000;

/** Junta material de texto num único bloco rotulado. */
export function composeTextMaterial(
  blocks: Array<{ label: string; text: string }>,
): string {
  return blocks
    .filter((b) => b.text.trim().length > 0)
    .map((b) => `### ${b.label}\n${b.text.trim()}`)
    .join("\n\n---\n\n");
}
