/**
 * Registro de acessos (login) — parte client-safe.
 *
 * Contém apenas tipos e funções puras (derivação de dispositivo/navegador e
 * agregação por pessoa/dia). Nada aqui toca banco, segredos ou headers.
 */

export type LoginEventKind = "team" | "portal_client";
export type LoginEventType = "sign_in" | "failed";

export type LoginEvent = {
  id: string;
  user_id: string | null;
  brand_id: string | null;
  client_id: string | null;
  kind: LoginEventKind;
  event: LoginEventType;
  provider: string | null;
  email: string | null;
  device: string | null;
  os: string | null;
  browser: string | null;
  city: string | null;
  country: string | null;
  created_at: string;
};

export type LoginEventRow = LoginEvent & {
  person_name: string;
  person_email: string | null;
  client_name: string | null;
};

export type LoginPersonSummary = {
  userId: string | null;
  name: string;
  email: string | null;
  kind: LoginEventKind;
  clientName: string | null;
  lastSignInAt: string | null;
  signIns: number;
  failed: number;
  topDevice: string | null;
  /** Série diária (ISO date -> acessos) na ordem crescente de data. */
  daily: { date: string; count: number }[];
};

export type UserAgentInfo = { device: string; os: string; browser: string };

/** Deriva dispositivo/sistema/navegador a partir do user agent. */
export function parseUserAgent(ua: string | null | undefined): UserAgentInfo {
  const s = (ua ?? "").trim();
  if (!s) return { device: "Desconhecido", os: "Desconhecido", browser: "Desconhecido" };

  const isTablet = /iPad|Tablet/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s));
  const isMobile = !isTablet && /Mobile|iPhone|iPod|Android|Windows Phone/i.test(s);
  const device = isTablet ? "Tablet" : isMobile ? "Celular" : "Computador";

  const os = /Windows NT/i.test(s)
    ? "Windows"
    : /iPhone|iPad|iPod/i.test(s)
      ? "iOS"
      : /Android/i.test(s)
        ? "Android"
        : /Mac OS X|Macintosh/i.test(s)
          ? "macOS"
          : /CrOS/i.test(s)
            ? "ChromeOS"
            : /Linux/i.test(s)
              ? "Linux"
              : "Desconhecido";

  // Ordem importa: Edge/Opera/Chrome se declaram como Safari/Chrome.
  const browser = /Edg\//i.test(s)
    ? "Edge"
    : /OPR\/|Opera/i.test(s)
      ? "Opera"
      : /SamsungBrowser/i.test(s)
        ? "Samsung Internet"
        : /Firefox\/|FxiOS/i.test(s)
          ? "Firefox"
          : /CriOS|Chrome\//i.test(s)
            ? "Chrome"
            : /Safari\//i.test(s)
              ? "Safari"
              : "Desconhecido";

  return { device, os, browser };
}

/** Guarda apenas o prefixo do IP (2 primeiros blocos IPv4 / 3 grupos IPv6). */
export function ipPrefix(ip: string | null | undefined): string | null {
  const s = (ip ?? "").split(",")[0]?.trim();
  if (!s) return null;
  if (s.includes(":")) {
    const groups = s.split(":").filter(Boolean).slice(0, 3);
    return groups.length ? `${groups.join(":")}::` : null;
  }
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.x.x`;
}

/** Data (ISO yyyy-mm-dd) do instante no fuso informado. */
export function dayKey(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

/**
 * Agrega eventos por pessoa. `people` garante que quem nunca acessou também
 * apareça na lista (com `lastSignInAt` nulo).
 */
export function summarizeByPerson(
  events: LoginEventRow[],
  people: {
    userId: string | null;
    name: string;
    email: string | null;
    kind: LoginEventKind;
    clientName: string | null;
  }[],
  timeZone = "America/Sao_Paulo",
): LoginPersonSummary[] {
  const map = new Map<string, LoginPersonSummary>();
  const keyOf = (userId: string | null, email: string | null) =>
    userId ?? `email:${(email ?? "").toLowerCase()}`;

  for (const p of people) {
    map.set(keyOf(p.userId, p.email), {
      userId: p.userId,
      name: p.name,
      email: p.email,
      kind: p.kind,
      clientName: p.clientName,
      lastSignInAt: null,
      signIns: 0,
      failed: 0,
      topDevice: null,
      daily: [],
    });
  }

  const devices = new Map<string, Map<string, number>>();
  const days = new Map<string, Map<string, number>>();

  for (const e of events) {
    const key = keyOf(e.user_id, e.person_email ?? e.email);
    let entry = map.get(key);
    if (!entry) {
      entry = {
        userId: e.user_id,
        name: e.person_name,
        email: e.person_email ?? e.email,
        kind: e.kind,
        clientName: e.client_name,
        lastSignInAt: null,
        signIns: 0,
        failed: 0,
        topDevice: null,
        daily: [],
      };
      map.set(key, entry);
    }
    if (e.event === "failed") {
      entry.failed += 1;
      continue;
    }
    entry.signIns += 1;
    if (!entry.lastSignInAt || e.created_at > entry.lastSignInAt) entry.lastSignInAt = e.created_at;

    const dev = e.device ?? "Desconhecido";
    const devMap = devices.get(key) ?? new Map<string, number>();
    devMap.set(dev, (devMap.get(dev) ?? 0) + 1);
    devices.set(key, devMap);

    const d = dayKey(e.created_at, timeZone);
    if (d) {
      const dayMap = days.get(key) ?? new Map<string, number>();
      dayMap.set(d, (dayMap.get(d) ?? 0) + 1);
      days.set(key, dayMap);
    }
  }

  for (const [key, entry] of map) {
    const devMap = devices.get(key);
    if (devMap && devMap.size > 0) {
      entry.topDevice = [...devMap.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    }
    const dayMap = days.get(key);
    entry.daily = dayMap
      ? [...dayMap.entries()]
          .map(([date, count]) => ({ date, count }))
          .sort((a, b) => a.date.localeCompare(b.date))
      : [];
  }

  return [...map.values()].sort((a, b) => {
    if (a.lastSignInAt && b.lastSignInAt) return b.lastSignInAt.localeCompare(a.lastSignInAt);
    if (a.lastSignInAt) return -1;
    if (b.lastSignInAt) return 1;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}

export type LoginActivitySummary = {
  activeToday: number;
  active7d: number;
  active30d: number;
  totalSignIns: number;
  failed: number;
  neverAccessed: number;
};

/** Contagens do topo da tela, calculadas sobre os eventos do período. */
export function computeActivitySummary(
  events: LoginEventRow[],
  people: number,
  now = new Date(),
  timeZone = "America/Sao_Paulo",
): LoginActivitySummary {
  const today = dayKey(now.toISOString(), timeZone);
  const ms = now.getTime();
  const uniq = { today: new Set<string>(), d7: new Set<string>(), d30: new Set<string>() };
  const everyone = new Set<string>();
  let totalSignIns = 0;
  let failed = 0;

  for (const e of events) {
    const key = e.user_id ?? `email:${(e.email ?? "").toLowerCase()}`;
    if (e.event === "failed") {
      failed += 1;
      continue;
    }
    totalSignIns += 1;
    everyone.add(key);
    const t = new Date(e.created_at).getTime();
    const ageDays = (ms - t) / 86_400_000;
    if (dayKey(e.created_at, timeZone) === today) uniq.today.add(key);
    if (ageDays <= 7) uniq.d7.add(key);
    if (ageDays <= 30) uniq.d30.add(key);
  }

  return {
    activeToday: uniq.today.size,
    active7d: uniq.d7.size,
    active30d: uniq.d30.size,
    totalSignIns,
    failed,
    neverAccessed: Math.max(0, people - everyone.size),
  };
}

/** Linhas do CSV exportado (cabeçalho + dados), já em pt-BR. */
export function toCsv(rows: LoginEventRow[], formatDate: (iso: string) => string): string {
  const head = [
    "Data/hora",
    "Pessoa",
    "E-mail",
    "Tipo",
    "Cliente",
    "Resultado",
    "Dispositivo",
    "Sistema",
    "Navegador",
    "Cidade",
    "País",
  ];
  const esc = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const body = rows.map((r) =>
    [
      formatDate(r.created_at),
      r.person_name,
      r.person_email ?? r.email,
      r.kind === "portal_client" ? "Cliente do portal" : "Equipe",
      r.client_name,
      r.event === "failed" ? "Falhou" : "Entrou",
      r.device,
      r.os,
      r.browser,
      r.city,
      r.country,
    ]
      .map(esc)
      .join(";"),
  );
  return [head.map(esc).join(";"), ...body].join("\n");
}
