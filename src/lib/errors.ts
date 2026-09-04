import { ZodError } from "zod";
import { errorToMessage } from "./error-message";

/**
 * Traduz mensagens de erro (Zod, Supabase/Postgres, fetch) para pt-BR
 * amigáveis para exibir em toasts. Nunca retorna vazio.
 */
export function describeError(err: unknown): string {
  if (!err) return "Ocorreu um erro inesperado.";

  if (err instanceof ZodError) {
    const first = err.issues[0];
    if (!first) return "Dados inválidos.";
    const field = first.path.length ? String(first.path[first.path.length - 1]) : "campo";
    switch (first.code) {
      case "too_small":
        if (first.type === "string") {
          return first.minimum === 1
            ? `Preencha o campo "${field}".`
            : `O campo "${field}" deve ter no mínimo ${first.minimum} caracteres.`;
        }
        return `O valor de "${field}" é menor que o mínimo permitido.`;
      case "too_big":
        if (first.type === "string") {
          return `O campo "${field}" deve ter no máximo ${first.maximum} caracteres.`;
        }
        return `O valor de "${field}" é maior que o máximo permitido.`;
      case "invalid_type":
        return first.received === "undefined"
          ? `O campo "${field}" é obrigatório.`
          : `O campo "${field}" está em formato inválido.`;
      case "invalid_string":
        return `O campo "${field}" está em formato inválido.`;
      case "invalid_enum_value":
        return `Valor inválido para "${field}".`;
      default:
        return first.message || `Dados inválidos em "${field}".`;
    }
  }

  // Cobre Error, string e objetos PostgREST/Supabase ({ message, code, details, hint }).
  const raw = errorToMessage(err);

  if (!raw) return "Ocorreu um erro inesperado.";

  const lower = raw.toLowerCase();

  // Provedor de IA (BYOK) não configurado / chave ausente / modelo indisponível
  if (lower.includes("ai_provider_not_configured")) {
    return "Nenhuma IA configurada para esta marca. Cadastre uma chave de provedor em Conexões.";
  }
  if (lower.includes("ai_provider_key_missing")) {
    const p = raw.match(/ai_provider_key_missing:([a-z]+)/i)?.[1];
    return `A chave${p ? ` do provedor ${p}` : ""} não foi encontrada. Reconfigure em Conexões.`;
  }
  if (lower.includes("generation_in_progress")) {
    return "Já existe uma geração de pauta em andamento para este cliente neste período. Aguarde a conclusão.";
  }
  if (lower.includes("briefing_version_invalid")) {
    return "A versão de briefing selecionada não existe ou não pertence a este cliente. Atualize a lista e selecione outra versão.";
  }
  if (lower.includes("project_required")) {
    return "Toda pauta precisa de um projeto. Vincule a um projeto existente ou crie um novo.";
  }
  if (lower.includes("project_not_in_scope")) {
    return "O projeto selecionado não pertence a este cliente. Atualize a lista e escolha outro.";
  }
  if (lower.includes("volumetry_required")) {
    return "Defina a volumetria (canal + formato + quantidade) no briefing antes de gerar a pauta.";
  }
  if (lower.includes("overage_not_authorized")) {
    return "A quantidade solicitada excede a volumetria do briefing. Solicite liberação do excedente ao gestor da conta.";
  }
  if (lower.includes("ai_provider_quota")) {
    return "O provedor de IA atingiu o limite de uso disponível. Nada incompleto foi salvo — tente novamente mais tarde.";
  }
  if (lower.includes("ai_provider_rate_limit")) {
    return "A IA recebeu muitas solicitações em sequência. Aguarde alguns instantes e gere novamente.";
  }
  if (lower.includes("ai_provider_unavailable")) {
    return "O provedor de IA está temporariamente indisponível. Tente novamente em alguns instantes.";
  }
  if (lower.includes("ai_invalid_output")) {
    return "A IA não conseguiu concluir a geração. Nada incompleto foi salvo — tente novamente.";
  }
  if (lower.includes("incomplete_generation")) {
    return "A IA não preencheu todas as vagas da volumetria. Nada incompleto foi salvo — ao tentar novamente, a geração é retomada de onde parou.";
  }
  if (lower.includes("ai_output_truncated")) {
    return "A resposta da IA foi interrompida antes de ficar completa. Nada incompleto foi salvo — reduza a volumetria ou tente novamente.";
  }
  if (lower.includes("ai_invalid_request")) {
    return "O provedor de IA recusou o formato da solicitação. Nada foi salvo — revise o provedor em Conexões e tente novamente.";
  }
  if (lower.includes("ai_generation_failed")) {
    return "Não foi possível concluir a geração. Nada incompleto foi salvo — tente novamente.";
  }
  if (lower.includes("ai_model_unavailable")) {
    return "O provedor configurado não oferece um modelo para esta função. Ajuste o provedor em Conexões.";
  }

  // Falha ao gravar a pauta: mostra o motivo real, não "erro inesperado".
  if (lower.includes("plan_persistence_failed")) {
    const detail = raw.split(/plan_persistence_failed:[^:]*:\s*/)[1]?.trim();
    return `Não foi possível salvar a pauta gerada${detail ? `: ${detail}` : "."}`;
  }

  // Erros comuns do PostgREST / Supabase
  if (lower.includes("row-level security") || lower.includes("permission denied")) {
    return "Você não tem permissão para executar esta ação.";
  }
  if (lower.includes("duplicate key") || lower.includes("unique constraint")) {
    return "Já existe um registro com esses dados.";
  }
  if (lower.includes("foreign key")) {
    return "Não foi possível salvar: existe um vínculo inválido.";
  }
  if (lower.includes("not null") || lower.includes("violates not-null")) {
    return "Preencha todos os campos obrigatórios.";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "A operação demorou demais para responder. Tente novamente.";
  }
  if (lower.includes("network") || lower.includes("failed to fetch")) {
    return "Falha de conexão. Verifique sua internet e tente novamente.";
  }
  if (lower.includes("unauthorized") || lower.includes("jwt") || lower.includes("invalid token")) {
    return "Sua sessão expirou. Faça login novamente.";
  }

  // Mensagens Zod em inglês que ainda vazam vindas do servidor
  if (lower.startsWith("string must contain at most")) {
    const m = raw.match(/at most (\d+)/i);
    return m ? `Texto excede o limite de ${m[1]} caracteres.` : "Texto excede o limite permitido.";
  }
  if (lower.startsWith("string must contain at least")) {
    const m = raw.match(/at least (\d+)/i);
    return m ? `Texto abaixo do mínimo de ${m[1]} caracteres.` : "Texto abaixo do mínimo exigido.";
  }
  if (lower === "required") return "Preencha os campos obrigatórios.";

  return raw;
}

/**
 * Extrai a mensagem legível da resposta de uma rota de API.
 * Aceita corpo JSON (`{ message }` / `{ error }`) ou texto puro.
 */
export async function readApiError(
  res: Response,
  fallback = "Não foi possível concluir a operação.",
): Promise<string> {
  const raw = await res.text().catch(() => "");
  if (!raw) return fallback;
  try {
    const body = JSON.parse(raw) as { message?: unknown; error?: unknown };
    if (typeof body.message === "string" && body.message.trim()) return body.message;
    if (typeof body.error === "string" && body.error.trim()) return describeError(body.error);
  } catch {
    /* corpo não é JSON */
  }
  return describeError(raw);
}
