/**
 * Agência — área única de administração do workspace/instalação.
 *
 * Organização (sem popover, sem menu improvisado):
 *   1) Workspaces + workspace selecionado + ações (Editar / Inativar / Excluir);
 *   2) Dados cadastrais unificados (empresa + endereço no mesmo formulário);
 *   3) Áreas administrativas (Equipe & Acesso, Permissões, Auditoria) como
 *      destinos separados — não são misturadas nesta tela;
 *   4) Identidade visual: EXCLUSIVA de Super Admin.
 *
 * RBAC e backend preservados: a autoridade real segue nas server functions.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Building2,
  ChevronRight,
  History,
  Loader2,
  MapPin,
  Palette,
  Save,
  ShieldCheck,
  Users,
} from "lucide-react";

import { BrandingSlots } from "@/components/settings/branding-slots";
import { WorkspaceManagement } from "@/components/workspace/workspace-management";
import { getBrandCompany, updateBrandCompany } from "@/lib/workspace.functions";
import { useActiveContext } from "@/hooks/use-active-context";
import { useIsSuperAdmin } from "@/hooks/use-feature-access";
import { usePageHeader } from "@/hooks/use-page-header";
import { canAccessVisualIdentity } from "@/lib/workspace-admin";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/settings/identity")({
  component: IdentityPage,
});

type CompanyState = {
  cpf: string;
  cnpj: string;
  nome_fantasia: string;
  razao_social: string;
  cep: string;
  rua: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
};

const UFS = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
];

const ADMIN_AREAS = [
  {
    to: "/settings/team" as const,
    label: "Equipe & Acesso",
    description: "Membros, papéis e convites do workspace.",
    icon: Users,
  },
  {
    to: "/settings/permissions" as const,
    label: "Permissões",
    description: "Matriz de autoridade por papel.",
    icon: ShieldCheck,
  },
  {
    to: "/settings/logs" as const,
    label: "Auditoria",
    description: "Histórico de ações administrativas.",
    icon: History,
  },
];

function IdentityPage() {
  const { brandId } = useActiveContext();
  // Identidade visual é white label do AMBIENTE: só Super Admin vê a seção.
  const superAdminQ = useIsSuperAdmin();
  const canSeeVisualIdentity = canAccessVisualIdentity(superAdminQ.data?.isSuperAdmin);
  usePageHeader({ title: "Agência", subtitle: "Administração do workspace e dados cadastrais" }, []);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-6">
      <WorkspaceManagement />

      {brandId ? (
        <CompanyPanel brandId={brandId} />
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Selecione um workspace acima para ver e editar os dados cadastrais.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-base">Áreas administrativas</CardTitle>
          <CardDescription>
            Gestão de pessoas, autoridade e histórico permanecem em telas próprias.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-3">
          {ADMIN_AREAS.map((area) => (
            <Link
              key={area.to}
              to={area.to}
              className="flex items-start gap-3 rounded-xl border border-border/60 p-3 transition hover:bg-muted/50"
            >
              <area.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{area.label}</p>
                <p className="text-xs text-muted-foreground">{area.description}</p>
              </div>
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </CardContent>
      </Card>

      {canSeeVisualIdentity && brandId ? (
        <Card>
          <CardHeader className="gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Palette className="h-4 w-4 text-primary" />
              Identidade visual
            </CardTitle>
            <CardDescription>
              Exclusivo de Super Admin. A troca de logos e ícone é feita em Administração →
              Identidade.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BrandingSlots brandId={brandId} editable={false} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function CompanyPanel({ brandId }: { brandId: string }) {
  const qc = useQueryClient();
  const fetchCompany = useServerFn(getBrandCompany);
  const saveCompany = useServerFn(updateBrandCompany);
  const [company, setCompany] = useState<CompanyState | null>(null);

  const companyQ = useQuery({
    queryKey: ["brand", "company", brandId],
    queryFn: () => fetchCompany({ data: { brandId } }),
  });

  // Reidrata quando o workspace ativo muda — nunca mistura dados de duas marcas.
  useEffect(() => {
    setCompany(null);
  }, [brandId]);

  useEffect(() => {
    if (companyQ.data && !company) {
      const c = companyQ.data;
      setCompany({
        cpf: c.cpf ?? "",
        cnpj: c.cnpj ?? "",
        nome_fantasia: c.nome_fantasia ?? "",
        razao_social: c.razao_social ?? "",
        cep: c.cep ?? "",
        rua: c.rua ?? "",
        numero: c.numero ?? "",
        complemento: c.complemento ?? "",
        bairro: c.bairro ?? "",
        cidade: c.cidade ?? "",
        estado: c.estado ?? "",
      });
    }
  }, [companyQ.data, company]);

  const companyMutation = useMutation({
    mutationFn: async (payload: CompanyState) =>
      saveCompany({
        data: {
          brandId,
          cpf: payload.cpf.trim() || null,
          cnpj: payload.cnpj.trim() || null,
          nome_fantasia: payload.nome_fantasia.trim() || null,
          razao_social: payload.razao_social.trim() || null,
          cep: payload.cep.trim() || null,
          rua: payload.rua.trim() || null,
          numero: payload.numero.trim() || null,
          complemento: payload.complemento.trim() || null,
          bairro: payload.bairro.trim() || null,
          cidade: payload.cidade.trim() || null,
          estado: payload.estado.trim().toUpperCase() || null,
        },
      }),
    onSuccess: async () => {
      toast.success("Dados da agência atualizados");
      await qc.invalidateQueries({ queryKey: ["brand", "company", brandId] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Falha ao salvar dados da agência"),
  });

  if (!company) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4 text-primary" />
          Dados cadastrais
        </CardTitle>
        <CardDescription>
          Documentos, razão social e endereço da agência deste workspace.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cnpj">CNPJ</Label>
            <Input
              id="cnpj"
              value={company.cnpj}
              onChange={(e) => setCompany({ ...company, cnpj: e.target.value })}
              maxLength={20}
              placeholder="00.000.000/0000-00"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cpf">CPF</Label>
            <Input
              id="cpf"
              value={company.cpf}
              onChange={(e) => setCompany({ ...company, cpf: e.target.value })}
              maxLength={20}
              placeholder="000.000.000-00"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="razao_social">Razão social</Label>
            <Input
              id="razao_social"
              value={company.razao_social}
              onChange={(e) => setCompany({ ...company, razao_social: e.target.value })}
              maxLength={200}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nome_fantasia">Nome fantasia</Label>
            <Input
              id="nome_fantasia"
              value={company.nome_fantasia}
              onChange={(e) => setCompany({ ...company, nome_fantasia: e.target.value })}
              maxLength={160}
            />
          </div>
        </div>

        <div className="space-y-3">
          <Separator />
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" /> Endereço
          </p>
          <div className="grid gap-4 sm:grid-cols-6">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="cep">CEP</Label>
              <Input
                id="cep"
                value={company.cep}
                onChange={(e) => setCompany({ ...company, cep: e.target.value })}
                maxLength={12}
                placeholder="00000-000"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-4">
              <Label htmlFor="rua">Rua</Label>
              <Input
                id="rua"
                value={company.rua}
                onChange={(e) => setCompany({ ...company, rua: e.target.value })}
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="numero">Número</Label>
              <Input
                id="numero"
                value={company.numero}
                onChange={(e) => setCompany({ ...company, numero: e.target.value })}
                maxLength={20}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-4">
              <Label htmlFor="complemento">Complemento</Label>
              <Input
                id="complemento"
                value={company.complemento}
                onChange={(e) => setCompany({ ...company, complemento: e.target.value })}
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="bairro">Bairro</Label>
              <Input
                id="bairro"
                value={company.bairro}
                onChange={(e) => setCompany({ ...company, bairro: e.target.value })}
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-3">
              <Label htmlFor="cidade">Cidade</Label>
              <Input
                id="cidade"
                value={company.cidade}
                onChange={(e) => setCompany({ ...company, cidade: e.target.value })}
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="estado">UF</Label>
              <Select
                value={company.estado || undefined}
                onValueChange={(v) => setCompany({ ...company, estado: v })}
              >
                <SelectTrigger id="estado">
                  <SelectValue placeholder="UF" />
                </SelectTrigger>
                <SelectContent>
                  {UFS.map((uf) => (
                    <SelectItem key={uf} value={uf}>
                      {uf}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={() => companyMutation.mutate(company)}
            disabled={companyMutation.isPending}
          >
            {companyMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Salvar dados cadastrais
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
