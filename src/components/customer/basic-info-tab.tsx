import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AtSign, Building2, Lock, Share2, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ProfileField,
  ProfileFieldGrid,
  ProfilePageHeader,
  ProfileSection,
  ProfileSaveBar,
  ProfileSectionsSkeleton,
} from "@/components/customer/ui/profile-ui";
import { listClients, listMyBrands, updateClient } from "@/lib/workspace.functions";
import { canEditBasicInfo, resolveAccessRole } from "@/lib/permissions";

/**
 * Aba "Cadastro" — fonte única do registro do cliente
 * (nome, nicho, site, endereço, contato e redes sociais).
 * Os campos que aparecem em Identidade do Cérebro (Nome) leem daqui.
 */
export function BasicInfoTab({ brandId, clientId }: { brandId: string; clientId: string }) {
  const qc = useQueryClient();
  const listClientsFn = useServerFn(listClients);
  const listBrandsFn = useServerFn(listMyBrands);
  const update = useServerFn(updateClient);

  const clientsQ = useQuery({
    queryKey: ["clients", brandId],
    queryFn: () => listClientsFn({ data: { brandId } }),
    staleTime: 60_000,
  });
  const brandsQ = useQuery({
    queryKey: ["brands"],
    queryFn: () => listBrandsFn(),
    staleTime: 60_000,
  });

  const client = (clientsQ.data ?? []).find((c) => c.id === clientId);
  const brandRole = brandsQ.data?.find((b) => b.id === brandId)?.role ?? null;
  const accessRole = resolveAccessRole(brandRole);
  const canEdit = canEditBasicInfo(accessRole);

  const socials =
    (client?.socials && typeof client.socials === "object"
      ? (client.socials as Record<string, string | undefined>)
      : {}) ?? {};
  const clientAny = (client ?? {}) as Record<string, unknown>;

  const [form, setForm] = useState({
    name: "",
    legal_name: "",
    cnpj: "",
    description: "",
    niche: "",
    website: "",
    address: "",
    contact_name: "",
    contact_email: "",
    phone: "",
    instagram: "",
    tiktok: "",
    linkedin: "",
    youtube: "",
    facebook: "",
  });
  // Espelho do último estado salvo — usado apenas para feedback visual
  // (dirty / descartar). Não altera a lógica de salvamento.
  const [base, setBase] = useState<typeof form | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!client) return;
    const next = {
      name: client.name ?? "",
      legal_name: (clientAny.legal_name as string) ?? "",
      cnpj: (clientAny.cnpj as string) ?? "",
      description: (clientAny.description as string) ?? "",
      niche: client.niche ?? "",
      website: (clientAny.website as string) ?? "",
      address: (clientAny.address as string) ?? "",
      contact_name: client.contact_name ?? "",
      contact_email: client.contact_email ?? "",
      phone: (client.contact_phone as string | null) ?? socials.phone ?? "",
      instagram: socials.instagram ?? "",
      tiktok: socials.tiktok ?? "",
      linkedin: socials.linkedin ?? "",
      youtube: socials.youtube ?? "",
      facebook: socials.facebook ?? "",
    };
    setForm(next);
    setBase(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id, client?.updated_at]);

  const mut = useMutation({
    mutationFn: async () => {
      const nextSocials = {
        ...socials,
        phone: undefined, // canonicalizado em contact_phone
        instagram: form.instagram.trim() || undefined,
        tiktok: form.tiktok.trim() || undefined,
        linkedin: form.linkedin.trim() || undefined,
        youtube: form.youtube.trim() || undefined,
        facebook: form.facebook.trim() || undefined,
      };
      return update({
        data: {
          brandId,
          clientId,
          patch: {
            name: form.name.trim() || undefined,
            legal_name: form.legal_name.trim() || null,
            cnpj: form.cnpj.trim() || null,
            description: form.description.trim() || null,
            niche: form.niche.trim() || null,
            website: form.website.trim() || null,
            address: form.address.trim() || null,
            contact_name: form.contact_name.trim() || null,
            contact_email: form.contact_email.trim() || null,
            contact_phone: form.phone.trim() || null,
            socials: nextSocials,
          },
        },
      });
    },
    onSuccess: () => {
      toast.success("Cadastro atualizado");
      setBase(form);
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["clients", brandId] });
      qc.invalidateQueries({ queryKey: ["customer-dashboard"] });
      qc.invalidateQueries({ queryKey: ["customer-core", brandId, clientId] });
      qc.invalidateQueries({ queryKey: ["brand-hub", brandId, clientId] });
    },
    onError: (e) => toast.error((e as Error).message ?? "Falha ao salvar cadastro"),
  });

  const set =
    (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setSaved(false);
      setForm((f) => ({ ...f, [key]: e.target.value }));
    };

  const disabled = !canEdit || mut.isPending;
  const dirty = !!base && JSON.stringify(base) !== JSON.stringify(form);

  if (clientsQ.isLoading && !client) return <ProfileSectionsSkeleton sections={3} />;

  return (
    <div className="space-y-4 pb-2">
      <ProfilePageHeader
        title="Informações do cliente"
        description="Gerencie os dados cadastrais desta conta. Nome, contato e redes são usados em todo o sistema."
        badge={
          canEdit ? (
            <Badge tone="emerald">Edição liberada</Badge>
          ) : (
            <Badge tone="amber" className="gap-1">
              <Lock className="h-3 w-3" /> Somente leitura
            </Badge>
          )
        }
      />

      {!canEdit ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-[12px] text-amber-600 dark:text-amber-300">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Apenas administradores da agência (owner/manager) podem editar estes campos. Seu papel
            atual: <strong>{brandRole ?? "—"}</strong> ({accessRole}).
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <ProfileSection
          title="Informações da empresa"
          subtitle="Identificação legal e posicionamento"
          icon={<Building2 className="h-4 w-4" />}
          className="xl:row-span-2"
        >
          <ProfileFieldGrid>
            <ProfileField label="Nome da empresa" full>
              <Input
                placeholder="Ex.: Café Aurora"
                value={form.name}
                onChange={set("name")}
                disabled={disabled}
              />
            </ProfileField>
            <ProfileField label="Razão social">
              <Input
                placeholder="Café Aurora Ltda."
                value={form.legal_name}
                onChange={set("legal_name")}
                disabled={disabled}
              />
            </ProfileField>
            <ProfileField label="CNPJ">
              <Input
                placeholder="00.000.000/0000-00"
                value={form.cnpj}
                onChange={set("cnpj")}
                disabled={disabled}
              />
            </ProfileField>
            <ProfileField label="Segmento / Nicho" full>
              <Input
                placeholder="Ex.: Cafeteria especial · Curitiba"
                value={form.niche}
                onChange={set("niche")}
                disabled={disabled}
              />
            </ProfileField>
            <ProfileField
              label="Descrição da empresa"
              hint="Usada como contexto rápido em briefings e relatórios."
              full
            >
              <Textarea
                placeholder="O que a empresa faz, em poucas linhas."
                value={form.description}
                onChange={set("description")}
                disabled={disabled}
                className="min-h-[96px] resize-y"
              />
            </ProfileField>
            <ProfileField label="Site">
              <Input
                placeholder="https://empresa.com"
                value={form.website}
                onChange={set("website")}
                disabled={disabled}
              />
            </ProfileField>
            <ProfileField label="Endereço" hint="Opcional">
              <Input
                placeholder="Rua, número, cidade"
                value={form.address}
                onChange={set("address")}
                disabled={disabled}
              />
            </ProfileField>
          </ProfileFieldGrid>
        </ProfileSection>

        <ProfileSection
          title="Contato principal"
          subtitle="Ponto focal para aprovações e comunicação"
          icon={<UserRound className="h-4 w-4" />}
        >
          <ProfileFieldGrid className="md:grid-cols-1">
            <ProfileField label="Contato responsável">
              <Input
                placeholder="Nome do contato"
                value={form.contact_name}
                onChange={set("contact_name")}
                disabled={disabled}
              />
            </ProfileField>
            <ProfileField label="E-mail corporativo">
              <Input
                type="email"
                placeholder="contato@empresa.com"
                value={form.contact_email}
                onChange={set("contact_email")}
                disabled={disabled}
              />
            </ProfileField>
            <ProfileField label="Telefone">
              <Input
                placeholder="+55 11 90000-0000"
                value={form.phone}
                onChange={set("phone")}
                disabled={disabled}
              />
            </ProfileField>
          </ProfileFieldGrid>
        </ProfileSection>

        <ProfileSection
          title="Redes sociais"
          subtitle="Handles ou URLs completas"
          icon={<Share2 className="h-4 w-4" />}
          footer={
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <AtSign className="h-3 w-3" />
              Publicação usa apenas os canais conectados na aba Canais.
            </p>
          }
        >
          <ProfileFieldGrid>
            <ProfileField label="Instagram">
              <Input
                placeholder="@handle"
                value={form.instagram}
                onChange={set("instagram")}
                disabled={disabled}
              />
            </ProfileField>
            <ProfileField label="TikTok">
              <Input
                placeholder="@handle"
                value={form.tiktok}
                onChange={set("tiktok")}
                disabled={disabled}
              />
            </ProfileField>
            <ProfileField label="LinkedIn">
              <Input
                placeholder="empresa"
                value={form.linkedin}
                onChange={set("linkedin")}
                disabled={disabled}
              />
            </ProfileField>
            <ProfileField label="YouTube">
              <Input
                placeholder="@canal"
                value={form.youtube}
                onChange={set("youtube")}
                disabled={disabled}
              />
            </ProfileField>
            <ProfileField label="Facebook" full>
              <Input
                placeholder="facebook.com/empresa"
                value={form.facebook}
                onChange={set("facebook")}
                disabled={disabled}
              />
            </ProfileField>
          </ProfileFieldGrid>
        </ProfileSection>
      </div>

      {canEdit ? (
        <ProfileSaveBar
          dirty={dirty}
          saving={mut.isPending}
          saved={saved}
          onSave={() => mut.mutate()}
          onDiscard={() => base && setForm(base)}
          hint="Nenhuma alteração pendente"
        />
      ) : null}
    </div>
  );
}
