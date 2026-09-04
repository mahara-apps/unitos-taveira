// ⚠️ Brain Reasoning Engine — planner determinístico.
// Recebe intenção + pergunta e devolve um plano interno de execução.
// O plano NUNCA é exibido ao usuário: alimenta o Tool Selector + logs.
import type { ReasoningIntent } from "./intent";

export type ToolName =
  | "tasks.overdue"
  | "tasks.count"
  | "tasks.recent"
  | "projects.list"
  | "projects.status"
  | "content.upcoming"
  | "content.stage_counts"
  | "clients.list"
  | "clients.summary"
  | "calendar.upcoming"
  | "analytics.stats"
  | "brain.memory"
  | "brain.insights"
  | "brain.recommendations"
  | "brain.semantic";

export interface PlanStep {
  tool: ToolName;
  description: string;
  args?: Record<string, unknown>;
}

export interface ReasoningPlan {
  intent: ReasoningIntent;
  steps: PlanStep[];
  needsLlm: "no" | "maybe" | "yes";
}

export function buildPlan(intent: ReasoningIntent, question: string): ReasoningPlan {
  const q = question.toLowerCase();
  const overdue = /atrasad|vencid|em atraso/.test(q);
  const steps: PlanStep[] = [];

  switch (intent) {
    case "consulta_tarefa": {
      if (overdue) steps.push({ tool: "tasks.overdue", description: "listar tarefas em atraso" });
      else {
        steps.push({ tool: "tasks.count", description: "contar tarefas por status" });
        steps.push({ tool: "tasks.recent", description: "listar tarefas recentes" });
      }
      steps.push({
        tool: "brain.insights",
        description: "insights sobre entregas",
        args: { topic: "tasks" },
      });
      return { intent, steps, needsLlm: "no" };
    }
    case "consulta_projeto":
      steps.push({ tool: "projects.list", description: "listar projetos ativos" });
      steps.push({ tool: "projects.status", description: "consolidar status geral" });
      return { intent, steps, needsLlm: "maybe" };
    case "consulta_conteudo":
      steps.push({ tool: "content.stage_counts", description: "contar posts por estágio" });
      steps.push({ tool: "content.upcoming", description: "listar próximos posts agendados" });
      return { intent, steps, needsLlm: "maybe" };
    case "consulta_cliente":
      steps.push({ tool: "clients.list", description: "listar clientes/marcas do workspace" });
      steps.push({ tool: "clients.summary", description: "sumarizar atividades por cliente" });
      return { intent, steps, needsLlm: "maybe" };
    case "consulta_calendario":
      steps.push({
        tool: "calendar.upcoming",
        description: "listar próximos posts/tarefas agendados",
      });
      return { intent, steps, needsLlm: "no" };
    case "consulta_metrica":
    case "consulta_status":
      steps.push({ tool: "analytics.stats", description: "coletar estatísticas do workspace" });
      steps.push({ tool: "tasks.count", description: "contar tarefas" });
      steps.push({ tool: "content.stage_counts", description: "contar conteúdos" });
      return { intent, steps, needsLlm: "no" };
    case "resumo":
      steps.push({ tool: "analytics.stats", description: "estatísticas gerais" });
      steps.push({ tool: "tasks.overdue", description: "verificar atrasos" });
      steps.push({ tool: "content.upcoming", description: "próximos posts" });
      steps.push({ tool: "brain.insights", description: "insights ativos" });
      steps.push({ tool: "brain.recommendations", description: "recomendações" });
      return { intent, steps, needsLlm: "maybe" };
    case "recomendacao":
      steps.push({ tool: "brain.recommendations", description: "buscar recomendações ativas" });
      steps.push({ tool: "brain.insights", description: "insights recentes como suporte" });
      return { intent, steps, needsLlm: "maybe" };
    case "diagnostico":
    case "comparacao":
    case "previsao":
      steps.push({
        tool: "brain.semantic",
        description: "recuperar memórias relacionadas",
        args: { query: question },
      });
      steps.push({ tool: "brain.insights", description: "insights relacionados" });
      steps.push({ tool: "analytics.stats", description: "estatísticas de suporte" });
      return { intent, steps, needsLlm: "yes" };
    case "consulta_financeiro":
    case "consulta_midia_paga":
    case "consulta_usuario":
      steps.push({
        tool: "brain.semantic",
        description: "recuperar memórias relacionadas",
        args: { query: question },
      });
      steps.push({ tool: "brain.insights", description: "insights relacionados" });
      return { intent, steps, needsLlm: "yes" };
    default:
      steps.push({
        tool: "brain.semantic",
        description: "recall semântico",
        args: { query: question },
      });
      steps.push({ tool: "brain.memory", description: "memórias recentes" });
      return { intent, steps, needsLlm: "yes" };
  }
}
