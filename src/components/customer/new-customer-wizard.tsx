import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Loader2,
  UploadCloud,
  UserCog,
  X,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CustomerAvatar } from "@/components/customer/customer-avatar";
import { cn } from "@/lib/utils";
import { createClient, uploadCustomerLogo } from "@/lib/workspace.functions";
import { listBrandTeam } from "@/lib/team.functions";

/** Segmentos comuns oferecidos no cadastro básico (gravados em `clients.niche`). */
export const CUSTOMER_SEGMENTS = [
  "Restaurante",
  "Cafeteria",
  "Clínica",
  "Academia",
  "Comércio",
  "Serviços",
  "Tecnologia",
  "Educação",
  "Eventos",
] as const;

const OTHER = "__other";

const ACCEPTED = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

/** Formata CNPJ no padrão 00.000.000/0000-00 (apenas dígitos). */
function maskCnpj(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/(\d{2})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3/$4")
    .replace(/(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, "$1.$2.$3/$4-$5");
}

/** Formata telefone/WhatsApp no padrão (00) 00000-0000 (apenas dígitos). */
function maskPhone(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

const Step1Schema = z.object({
  name: z.string().trim().min(2, "Informe o nome da empresa").max(120),
  legal_name: z.string().trim().max(200).optional(),
  cnpj: z.string().trim().max(24).optional(),
  segment: z.string().trim().min(2, "Selecione ou informe o segmento").max(120),
  description: z.string().trim().max(2000).optional(),
  website: z
    .string()
    .trim()
    .max(300)
    .optional()
    .refine((v) => !v || /^https?:\/\/.+\..+/.test(v), "Use uma URL válida (https://…)"),
});

const Step2Schema = z.object({
  contact_name: z.string().trim().max(120).optional(),
  contact_email: z
    .string()
    .trim()
    .max(200)
    .optional()
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "E-mail inválido"),
  contact_phone: z.string().trim().max(40).optional(),
  owner_user_id: z.string().uuid("Selecione o responsável pela conta"),
  is_active: z.boolean(),
});

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export type NewCustomerWizardProps = {
  brandId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

/**
 * Wizard de CADASTRO BÁSICO do cliente (2 etapas).
 * Grava exclusivamente em colunas já usadas pelo Perfil do Cliente:
 * name, legal_name, cnpj, description, niche, website, logo_url,
 * contact_name, contact_email, contact_phone, owner_user_id, is_active.
 * Não escreve nada em brand_hub / briefing / estratégia.
 */
export function NewCustomerWizard({ brandId, open, onOpenChange }: NewCustomerWizardProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const create = useServerFn(createClient);
  const upload = useServerFn(uploadCustomerLogo);
  const teamFn = useServerFn(listBrandTeam);
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [segmentChoice, setSegmentChoice] = useState<string>("");
  const [segmentOther, setSegmentOther] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [ownerUserId, setOwnerUserId] = useState<string>("");
  const [isActive, setIsActive] = useState(true);

  const teamQ = useQuery({
    queryKey: ["team", brandId],
    queryFn: () => teamFn({ data: { brandId: brandId! } }),
    enabled: !!brandId && open,
    staleTime: 60_000,
  });
  const members = (teamQ.data?.members ?? []) as Array<{
    user_id: string;
    full_name: string | null;
  }>;

  useEffect(() => {
    if (open) return;
    setStep(1);
    setCreated(null);
    setErrors({});
    setName("");
    setLegalName("");
    setCnpj("");
    setSegmentChoice("");
    setSegmentOther("");
    setDescription("");
    setWebsite("");
    setLogoFile(null);
    setLogoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setContactName("");
    setContactEmail("");
    setContactPhone("");
    setOwnerUserId("");
    setIsActive(true);
  }, [open]);

  const segment = useMemo(
    () => (segmentChoice === OTHER ? segmentOther : segmentChoice),
    [segmentChoice, segmentOther],
  );

  const handleFile = (file: File | null | undefined) => {
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      toast.error("Formato inválido", { description: "Aceitamos PNG, JPG, SVG ou WEBP." });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Arquivo muito grande", { description: "O limite é 5 MB." });
      return;
    }
    setLogoFile(file);
    const url = URL.createObjectURL(file);
    setLogoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  };

  const goStep2 = () => {
    const parsed = Step1Schema.safeParse({
      name,
      legal_name: legalName,
      cnpj,
      segment,
      description,
      website,
    });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[i.path.join(".")] = i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    setStep(2);
  };

  const mut = useMutation({
    mutationFn: async () => {
      if (!brandId) throw new Error("Selecione um workspace primeiro.");
      const step1 = Step1Schema.safeParse({
        name,
        legal_name: legalName,
        cnpj,
        segment,
        description,
        website,
      });
      if (!step1.success) {
        setStep(1);
        throw new Error(step1.error.issues[0]?.message ?? "Dados da empresa inválidos");
      }
      const step2 = Step2Schema.safeParse({
        contact_name: contactName,
        contact_email: contactEmail,
        contact_phone: contactPhone,
        owner_user_id: ownerUserId,
        is_active: isActive,
      });
      if (!step2.success) {
        const errs: Record<string, string> = {};
        for (const i of step2.error.issues) errs[i.path.join(".")] = i.message;
        setErrors(errs);
        throw new Error(step2.error.issues[0]?.message ?? "Dados de contato inválidos");
      }
      setErrors({});

      let logoUrl: string | undefined;
      if (logoFile) {
        const base64 = await readAsBase64(logoFile);
        const res = await upload({
          data: {
            brandId,
            filename: logoFile.name,
            contentType: logoFile.type,
            base64,
          },
        });
        logoUrl = res.url;
      }

      const client = await create({
        data: {
          brandId,
          name: step1.data.name,
          legal_name: step1.data.legal_name || undefined,
          cnpj: step1.data.cnpj || undefined,
          description: step1.data.description || undefined,
          niche: step1.data.segment,
          website: step1.data.website || undefined,
          logo_url: logoUrl,
          contact_name: step2.data.contact_name || undefined,
          contact_email: step2.data.contact_email || undefined,
          contact_phone: step2.data.contact_phone || undefined,
          owner_user_id: step2.data.owner_user_id,
          is_active: step2.data.is_active,
        },
      });
      return client as { id: string; name: string };
    },
    onSuccess: (client) => {
      // Mostra a tela de sucesso IMEDIATAMENTE, antes de qualquer refetch,
      // para evitar um estado vazio/congelado entre o submit e a transição.
      const c = client as { id: string; name: string };
      setCreated({ id: c.id, name: c.name });
      setStep(3);
      toast.success("Cliente criado com sucesso.");
      // Invalida a lista em background (não bloqueia a UI).
      void qc.invalidateQueries({ queryKey: ["clients", brandId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => (mut.isPending ? null : onOpenChange(v))}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === 3 ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Cliente criado com sucesso.
              </>
            ) : step === 1 ? (
              <>
                <Building2 className="h-4 w-4 text-muted-foreground" /> Dados da empresa
              </>
            ) : (
              <>
                <UserCog className="h-4 w-4 text-muted-foreground" /> Contato e gestão
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {step === 3
              ? "O cadastro básico já está disponível no perfil do cliente."
              : step === 1
                ? "Cadastre as informações básicas do cliente."
                : "Defina o principal contato e quem será responsável pela conta."}
          </DialogDescription>
        </DialogHeader>

        {step !== 3 ? (
          <div className="flex items-center gap-2 pb-1">
            {[1, 2].map((s) => (
              <div
                key={s}
                className={cn(
                  "h-1 flex-1 rounded-full transition",
                  step >= s ? "bg-primary" : "bg-muted",
                )}
              />
            ))}
            <span className="ml-1 text-[11px] text-muted-foreground">Etapa {step} de 2</span>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label className="text-xs">Nome da empresa *</Label>
                <Input
                  className="mt-1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: Café Aurora"
                  autoFocus
                />
                {errors.name ? (
                  <p className="mt-1 text-xs text-destructive">{errors.name}</p>
                ) : null}
              </div>
              <div>
                <Label className="text-xs">Razão social</Label>
                <Input
                  className="mt-1"
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  placeholder="Café Aurora Ltda."
                />
              </div>
              <div>
                <Label className="text-xs">CNPJ</Label>
                <Input
                  className="mt-1"
                  value={cnpj}
                  onChange={(e) => setCnpj(maskCnpj(e.target.value))}
                  inputMode="numeric"
                  placeholder="00.000.000/0000-00"
                />
              </div>
              <div>
                <Label className="text-xs">Segmento *</Label>
                <Select value={segmentChoice} onValueChange={setSegmentChoice}>
                  <SelectTrigger className="mt-1 h-9 text-xs">
                    <SelectValue placeholder="Selecionar segmento…" />
                  </SelectTrigger>
                  <SelectContent>
                    {CUSTOMER_SEGMENTS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                    <SelectItem value={OTHER}>Outro</SelectItem>
                  </SelectContent>
                </Select>
                {segmentChoice === OTHER ? (
                  <Input
                    className="mt-2"
                    value={segmentOther}
                    onChange={(e) => setSegmentOther(e.target.value)}
                    placeholder="Informe o segmento"
                  />
                ) : null}
                {errors.segment ? (
                  <p className="mt-1 text-xs text-destructive">{errors.segment}</p>
                ) : null}
              </div>
              <div>
                <Label className="text-xs">Site</Label>
                <Input
                  className="mt-1"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://empresa.com"
                />
                {errors.website ? (
                  <p className="mt-1 text-xs text-destructive">{errors.website}</p>
                ) : null}
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">Descrição da empresa</Label>
                <Textarea
                  className="mt-1 min-h-[76px]"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="O que a empresa faz, em poucas linhas."
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Logo</Label>
              <div className="mt-2 flex items-center gap-3">
                <CustomerAvatar
                  name={name || "?"}
                  logoUrl={logoPreview}
                  className="h-12 w-12"
                  textClassName="text-sm"
                />
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => fileRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragActive(false);
                    handleFile(e.dataTransfer.files?.[0]);
                  }}
                  className={cn(
                    "flex flex-1 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground transition hover:border-foreground/40 hover:bg-muted/50",
                    dragActive && "border-primary bg-primary/5 text-foreground",
                  )}
                >
                  <UploadCloud className="h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1 leading-tight">
                    {logoFile ? (
                      <>
                        <div className="truncate text-foreground">{logoFile.name}</div>
                        <div>{(logoFile.size / 1024).toFixed(0)} KB — clique para trocar</div>
                      </>
                    ) : (
                      <>
                        <div className="text-foreground">Arraste ou clique para enviar</div>
                        <div>PNG, JPG, SVG ou WEBP · até 5 MB</div>
                      </>
                    )}
                  </div>
                  {logoFile ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      aria-label="Remover logo"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLogoFile(null);
                        setLogoPreview((prev) => {
                          if (prev) URL.revokeObjectURL(prev);
                          return null;
                        });
                        if (fileRef.current) fileRef.current.value = "";
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPTED.join(",")}
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button onClick={goStep2} className="gap-1.5">
                Continuar <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Nome do contato principal</Label>
                <Input
                  className="mt-1"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Ex.: João Silva"
                  autoFocus
                />
              </div>
              <div>
                <Label className="text-xs">E-mail</Label>
                <Input
                  className="mt-1"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="contato@empresa.com"
                />
                {errors.contact_email ? (
                  <p className="mt-1 text-xs text-destructive">{errors.contact_email}</p>
                ) : null}
              </div>
              <div>
                <Label className="text-xs">Telefone / WhatsApp</Label>
                <Input
                  className="mt-1"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(maskPhone(e.target.value))}
                  inputMode="numeric"
                  placeholder="(11) 90000-0000"
                />
              </div>
              <div>
                <Label className="text-xs">Responsável pela conta *</Label>
                <Select value={ownerUserId} onValueChange={setOwnerUserId}>
                  <SelectTrigger className="mt-1 h-9 text-xs">
                    <SelectValue
                      placeholder={
                        teamQ.isLoading ? "Carregando equipe…" : "Selecionar responsável…"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {m.full_name ?? m.user_id.slice(0, 8)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.owner_user_id ? (
                  <p className="mt-1 text-xs text-destructive">{errors.owner_user_id}</p>
                ) : null}
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">Status</Label>
                <div className="mt-1 flex h-9 items-center justify-between rounded-md border border-border bg-background px-3">
                  <span className="text-xs text-muted-foreground">
                    {isActive ? "Cliente ativo" : "Cliente inativo"}
                  </span>
                  <Switch checked={isActive} onCheckedChange={setIsActive} />
                </div>
              </div>
            </div>

            <div className="flex justify-between gap-2 pt-1">
              <Button
                variant="ghost"
                onClick={() => setStep(1)}
                disabled={mut.isPending}
                className="gap-1.5"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Voltar
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={mut.isPending}
                >
                  Cancelar
                </Button>
                <Button onClick={() => mut.mutate()} disabled={mut.isPending || !brandId}>
                  {mut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {mut.isPending ? "Criando cliente..." : "Criar cliente"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {step === 3 && created ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4 text-sm">
              <div className="font-medium text-foreground">{created.name}</div>
              <p className="mt-1 text-xs text-muted-foreground">
                O cadastro básico já aparece no perfil do cliente. As informações estratégicas
                (briefing, personas, tom de voz) podem ser preenchidas depois no Cérebro da Marca —
                isso é opcional.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Voltar para Clientes
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  onOpenChange(false);
                  await navigate({
                    to: "/customers/$customerId/brain",
                    params: { customerId: created.id },
                  });
                }}
              >
                Configurar Brand Hub
              </Button>
              <Button
                onClick={async () => {
                  onOpenChange(false);
                  await navigate({
                    to: "/customers/$customerId",
                    params: { customerId: created.id },
                  });
                }}
              >
                Abrir perfil do cliente
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
