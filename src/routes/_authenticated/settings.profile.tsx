import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Bell,
  Clock,
  Globe,
  KeyRound,
  Loader2,
  MessageCircle,
  Phone,
  Save,
  ShieldCheck,
  User,
} from "lucide-react";

import { getMyProfile, updateMyProfile, changeMyPassword } from "@/lib/profile.functions";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePageHeader } from "@/hooks/use-page-header";
import {
  SettingsBlock,
  SettingsField,
  SettingsFieldGrid,
  SettingsMetaItem,
  SettingsMetaList,
  SettingsRow,
  settingsSegmentedListClass,
  settingsSegmentedTriggerClass,
} from "@/components/settings/settings-form-ui";
import { AvatarUploader } from "@/components/settings/avatar-uploader";

export const Route = createFileRoute("/_authenticated/settings/profile")({
  component: ProfilePage,
});

const TIMEZONES = [
  "America/Sao_Paulo",
  "America/Fortaleza",
  "America/Recife",
  "America/Manaus",
  "America/Bahia",
  "America/Belem",
  "America/Cuiaba",
  "America/Rio_Branco",
  "America/Noronha",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Lisbon",
  "Europe/Madrid",
  "Europe/Paris",
  "UTC",
];

const LOCALES = [
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "en-US", label: "English (US)" },
  { value: "es-ES", label: "Español" },
];

type FormState = {
  full_name: string;
  phone: string;
  job_title: string;
  bio: string;
  timezone: string;
  locale: string;
  avatar_url: string;
  whatsapp: string;
};

function toForm(data: {
  full_name?: string | null;
  phone?: string | null;
  job_title?: string | null;
  bio?: string | null;
  timezone?: string | null;
  locale?: string | null;
  avatar_url?: string | null;
  whatsapp?: string | null;
}): FormState {
  return {
    full_name: data.full_name ?? "",
    phone: data.phone ?? "",
    job_title: data.job_title ?? "",
    bio: data.bio ?? "",
    timezone: data.timezone ?? "America/Sao_Paulo",
    locale: data.locale ?? "pt-BR",
    avatar_url: data.avatar_url ?? "",
    whatsapp: data.whatsapp ?? "",
  };
}

function ProfilePage() {
  const qc = useQueryClient();
  const fetchProfile = useServerFn(getMyProfile);
  const saveProfile = useServerFn(updateMyProfile);
  const changePassword = useServerFn(changeMyPassword);

  const { data, isLoading } = useQuery({
    queryKey: ["me", "profile"],
    queryFn: () => fetchProfile(),
  });

  const [form, setForm] = useState<FormState | null>(null);
  const [pw, setPw] = useState({ next: "", confirm: "" });

  useEffect(() => {
    if (data && !form) setForm(toForm(data));
  }, [data, form]);

  const initials = useMemo(() => {
    const n = form?.full_name ?? data?.full_name ?? data?.email ?? "?";
    return (
      n
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() ?? "")
        .join("") || "U"
    );
  }, [form?.full_name, data?.full_name, data?.email]);

  const baseline = useMemo(() => (data ? toForm(data) : null), [data]);
  const dirty = useMemo(() => {
    if (!form || !baseline) return false;
    return (Object.keys(baseline) as Array<keyof FormState>).some((k) => form[k] !== baseline[k]);
  }, [form, baseline]);

  const saveMutation = useMutation({
    mutationFn: async (payload: FormState) =>
      saveProfile({
        data: {
          full_name: payload.full_name.trim(),
          phone: payload.phone.trim() || null,
          job_title: payload.job_title.trim() || null,
          bio: payload.bio.trim() || null,
          timezone: payload.timezone,
          locale: payload.locale,
          avatar_url: payload.avatar_url.trim() || null,
          whatsapp: payload.whatsapp.trim() || null,
        },
      }),
    onSuccess: async () => {
      toast.success("Perfil atualizado");
      await qc.invalidateQueries({ queryKey: ["me", "profile"] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar perfil");
    },
  });

  usePageHeader(
    {
      title: "Perfil",
      subtitle: "Suas informações pessoais e preferências de conta",
      actions:
        form && dirty ? (
          <Button
            size="sm"
            onClick={() => form && saveMutation.mutate(form)}
            disabled={saveMutation.isPending || !form.full_name.trim()}
          >
            {saveMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Salvar alterações
          </Button>
        ) : undefined,
    },
    [form, dirty, saveMutation.isPending],
  );

  const pwMutation = useMutation({
    mutationFn: async (newPassword: string) => changePassword({ data: { newPassword } }),
    onSuccess: () => {
      toast.success("Senha atualizada");
      setPw({ next: "", confirm: "" });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao alterar senha"),
  });

  if (isLoading || !form) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-10 px-4 py-10 sm:px-6 lg:px-10">
        <div className="flex items-center gap-5">
          <Skeleton className="h-20 w-20 rounded-2xl" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-11 w-56 rounded-xl" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }

  const roleLabel = (data?.role ?? "member").toString();
  const isAdmin = /admin|owner/i.test(roleLabel);
  const localeLabel = LOCALES.find((l) => l.value === form.locale)?.label ?? form.locale;
  const tzShort = form.timezone.split("/")[1]?.replace("_", " ") ?? form.timezone;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-10">
      {/* Apresentação do perfil */}
      <header className="flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-7">
        <AvatarUploader
          userId={data?.id ?? ""}
          value={form.avatar_url}
          initials={initials}
          name={form.full_name || "Perfil"}
          onChange={(next) => setForm({ ...form, avatar_url: next })}
          className="shrink-0"
        />
        <div className="min-w-0 sm:border-l sm:border-border/50 sm:pl-7">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
              {form.full_name || "Sem nome"}
            </h1>
            <span
              className={
                isAdmin
                  ? "shrink-0 rounded-full border border-brand-lime/40 bg-brand-lime/15 px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-brand-lime-foreground"
                  : "shrink-0 rounded-full border border-border bg-muted px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground"
              }
            >
              {roleLabel}
            </span>
          </div>
          <p className="mt-1.5 truncate text-[13.5px] text-muted-foreground">
            {data?.email ?? "—"}
          </p>
          {form.job_title ? (
            <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{form.job_title}</p>
          ) : null}
        </div>
      </header>

      <div className="mt-10 border-y border-border/50 py-7">
        <SettingsMetaList>
          <SettingsMetaItem
            label="Função"
            icon={<User className="h-3.5 w-3.5" />}
            value={<span className="capitalize">{roleLabel}</span>}
          />
          <SettingsMetaItem label="Fuso" icon={<Clock className="h-3.5 w-3.5" />} value={tzShort} />
          <SettingsMetaItem
            label="Idioma"
            icon={<Globe className="h-3.5 w-3.5" />}
            value={localeLabel}
          />
          <SettingsMetaItem
            label="WhatsApp"
            icon={<MessageCircle className="h-3.5 w-3.5" />}
            value={form.whatsapp || "não informado"}
          />
          <SettingsMetaItem
            label="Telefone"
            icon={<Phone className="h-3.5 w-3.5" />}
            value={form.phone || "não informado"}
          />
        </SettingsMetaList>
      </div>

      {dirty ? (
        <p className="mt-6 flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-lime" aria-hidden />
          Alterações pendentes — use “Salvar alterações” no topo da página.
        </p>
      ) : null}

      <Tabs defaultValue="personal" className="mt-8 w-full">
        <TabsList className={settingsSegmentedListClass}>
          <TabsTrigger value="personal" className={settingsSegmentedTriggerClass}>
            Pessoal
          </TabsTrigger>
          <TabsTrigger value="security" className={settingsSegmentedTriggerClass}>
            Segurança
          </TabsTrigger>
        </TabsList>

        <TabsContent value="personal" className="mt-10">
          <SettingsBlock
            title="Identificação"
            description="Como seu nome aparece para o time em pautas, tarefas e comentários."
          >
            <SettingsFieldGrid>
              <SettingsField label="Nome completo" htmlFor="full_name">
                <Input
                  id="full_name"
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  maxLength={120}
                  placeholder="Seu nome"
                />
              </SettingsField>
              <SettingsField label="Cargo" htmlFor="job_title">
                <Input
                  id="job_title"
                  value={form.job_title}
                  onChange={(e) => setForm({ ...form, job_title: e.target.value })}
                  maxLength={120}
                  placeholder="Ex: Estrategista de conteúdo"
                />
              </SettingsField>
              <SettingsField
                label="Bio"
                htmlFor="bio"
                full
                hint="Aparece no seu perfil para o time. Máximo de 600 caracteres."
              >
                <Textarea
                  id="bio"
                  value={form.bio}
                  onChange={(e) => setForm({ ...form, bio: e.target.value })}
                  rows={6}
                  maxLength={600}
                  className="min-h-32 resize-y leading-relaxed"
                  placeholder="Uma breve descrição sobre você"
                />
              </SettingsField>
            </SettingsFieldGrid>
          </SettingsBlock>

          <SettingsBlock
            title="Contato"
            description="Usado pelo time e pelos avisos enviados a você."
          >
            <SettingsFieldGrid>
              <SettingsField label="Telefone" htmlFor="phone">
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  maxLength={40}
                  placeholder="+55 11 90000-0000"
                />
              </SettingsField>
              <SettingsField
                label="WhatsApp"
                htmlFor="whatsapp"
                hint="Destino usado pelas notificações por WhatsApp."
              >
                <Input
                  id="whatsapp"
                  value={form.whatsapp}
                  onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                  maxLength={40}
                  placeholder="+55 11 90000-0000"
                />
              </SettingsField>
            </SettingsFieldGrid>
          </SettingsBlock>

          <SettingsBlock
            title="Região e formato"
            description="Definem datas, horários e o idioma da interface."
          >
            <SettingsFieldGrid>
              <SettingsField label="Fuso horário" htmlFor="timezone">
                <Select
                  value={form.timezone}
                  onValueChange={(v) => setForm({ ...form, timezone: v })}
                >
                  <SelectTrigger id="timezone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingsField>
              <SettingsField label="Idioma" htmlFor="locale">
                <Select value={form.locale} onValueChange={(v) => setForm({ ...form, locale: v })}>
                  <SelectTrigger id="locale">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOCALES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingsField>
            </SettingsFieldGrid>
          </SettingsBlock>

          <SettingsBlock
            title="Notificações"
            description="Canais e tipos de aviso ficam em um único lugar."
          >
            <SettingsRow
              icon={<Bell className="h-4 w-4" />}
              title="Preferências de notificação"
              description="E-mail, push e WhatsApp, além dos tipos de aviso que você recebe."
              action={
                <Button asChild size="sm" variant="outline" className="w-full sm:w-auto">
                  <Link to="/settings/notifications">Abrir Notificações</Link>
                </Button>
              }
            />
          </SettingsBlock>
        </TabsContent>

        <TabsContent value="security" className="mt-10">
          <SettingsBlock
            title="Senha"
            description="Use no mínimo 8 caracteres. Você seguirá conectado após a alteração."
          >
            <SettingsFieldGrid>
              <SettingsField label="Nova senha" htmlFor="pw_new">
                <PasswordInput
                  id="pw_new"
                  value={pw.next}
                  onChange={(e) => setPw({ ...pw, next: e.target.value })}
                  autoComplete="new-password"
                  minLength={8}
                  placeholder="Mínimo 8 caracteres"
                />
              </SettingsField>
              <SettingsField label="Confirmar senha" htmlFor="pw_confirm">
                <PasswordInput
                  id="pw_confirm"
                  value={pw.confirm}
                  onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                  autoComplete="new-password"
                  placeholder="Repita a nova senha"
                />
              </SettingsField>
              <div className="sm:col-span-2 sm:flex sm:justify-end">
                <Button
                  className="w-full sm:w-auto"
                  disabled={pwMutation.isPending || pw.next.length < 8 || pw.next !== pw.confirm}
                  onClick={() => {
                    if (pw.next !== pw.confirm) {
                      toast.error("As senhas não coincidem");
                      return;
                    }
                    pwMutation.mutate(pw.next);
                  }}
                >
                  {pwMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <KeyRound className="mr-2 h-4 w-4" />
                  )}
                  Atualizar senha
                </Button>
              </div>
            </SettingsFieldGrid>
          </SettingsBlock>

          <SettingsBlock title="Sessão" description="Informações de acesso vinculadas à sua conta.">
            <SettingsRow
              icon={<ShieldCheck className="h-4 w-4" />}
              title={data?.email ?? "—"}
              description="E-mail de login. Para alterá-lo, fale com quem administra o workspace."
            />
          </SettingsBlock>
        </TabsContent>
      </Tabs>
    </div>
  );
}
