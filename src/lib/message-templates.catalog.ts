// Catálogo de eventos, variáveis e defaults dos templates de comunicação.
// Único source-of-truth versionado em código.

export type Channel = "email" | "whatsapp";

export type VariableDef = {
  key: string; // ex: "brand.name"
  label: string; // ex: "Nome da marca"
  sample: string; // valor usado no preview e no envio de teste
};

export type EventDef = {
  key: string;
  name: string;
  description: string;
  category: "Time" | "Cliente" | "Portal" | "Aprovação" | "Produção" | "Relatórios" | "Financeiro";
  channels: Channel[];
  variables: VariableDef[];
  defaults: Partial<Record<Channel, { subject?: string; body: string }>>;
};

const V = {
  brand_name: { key: "brand.name", label: "Nome da marca", sample: "Sua agência" },
  brand_logo: { key: "brand.logo", label: "Logo da marca", sample: "https://…/logo.png" },
  user_name: { key: "user.full_name", label: "Nome do usuário", sample: "Maria Souza" },
  user_email: { key: "user.email", label: "E-mail do usuário", sample: "maria@exemplo.com" },
  user_role: { key: "user.role", label: "Função no time", sample: "Usuário" },
  client_name: { key: "client.name", label: "Nome do cliente", sample: "Café Origem" },
  client_contact: {
    key: "client.contact_name",
    label: "Contato do cliente",
    sample: "João Alves",
  },
  client_email: { key: "client.email", label: "E-mail do cliente", sample: "joao@cafe.com" },
  post_title: { key: "post.title", label: "Título do post", sample: "Lançamento de outono" },
  post_channel: { key: "post.channel", label: "Canal do post", sample: "Instagram" },
  post_scheduled: {
    key: "post.scheduled_at",
    label: "Data agendada do post",
    sample: "22/07/2026 09:00",
  },
  task_title: { key: "task.title", label: "Título da tarefa", sample: "Revisar copy do carrossel" },
  task_due: { key: "task.due_at", label: "Prazo da tarefa", sample: "24/07/2026" },
  portal_url: {
    key: "portal.url",
    label: "Link do portal",
    sample: "https://sua-instalacao.exemplo/portal/abc123",
  },
  portal_expires: {
    key: "portal.expires_at",
    label: "Validade do link",
    sample: "30/07/2026",
  },
  invite_url: {
    key: "invite.url",
    label: "Link do convite",
    sample: "https://sua-instalacao.exemplo/invite/xyz",
  },
  invite_role: { key: "invite.role", label: "Função convidada", sample: "Usuário" },
  invite_password: {
    key: "invite.password",
    label: "Senha temporária",
    sample: "Xk9!aP2m",
  },
  report_period: { key: "report.period", label: "Período do relatório", sample: "Julho/2026" },
  report_approved: {
    key: "report.approved_count",
    label: "Posts aprovados",
    sample: "42",
  },
  report_published: {
    key: "report.published_count",
    label: "Posts publicados",
    sample: "37",
  },
  report_top: { key: "report.top_post", label: "Melhor post", sample: "Lançamento de outono" },
} satisfies Record<string, VariableDef>;

export const EVENTS: EventDef[] = [
  {
    key: "team_invite",
    name: "Convite de acesso",
    description: "Enviado ao convidar um novo membro para a marca.",
    category: "Time",
    channels: ["email"],
    variables: [V.brand_name, V.user_name, V.invite_url, V.invite_role, V.invite_password],
    defaults: {
      email: {
        subject: "Convite para {{brand.name}}",
        body: `<h2>Você foi convidado para {{brand.name}}</h2>
<p>Olá! Você foi adicionado à marca <strong>{{brand.name}}</strong> como <strong>{{invite.role}}</strong>.</p>
<p>Sua senha temporária é <code>{{invite.password}}</code>. Ela será substituída no primeiro acesso.</p>
<p><a href="{{invite.url}}">Aceitar convite e entrar</a></p>`,
      },
    },
  },
  {
    key: "team_welcome",
    name: "Boas-vindas ao time",
    description: "Enviado após aceitar o convite.",
    category: "Time",
    channels: ["email"],
    variables: [V.brand_name, V.user_name, V.user_role],
    defaults: {
      email: {
        subject: "Bem-vindo(a) à {{brand.name}}",
        body: `<h2>Olá {{user.full_name}}, boas-vindas!</h2>
<p>Você agora faz parte de {{brand.name}} como {{user.role}}.</p>
<p>Explore o painel, conecte clientes e comece a produzir conteúdo em minutos.</p>`,
      },
    },
  },
  {
    key: "password_reset",
    name: "Recuperação de senha",
    description: "Enviado no fluxo de esqueci minha senha.",
    category: "Time",
    channels: ["email"],
    variables: [V.brand_name, V.user_name, V.invite_url],
    defaults: {
      email: {
        subject: "Redefinir sua senha em {{brand.name}}",
        body: `<p>Olá {{user.full_name}},</p>
<p>Recebemos um pedido para redefinir sua senha. Se foi você, use o link abaixo (válido por 60 minutos):</p>
<p><a href="{{invite.url}}">Redefinir senha</a></p>
<p>Se não foi você, ignore este e-mail.</p>`,
      },
    },
  },
  {
    key: "client_onboarding",
    name: "Cliente cadastrado",
    description: "Notificação enviada ao contato do cliente logo após o cadastro.",
    category: "Cliente",
    channels: ["email"],
    variables: [V.brand_name, V.client_name, V.client_contact],
    defaults: {
      email: {
        subject: "{{client.name}} · seu espaço em {{brand.name}} está pronto",
        body: `<p>Olá {{client.contact_name}},</p>
<p>Sua conta <strong>{{client.name}}</strong> foi criada em {{brand.name}}. A partir de agora, todo o conteúdo, aprovações e relatórios ficam em um único lugar.</p>
<p>Em breve você receberá o link do portal para acompanhar o dia a dia.</p>`,
      },
    },
  },
  {
    key: "client_briefing_request",
    name: "Solicitar briefing",
    description: "Envia o link do briefing ao cliente.",
    category: "Cliente",
    channels: ["email"],
    variables: [V.brand_name, V.client_contact, V.portal_url, V.portal_expires],
    defaults: {
      email: {
        subject: "Precisamos do seu briefing · {{brand.name}}",
        body: `<p>Oi {{client.contact_name}}, tudo bem?</p>
<p>Preparamos um formulário rápido para captar as informações da sua marca. Ele leva menos de 10 minutos.</p>
<p><a href="{{portal.url}}">Abrir briefing</a> · válido até {{portal.expires_at}}.</p>`,
      },
    },
  },
  {
    key: "portal_access",
    name: "Acesso ao portal",
    description: "Compartilha o portal white-label com o cliente.",
    category: "Portal",
    channels: ["email", "whatsapp"],
    variables: [V.brand_name, V.client_contact, V.portal_url, V.portal_expires],
    defaults: {
      email: {
        subject: "Seu portal em {{brand.name}}",
        body: `<p>Olá {{client.contact_name}},</p>
<p>Este é o seu portal exclusivo em {{brand.name}}. Aqui você aprova conteúdo, acompanha o calendário e baixa relatórios.</p>
<p><a href="{{portal.url}}">Abrir portal</a> · válido até {{portal.expires_at}}.</p>`,
      },
      whatsapp: {
        body: `Olá {{client.contact_name}}! 👋\n\nSeu portal em *{{brand.name}}* está pronto:\n{{portal.url}}\n\n_Link válido até {{portal.expires_at}}._`,
      },
    },
  },
  {
    key: "post_pending_approval",
    name: "Post aguardando aprovação",
    description: "Avisa o cliente de novos posts para aprovar.",
    category: "Aprovação",
    channels: ["email", "whatsapp"],
    variables: [V.brand_name, V.client_contact, V.post_title, V.post_channel, V.portal_url],
    defaults: {
      email: {
        subject: "Novo post para aprovar · {{post.title}}",
        body: `<p>Oi {{client.contact_name}}!</p>
<p>Temos um novo conteúdo aguardando sua aprovação: <strong>{{post.title}}</strong> ({{post.channel}}).</p>
<p><a href="{{portal.url}}">Revisar no portal</a></p>`,
      },
      whatsapp: {
        body: `Oi {{client.contact_name}}! Novo post para aprovar em *{{brand.name}}*:\n\n*{{post.title}}* — {{post.channel}}\n\n👉 {{portal.url}}`,
      },
    },
  },
  {
    key: "post_approved",
    name: "Post aprovado pelo cliente",
    description: "Notifica a equipe quando o cliente aprova.",
    category: "Aprovação",
    channels: ["whatsapp", "email"],
    variables: [V.brand_name, V.client_name, V.post_title, V.post_scheduled],
    defaults: {
      whatsapp: {
        body: `✅ *{{client.name}}* aprovou:\n\n_{{post.title}}_\nAgendado para {{post.scheduled_at}}.`,
      },
      email: {
        subject: "{{client.name}} aprovou {{post.title}}",
        body: `<p>O cliente <strong>{{client.name}}</strong> aprovou o post <strong>{{post.title}}</strong>. Agendado para {{post.scheduled_at}}.</p>`,
      },
    },
  },
  {
    key: "post_rejected",
    name: "Post recusado pelo cliente",
    description: "Alerta a equipe de ajustes solicitados.",
    category: "Aprovação",
    channels: ["whatsapp", "email"],
    variables: [V.brand_name, V.client_name, V.post_title],
    defaults: {
      whatsapp: {
        body: `⚠️ *{{client.name}}* pediu ajustes em:\n\n_{{post.title}}_\n\nAbra o card para ver os comentários.`,
      },
      email: {
        subject: "Ajustes solicitados · {{post.title}}",
        body: `<p>O cliente <strong>{{client.name}}</strong> pediu ajustes em <strong>{{post.title}}</strong>. Confira os comentários no card.</p>`,
      },
    },
  },
  {
    key: "task_assigned",
    name: "Nova tarefa atribuída",
    description: "Envia quando um responsável é definido em uma tarefa.",
    category: "Produção",
    channels: ["whatsapp", "email"],
    variables: [V.brand_name, V.user_name, V.task_title, V.task_due],
    defaults: {
      whatsapp: {
        body: `📌 Oi {{user.full_name}}! Você recebeu uma nova tarefa em *{{brand.name}}*:\n\n_{{task.title}}_\nPrazo: {{task.due_at}}`,
      },
      email: {
        subject: "Nova tarefa · {{task.title}}",
        body: `<p>Olá {{user.full_name}}, você foi atribuído à tarefa <strong>{{task.title}}</strong>. Prazo: {{task.due_at}}.</p>`,
      },
    },
  },
  {
    key: "weekly_report",
    name: "Relatório semanal",
    description: "Resumo semanal de performance.",
    category: "Relatórios",
    channels: ["email"],
    variables: [
      V.brand_name,
      V.client_name,
      V.client_contact,
      V.report_period,
      V.report_approved,
      V.report_published,
      V.report_top,
    ],
    defaults: {
      email: {
        subject: "Resumo da semana · {{client.name}}",
        body: `<h2>Resumo da semana — {{report.period}}</h2>
<p>Oi {{client.contact_name}}, aqui está o resumo do que rolou em {{client.name}}:</p>
<ul>
  <li><strong>{{report.approved_count}}</strong> posts aprovados</li>
  <li><strong>{{report.published_count}}</strong> posts publicados</li>
  <li>Destaque da semana: <strong>{{report.top_post}}</strong></li>
</ul>
<p>Bom fim de semana! — Time {{brand.name}}</p>`,
      },
    },
  },
  {
    key: "monthly_report",
    name: "Relatório mensal",
    description: "Relatório completo com KPIs e insights.",
    category: "Relatórios",
    channels: ["email"],
    variables: [
      V.brand_name,
      V.client_name,
      V.client_contact,
      V.report_period,
      V.report_approved,
      V.report_published,
      V.report_top,
    ],
    defaults: {
      email: {
        subject: "Relatório mensal · {{report.period}} — {{client.name}}",
        body: `<h2>Relatório de {{report.period}}</h2>
<p>Olá {{client.contact_name}}! Este é o retrato completo do mês para {{client.name}}.</p>
<h3>Números principais</h3>
<ul>
  <li>{{report.approved_count}} aprovações</li>
  <li>{{report.published_count}} publicações</li>
  <li>Melhor post: {{report.top_post}}</li>
</ul>
<p>Vamos para o próximo mês com ainda mais consistência.</p>`,
      },
    },
  },
  {
    key: "payment_reminder",
    name: "Lembrete de pagamento",
    description: "Aviso amigável de fatura em aberto.",
    category: "Financeiro",
    channels: ["email"],
    variables: [V.brand_name, V.client_contact, V.client_name],
    defaults: {
      email: {
        subject: "Lembrete de pagamento · {{client.name}}",
        body: `<p>Olá {{client.contact_name}}, este é um lembrete amigável da fatura em aberto de {{client.name}}.</p>
<p>Qualquer dúvida, é só responder este e-mail.</p>
<p>— Financeiro {{brand.name}}</p>`,
      },
    },
  },
];

export function getEvent(key: string): EventDef | undefined {
  return EVENTS.find((e) => e.key === key);
}

export function getDefault(
  eventKey: string,
  channel: Channel,
): { subject?: string; body: string } | undefined {
  return getEvent(eventKey)?.defaults[channel];
}

// Substitui {{var}} pelos valores do context. Faltantes ficam com "—".
export function renderTemplateString(
  template: string,
  context: Record<string, string | number | undefined | null>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9._-]+)\s*\}\}/g, (_, key: string) => {
    const v = context[key];
    if (v === undefined || v === null || v === "") return "—";
    return String(v);
  });
}

export function buildSampleContext(event: EventDef): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of event.variables) out[v.key] = v.sample;
  return out;
}
