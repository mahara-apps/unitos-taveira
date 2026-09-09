import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Plus, RefreshCw, Search, Server } from "lucide-react";

import {
  createInstallationFn,
  getInstallationManagerAccessFn,
  getMasterVersionFn,
  listInstallationsFn,
  type InstallationRecord,
} from "@/lib/installation/manager.functions";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageKpi, PageKpiGrid } from "@/components/ui/page-kpi";
import { InstallationCard } from "@/components/installations/installation-card";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/instalacoes/")({
  component: AdminInstallationsPage,
});

type FormState = {
  name: string;
  domain: string;
  supabaseUrl: string;
  supabaseProjectRef: string;
  gitRepoUrl: string;
  deployProject: string;
  notes: string;
  supabaseManagementToken: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  domain: "",
  supabaseUrl: "",
  supabaseProjectRef: "",
  gitRepoUrl: "",
  deployProject: "",
  notes: "",
  supabaseManagementToken: "",
};

type Filter = "all" | "running" | "outdated" | "problems";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "running", label: "Em execução" },
  { id: "outdated", label: "Atualização" },
  { id: "problems", label: "Atenção" },
];

const matchesFilter = (i: InstallationRecord, filter: Filter) => {
  if (filter === "running") return i.status === "provisioning" || i.status === "validating";
  if (filter === "outdated") return i.status === "update_available";
  if (filter === "problems") return i.status === "error" || i.status === "attention";
  return true;
};

function AdminInstallationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const accessFn = useServerFn(getInstallationManagerAccessFn);
  const listFn = useServerFn(listInstallationsFn);
  const createFn = useServerFn(createInstallationFn);
  const masterVersionFn = useServerFn(getMasterVersionFn);

  const access = useQuery({
    queryKey: ["installation-manager-access"],
    queryFn: () => accessFn(undefined),
    retry: false,
  });
  const available = access.data?.available === true;

  const list = useQuery({
    queryKey: ["installations"],
    queryFn: () => listFn(undefined),
    enabled: available,
    retry: false,
  });

  // Versão que existe no pacote publicado do MASTER: quando fica atrás do
  // sistema, autorizar atualização não envia código novo.
  const masterVersion = useQuery({
    queryKey: ["installations-master-version"],
    queryFn: () => masterVersionFn({ data: undefined }),
    enabled: available,
    retry: false,
  });

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const create = useMutation({
    mutationFn: () => {
      if (!form.supabaseManagementToken.trim()) {
        throw new Error("Informe o Supabase Access Token do cliente para cadastrar a instalação.");
      }
      return createFn({
        data: {
          name: form.name,
          domain: form.domain || null,
          supabaseUrl: form.supabaseUrl || null,
          supabaseProjectRef: form.supabaseProjectRef || null,
          gitRepoUrl: form.gitRepoUrl || null,
          deployProject: form.deployProject || null,
          notes: form.notes || null,
          supabaseManagementToken: form.supabaseManagementToken.trim(),
        },
      });
    },
    onSuccess: (record) => {
      toast.success("Instalação criada. Ela ainda não está pronta.");
      setForm(EMPTY_FORM);
      setCreateOpen(false);
      void qc.invalidateQueries({ queryKey: ["installations"] });
      void navigate({
        to: "/admin/instalacoes/$id",
        params: { id: record.id },
        search: { novo: true },
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const installations = list.data?.installations ?? [];
  const kpis = useMemo(() => {
    const count = (fn: (i: InstallationRecord) => boolean) => installations.filter(fn).length;
    return {
      total: installations.length,
      running: count((i) => i.status === "provisioning" || i.status === "validating"),
      outdated: count((i) => i.status === "update_available"),
      problems: count((i) => i.status === "error" || i.status === "attention"),
    };
  }, [installations]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return installations.filter(
      (i) =>
        matchesFilter(i, filter) &&
        (!term ||
          i.name.toLowerCase().includes(term) ||
          (i.domain ?? "").toLowerCase().includes(term)),
    );
  }, [installations, search, filter]);

  if (access.isLoading) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Verificando disponibilidade do módulo…
      </div>
    );
  }

  if (!available) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          O módulo de Instalações existe apenas na instalação MASTER do Unitos e é exclusivo do
          Super Admin.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold">Instalações</h2>
            <Badge variant="outline" className="text-[10px]">
              {installations.length} cadastrada{installations.length === 1 ? "" : "s"}
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
              MASTER {access.data?.releaseVersion}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Cada instalação é uma aplicação independente — só metadados ficam aqui, nunca
            credenciais do destino.
          </p>
        </div>
        <Button size="sm" className="shrink-0" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Nova instalação
        </Button>
      </header>

      {masterVersion.data?.masterPublished === false && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          <strong>MASTER não publicado.</strong> O pacote de código disponível para as instalações
          está na versão {masterVersion.data.repoRelease ?? "—"} e o sistema já está em{" "}
          {masterVersion.data.release}. Publique o MASTER antes de autorizar atualizações — sem isso
          as instalações recebem o mesmo código de novo.
        </div>
      )}

      <PageKpiGrid>
        <PageKpi icon={<Server />} label="Total" value={kpis.total} />
        <PageKpi icon={<Loader2 />} label="Em execução" value={kpis.running} status="info" />
        <PageKpi
          icon={<RefreshCw />}
          label="Atualização disponível"
          value={kpis.outdated}
          status="warning"
        />
        <PageKpi icon={<AlertTriangle />} label="Atenção" value={kpis.problems} status="danger" />
      </PageKpiGrid>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="relative min-w-0">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou domínio"
            className="h-9 pl-9"
          />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {FILTERS.map((f) => (
            <Button
              key={f.id}
              size="sm"
              variant={filter === f.id ? "secondary" : "ghost"}
              className={cn("h-9 text-xs", filter === f.id && "font-semibold")}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {list.isLoading ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {[0, 1, 2, 3].map((n) => (
            <Card key={n}>
              <CardContent className="space-y-3 p-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : installations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <Server className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">Nenhuma instalação cadastrada</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Cadastre a primeira instalação para provisionar, validar e acompanhar a versão
              publicada.
            </p>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Nova instalação
            </Button>
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nenhuma instalação corresponde à busca ou ao filtro selecionado.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {visible.map((i) => (
            <InstallationCard
              key={i.id}
              installation={i}
              onOpen={() => void navigate({ to: "/admin/instalacoes/$id", params: { id: i.id } })}
            />
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>Nova instalação</DialogTitle>
            <DialogDescription>
              Cada instalação usa o acesso do próprio cliente. Informe o Supabase Access Token dele:
              ele é guardado cifrado e nunca aparece de novo na tela.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Field
              label="Domínio"
              placeholder="app.cliente.com.br"
              value={form.domain}
              onChange={(v) => setForm({ ...form, domain: v })}
            />
            <Field
              label="URL do Supabase"
              placeholder="https://xxxx.supabase.co"
              value={form.supabaseUrl}
              onChange={(v) => setForm({ ...form, supabaseUrl: v })}
            />
            <Field
              label="Project ref do Supabase"
              value={form.supabaseProjectRef}
              onChange={(v) => setForm({ ...form, supabaseProjectRef: v })}
            />
            <Field
              label="Repositório Git"
              placeholder="https://github.com/org/repo"
              value={form.gitRepoUrl}
              onChange={(v) => setForm({ ...form, gitRepoUrl: v })}
            />
            <Field
              label="Projeto de deploy"
              value={form.deployProject}
              onChange={(v) => setForm({ ...form, deployProject: v })}
            />
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Supabase Access Token do cliente</Label>
              <PasswordInput
                value={form.supabaseManagementToken}
                placeholder="sbp_..."
                autoComplete="off"
                onChange={(e) => setForm({ ...form, supabaseManagementToken: e.target.value })}
              />
              <p className="text-[11px] text-muted-foreground">
                Obrigatório. Guardado cifrado e nunca exibido outra vez — esta instalação usa o
                acesso do próprio cliente, não o acesso central.{" "}
                <a
                  href="https://supabase.com/dashboard/account/tokens"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Gerar token no Supabase
                </a>
                .
              </p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Observações</Label>
              <Textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cadastrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{props.label}</Label>
      <Input
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}
