import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, Mail, Save, ShieldCheck, UserCircle } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  changePortalEmailFn,
  changePortalPasswordFn,
  getPortalAccountFn,
  getPortalPrefsFn,
  savePortalPrefsFn,
  updatePortalAccountFn,
} from "@/lib/portal-account.functions";
import { usePortalMode } from "./portal-context";
import { EmptyState, ErrorState, ListSkeleton, portalErrorMessage } from "./portal-shared";

/**
 * Minha conta — nome, foto, telefone, e-mail, senha e preferências de aviso do
 * próprio usuário. Todas as escritas passam pelo servidor e agem SOMENTE sobre
 * a identidade autenticada. Não existe no acesso por link sem senha.
 */

const KIND_LABEL: Record<"approvals" | "deadlines" | "requests" | "comments", string> = {
  approvals: "Novos itens para aprovar",
  deadlines: "Prazos chegando",
  requests: "Respostas nos meus pedidos",
  comments: "Comentários da equipe",
};

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof UserCircle;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-border/60 bg-card p-4 sm:p-5">
      <header className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

export function PortalAccount() {
  const mode = usePortalMode();
  const clientId = mode.kind === "session" ? mode.clientId : "";
  const queryClient = useQueryClient();

  const loadAccount = useServerFn(getPortalAccountFn);
  const saveAccount = useServerFn(updatePortalAccountFn);
  const savePassword = useServerFn(changePortalPasswordFn);
  const saveEmail = useServerFn(changePortalEmailFn);
  const loadPrefs = useServerFn(getPortalPrefsFn);
  const savePrefs = useServerFn(savePortalPrefsFn);

  const accountQ = useQuery({
    queryKey: ["portal", "account"],
    queryFn: () => loadAccount(),
    enabled: mode.kind === "session",
  });
  const prefsQ = useQuery({
    queryKey: ["portal", "prefs", clientId],
    queryFn: () => loadPrefs({ data: { clientId } }),
    enabled: mode.kind === "session" && Boolean(clientId),
  });

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!accountQ.data) return;
    setFullName(accountQ.data.fullName ?? "");
    setPhone(accountQ.data.phone ?? "");
    setEmail(accountQ.data.email ?? "");
  }, [accountQ.data]);

  const profile = useMutation({
    mutationFn: async () =>
      saveAccount({
        data: {
          fullName: fullName.trim(),
          phone: phone.trim() || null,
          avatar: avatarFile
            ? {
                name: avatarFile.name,
                mime: avatarFile.type || null,
                dataBase64: await fileToBase64(avatarFile),
              }
            : null,
        },
      }),
    onSuccess: () => {
      setAvatarFile(null);
      toast.success("Dados atualizados");
      void queryClient.invalidateQueries({ queryKey: ["portal", "account"] });
    },
    onError: (e: Error) => toast.error(portalErrorMessage(e.message) ?? e.message),
  });

  const passwordM = useMutation({
    mutationFn: () => savePassword({ data: { password } }),
    onSuccess: () => {
      setPassword("");
      toast.success("Senha alterada");
      void queryClient.invalidateQueries({ queryKey: ["portal", "account"] });
    },
    onError: (e: Error) => toast.error(portalErrorMessage(e.message) ?? e.message),
  });

  const emailM = useMutation({
    mutationFn: () => saveEmail({ data: { email: email.trim() } }),
    onSuccess: () => toast.success("E-mail de acesso atualizado"),
    onError: (e: Error) => toast.error(portalErrorMessage(e.message) ?? e.message),
  });

  const prefsM = useMutation({
    mutationFn: (next: NonNullable<typeof prefsQ.data>) =>
      savePrefs({ data: { clientId, ...next } }),
    onSuccess: (_r, next) => {
      queryClient.setQueryData(["portal", "prefs", clientId], next);
      toast.success("Preferências salvas");
    },
    onError: (e: Error) => toast.error(portalErrorMessage(e.message) ?? e.message),
  });

  if (mode.kind !== "session") {
    return (
      <EmptyState
        icon={UserCircle}
        title="Conta exige login"
        description="Este acesso é somente de acompanhamento e não tem dados de conta."
      />
    );
  }

  if (accountQ.isLoading) return <ListSkeleton />;
  if (accountQ.isError || !accountQ.data)
    return (
      <ErrorState
        description="Não conseguimos carregar seus dados agora."
        message={(accountQ.error as Error)?.message}
        onRetry={() => void accountQ.refetch()}
      />
    );

  const prefs = prefsQ.data;
  const initials = (fullName || email || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="space-y-4">
      {accountQ.data.requiresPasswordChange ? (
        <div className="flex items-start gap-3 rounded-xl border border-severity-warning/40 bg-severity-warning/10 p-4 text-sm">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-severity-warning" />
          <p>
            Você está usando uma senha temporária. Defina uma senha só sua abaixo para manter seu
            acesso seguro.
          </p>
        </div>
      ) : null}

      <Section icon={UserCircle} title="Seus dados" description="Nome, foto e telefone de contato.">
        <div className="flex items-center gap-4">
          <Avatar className="h-14 w-14">
            <AvatarImage src={accountQ.data.avatarUrl ?? undefined} alt="" />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="acc-avatar">Foto</Label>
            <Input
              id="acc-avatar"
              type="file"
              accept="image/*"
              onChange={(e) => setAvatarFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="acc-name">Nome</Label>
            <Input id="acc-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc-phone">Telefone</Label>
            <Input
              id="acc-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(00) 00000-0000"
            />
          </div>
        </div>
        <Button
          size="sm"
          className="gap-1.5"
          disabled={fullName.trim().length < 2 || profile.isPending}
          onClick={() => profile.mutate()}
        >
          <Save className="h-4 w-4" /> Salvar dados
        </Button>
      </Section>

      <Section icon={KeyRound} title="Senha" description="Use pelo menos 8 caracteres, com letras e números.">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="acc-pass">Nova senha</Label>
            <PasswordInput
              id="acc-pass"
              value={password}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={password.length < 8 || passwordM.isPending}
            onClick={() => passwordM.mutate()}
          >
            Alterar senha
          </Button>
        </div>
      </Section>

      <Section icon={Mail} title="E-mail de acesso" description="É com este e-mail que você entra na sua área.">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="acc-email">E-mail</Label>
            <Input
              id="acc-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!email.includes("@") || email === accountQ.data.email || emailM.isPending}
            onClick={() => emailM.mutate()}
          >
            Atualizar e-mail
          </Button>
        </div>
      </Section>

      <Section
        icon={ShieldCheck}
        title="Avisos por e-mail"
        description="Escolha o que quer receber sobre esta marca."
      >
        {prefsQ.isLoading || !prefs ? (
          <ListSkeleton />
        ) : (
          <div className="space-y-3">
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>Receber avisos por e-mail</span>
              <Switch
                checked={prefs.emailEnabled}
                onCheckedChange={(v) => prefsM.mutate({ ...prefs, emailEnabled: v })}
              />
            </label>
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>Resumo diário em vez de aviso a cada item</span>
              <Switch
                checked={prefs.dailyDigest}
                onCheckedChange={(v) => prefsM.mutate({ ...prefs, dailyDigest: v })}
              />
            </label>
            <div className="space-y-3 border-t border-border/60 pt-3">
              {(Object.keys(KIND_LABEL) as Array<keyof typeof KIND_LABEL>).map((k) => (
                <label key={k} className="flex items-center justify-between gap-4 text-sm">
                  <span>{KIND_LABEL[k]}</span>
                  <Switch
                    checked={prefs.kinds[k]}
                    onCheckedChange={(v) =>
                      prefsM.mutate({ ...prefs, kinds: { ...prefs.kinds, [k]: v } })
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
