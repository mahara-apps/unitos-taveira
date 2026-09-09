/**
 * Ações CRÍTICAS do nível master (super admin) e demais ações destrutivas.
 *
 * Fonte ÚNICA compartilhada por UI e servidor:
 *  - `CRITICAL_ACTIONS`: registro de toda ação que exige dupla confirmação
 *    (digitar o nome exato do alvo) e que precisa ficar no histórico auditável.
 *  - `matchesConfirmLabel`: comparação canônica (trim + case-insensitive) usada
 *    tanto no botão da UI quanto na validação real no servidor.
 *
 * A UI só reduz o risco de clique acidental. A autoridade continua sendo
 * RLS + `assertSuperAdmin`/`assertBrandAdmin` nas server functions.
 */

export const CRITICAL_ACTION_KEYS = [
  // Instalações
  "installation.provision",
  "installation.reprovision",
  "installation.update",
  "installation.validate",
  "installation.cancel_operation",
  "installation.complete_operation",
  "installation.sync_version",
  "installation.delete",
  "installation.clear_credentials",
  "installation.rotate_secret",
  // Exclusões com perda de dados
  "client.delete",
  "workspace.delete",
  "content.pipeline_delete",
  "content.bulk_delete",
  // Configurações globais
  "feature.toggle",
  "branding.update",
  "meta_app.update",
  "ai_limits.update",
  "environment.rename",
  // Usuários e permissões
  "user.grant_master",
  "user.revoke_master",
  "member.remove",
  "member.reset_password",
  "invite.revoke",
  "portal_access.revoke",
] as const;

export type CriticalActionKey = (typeof CRITICAL_ACTION_KEYS)[number];

export const isCriticalActionKey = (v: unknown): v is CriticalActionKey =>
  typeof v === "string" && (CRITICAL_ACTION_KEYS as readonly string[]).includes(v);

export type CriticalActionDefinition = {
  key: CriticalActionKey;
  /** Verbo real, usado no título do diálogo. */
  title: string;
  /** O que acontece / o que se perde. */
  impact: string;
  /** true quando não há como voltar atrás. */
  irreversible: boolean;
  targetType: string;
};

export const CRITICAL_ACTIONS: Record<CriticalActionKey, CriticalActionDefinition> = {
  "installation.provision": {
    key: "installation.provision",
    title: "Provisionar instalação",
    impact:
      "Cria e reconfigura a infraestrutura do ambiente (repositório, hospedagem, chaves e banco). Pode substituir configurações já aplicadas.",
    irreversible: false,
    targetType: "installation",
  },
  "installation.reprovision": {
    key: "installation.reprovision",
    title: "Reprovisionar instalação",
    impact:
      "Reinicia a instalação do zero neste ambiente de cliente. O ambiente pode ficar indisponível durante o processo.",
    irreversible: false,
    targetType: "installation",
  },
  "installation.update": {
    key: "installation.update",
    title: "Atualizar instalação",
    impact:
      "Publica a nova versão no ambiente do cliente e aplica as mudanças de banco. Não há retorno automático para a versão anterior.",
    irreversible: true,
    targetType: "installation",
  },
  "installation.validate": {
    key: "installation.validate",
    title: "Validar instalação",
    impact: "Executa a bateria completa de verificações no ambiente do cliente.",
    irreversible: false,
    targetType: "installation",
  },
  "installation.cancel_operation": {
    key: "installation.cancel_operation",
    title: "Cancelar operação",
    impact:
      "Interrompe a operação em andamento. O ambiente pode ficar em estado incompleto até uma nova execução.",
    irreversible: true,
    targetType: "installation_operation",
  },
  "installation.complete_operation": {
    key: "installation.complete_operation",
    title: "Concluir operação manualmente",
    impact:
      "Marca a operação como finalizada sem executar as etapas restantes. O estado registrado pode não refletir o ambiente real.",
    irreversible: true,
    targetType: "installation_operation",
  },
  "installation.sync_version": {
    key: "installation.sync_version",
    title: "Sincronizar versão",
    impact: "Reescreve a versão registrada da instalação com base no código realmente publicado.",
    irreversible: false,
    targetType: "installation",
  },
  "installation.delete": {
    key: "installation.delete",
    title: "Excluir instalação",
    impact:
      "Remove o registro desta instalação e todo o histórico de operações e acessos guardados aqui.",
    irreversible: true,
    targetType: "installation",
  },
  "installation.clear_credentials": {
    key: "installation.clear_credentials",
    title: "Apagar acessos da instalação",
    impact:
      "Apaga as credenciais guardadas deste ambiente. Provisionar, validar e atualizar deixam de funcionar até serem informadas novamente.",
    irreversible: true,
    targetType: "installation",
  },
  "installation.rotate_secret": {
    key: "installation.rotate_secret",
    title: "Trocar chave da instalação",
    impact:
      "Gera uma nova chave e invalida a anterior. Integrações que usam a chave antiga param de funcionar.",
    irreversible: true,
    targetType: "installation",
  },
  "client.delete": {
    key: "client.delete",
    title: "Excluir cliente",
    impact:
      "Exclui permanentemente briefing, documentos e arquivos, pautas e planejamentos, posts, projetos, tarefas, conexões e histórico deste cliente.",
    irreversible: true,
    targetType: "client",
  },
  "workspace.delete": {
    key: "workspace.delete",
    title: "Excluir workspace",
    impact:
      "Exclui o workspace com todos os clientes, conteúdos, integrações, membros e histórico vinculados a ele.",
    irreversible: true,
    targetType: "workspace",
  },
  "content.pipeline_delete": {
    key: "content.pipeline_delete",
    title: "Excluir pipeline",
    impact:
      "Envia o pipeline e todos os seus conteúdos para a Lixeira. Agendamentos pendentes são cancelados. A recuperação fica disponível por 30 dias.",
    irreversible: false,
    targetType: "content_pipeline",
  },
  "content.bulk_delete": {
    key: "content.bulk_delete",
    title: "Excluir conteúdos selecionados",
    impact:
      "Envia os conteúdos selecionados para a Lixeira e cancela agendamentos pendentes. A recuperação fica disponível por 30 dias.",
    irreversible: false,
    targetType: "content_posts",
  },
  "feature.toggle": {
    key: "feature.toggle",
    title: "Alterar recurso do sistema",
    impact:
      "Liga ou desliga o recurso para todos os usuários deste workspace, escondendo ou liberando telas e ações.",
    irreversible: false,
    targetType: "feature",
  },
  "branding.update": {
    key: "branding.update",
    title: "Alterar identidade visual",
    impact: "Substitui logos e identidade exibidos para todos os usuários e clientes.",
    irreversible: false,
    targetType: "branding",
  },
  "meta_app.update": {
    key: "meta_app.update",
    title: "Alterar app do Meta",
    impact:
      "Altera as credenciais usadas por todas as conexões do Meta. Conexões existentes podem precisar ser refeitas.",
    irreversible: false,
    targetType: "meta_app",
  },
  "ai_limits.update": {
    key: "ai_limits.update",
    title: "Alterar limites de IA",
    impact: "Muda o teto de uso de IA e pode bloquear geração de conteúdo para o workspace.",
    irreversible: false,
    targetType: "ai_limits",
  },
  "environment.rename": {
    key: "environment.rename",
    title: "Renomear ambiente",
    impact: "Altera o nome exibido do ambiente em todas as telas e comunicações.",
    irreversible: false,
    targetType: "environment",
  },
  "user.grant_master": {
    key: "user.grant_master",
    title: "Conceder nível master",
    impact:
      "Dá autoridade total sobre todo o sistema, incluindo instalações, exclusões e configurações globais.",
    irreversible: false,
    targetType: "user",
  },
  "user.revoke_master": {
    key: "user.revoke_master",
    title: "Remover nível master",
    impact: "Retira a autoridade total do sistema desta pessoa.",
    irreversible: false,
    targetType: "user",
  },
  "member.remove": {
    key: "member.remove",
    title: "Remover membro",
    impact:
      "A pessoa perde imediatamente o acesso ao workspace, aos clientes atribuídos e ao histórico.",
    irreversible: true,
    targetType: "member",
  },
  "member.reset_password": {
    key: "member.reset_password",
    title: "Redefinir senha",
    impact: "Invalida a senha atual desta pessoa e exige a criação de uma nova no próximo acesso.",
    irreversible: true,
    targetType: "member",
  },
  "invite.revoke": {
    key: "invite.revoke",
    title: "Revogar convite",
    impact: "O link enviado deixa de funcionar e a pessoa não consegue mais entrar por ele.",
    irreversible: true,
    targetType: "invite",
  },
  "portal_access.revoke": {
    key: "portal_access.revoke",
    title: "Revogar acesso do portal",
    impact: "O cliente perde o acesso à área dele imediatamente.",
    irreversible: true,
    targetType: "portal_access",
  },
};

/** Comparação canônica do texto de confirmação (trim + case-insensitive). */
export function matchesConfirmLabel(
  typed: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  const a = (typed ?? "").trim().toLowerCase();
  const b = (expected ?? "").trim().toLowerCase();
  if (!a || !b) return false;
  return a === b;
}

/**
 * Validação REAL no servidor: a ação crítica só executa quando o chamador
 * confirmou digitando o nome exato do alvo.
 */
export function assertConfirmLabel(
  typed: string | null | undefined,
  expected: string | null | undefined,
): void {
  if (!matchesConfirmLabel(typed, expected)) {
    throw new Error("Confirmação inválida: digite o nome exato para executar esta ação crítica.");
  }
}
