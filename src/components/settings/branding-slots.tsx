import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Image as ImageIcon, Loader2, Trash2, Upload } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { updateBrandBranding } from "@/lib/branding.functions";
import { useBrandBranding } from "@/hooks/use-brand-branding";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Identidade visual da marca — FONTE ÚNICA de verdade das logos
 * (`brands.logo_url / logo_dark_url / icon_url / login_logo_url`).
 *
 * Este componente é compartilhado por:
 * - Administração → Identidade (Super Admin, `editable`),
 * - Configurações → Agência (leitura para admin/manager).
 *
 * A edição real é validada no servidor (`updateBrandBranding` exige Super Admin);
 * `editable=false` apenas esconde os controles.
 */

export type BrandingKind = "logo_light" | "logo_dark" | "icon" | "logo_login";

type SlotSpec = {
  kind: BrandingKind;
  title: string;
  description: string;
  hint: string;
  minWidth: number;
  minHeight: number;
  maxBytes: number;
  previewBg: "light" | "dark" | "icon";
  square?: boolean;
  previewClass: string;
};

export const BRANDING_SLOTS: SlotSpec[] = [
  {
    kind: "logo_light",
    title: "Logo — tema claro",
    description: "Usada no sidebar em fundo claro e nas telas de login e recuperação de senha.",
    hint: "PNG ou SVG com fundo transparente • Dimensão ideal 480×120 px (proporção 4:1) • Mín. 240×60 • até 500 KB",
    minWidth: 240,
    minHeight: 60,
    maxBytes: 500 * 1024,
    previewBg: "light",
    previewClass: "h-16 w-auto max-w-[280px]",
  },
  {
    kind: "logo_dark",
    title: "Logo — tema escuro",
    description: "Usada no sidebar em fundo escuro e nas telas de login/recuperação em modo escuro.",
    hint: "PNG ou SVG com fundo transparente • Dimensão ideal 480×120 px (proporção 4:1) • Mín. 240×60 • até 500 KB",
    minWidth: 240,
    minHeight: 60,
    maxBytes: 500 * 1024,
    previewBg: "dark",
    previewClass: "h-16 w-auto max-w-[280px]",
  },
  {
    kind: "logo_login",
    title: "Logo da tela de login",
    description:
      "Exclusiva da tela de login (painel escuro à esquerda). Se vazia, usa a logo do tema claro.",
    hint: "PNG ou SVG horizontal com fundo transparente, versão clara • Ideal 600×160 px • Mín. 240×60 • até 500 KB",
    minWidth: 240,
    minHeight: 60,
    maxBytes: 500 * 1024,
    previewBg: "dark",
    previewClass: "h-16 w-auto max-w-[280px]",
  },
  {
    kind: "icon",
    title: "Ícone / Favicon",
    description: "Aparece no sidebar recolhido e como favicon do navegador. Deve ser quadrado.",
    hint: "PNG ou SVG quadrado • Dimensão ideal 256×256 px • Mín. 128×128 • até 200 KB",
    minWidth: 128,
    minHeight: 128,
    maxBytes: 200 * 1024,
    previewBg: "icon",
    square: true,
    previewClass: "h-16 w-16",
  },
];

export function BrandingSlots({ brandId, editable }: { brandId: string; editable: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {BRANDING_SLOTS.map((s) => (
        <BrandingSlot key={s.kind} brandId={brandId} spec={s} editable={editable} />
      ))}
    </div>
  );
}

function BrandingSlot({
  brandId,
  spec,
  editable,
}: {
  brandId: string;
  spec: SlotSpec;
  editable: boolean;
}) {
  const qc = useQueryClient();
  const branding = useBrandBranding(brandId);
  const save = useServerFn(updateBrandBranding);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const currentPath = branding.paths[spec.kind];

  const previewSrc = {
    logo_light: branding.logoLight,
    logo_dark: branding.logoDark,
    icon: branding.icon,
    logo_login: branding.logoLogin,
  }[spec.kind];
  const isCustom = {
    logo_light: branding.logoLightCustom,
    logo_dark: branding.logoDarkCustom,
    icon: branding.iconCustom,
    logo_login: branding.logoLoginCustom,
  }[spec.kind];

  async function readImageDims(file: File): Promise<{ w: number; h: number }> {
    if (file.type === "image/svg+xml") return { w: 9999, h: 9999 };
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => reject(new Error("Não foi possível ler a imagem"));
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg|webp|svg\+xml)$/.test(file.type)) {
      toast.error("Formato inválido — use PNG, JPG, WEBP ou SVG");
      return;
    }
    if (file.size > spec.maxBytes) {
      toast.error(`Arquivo muito grande — limite ${Math.round(spec.maxBytes / 1024)} KB`);
      return;
    }
    setBusy(true);
    try {
      const dims = await readImageDims(file);
      if (dims.w < spec.minWidth || dims.h < spec.minHeight) {
        throw new Error(`Dimensão mínima ${spec.minWidth}×${spec.minHeight} px`);
      }
      if (spec.square && dims.w !== dims.h) {
        throw new Error("O ícone precisa ser quadrado");
      }
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${brandId}/${spec.kind}-${Date.now()}.${ext}`;
      const up = await supabase.storage.from("brand-assets").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });
      if (up.error) throw up.error;

      if (currentPath) {
        await supabase.storage.from("brand-assets").remove([currentPath]);
      }

      await save({ data: { brandId, kind: spec.kind, storagePath: path } });
      toast.success("Imagem atualizada");
      await qc.invalidateQueries({ queryKey: ["brand-branding", brandId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha no upload");
    } finally {
      setBusy(false);
    }
  }

  const removeMut = useMutation({
    mutationFn: async () => {
      if (currentPath) await supabase.storage.from("brand-assets").remove([currentPath]);
      await save({ data: { brandId, kind: spec.kind, storagePath: null } });
    },
    onSuccess: async () => {
      toast.success("Voltou ao padrão");
      await qc.invalidateQueries({ queryKey: ["brand-branding", brandId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao remover"),
  });

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{spec.title}</CardTitle>
        <CardDescription>{spec.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div
          className={cn(
            "flex items-center justify-center rounded-lg border border-dashed border-border/60 p-6",
            spec.previewBg === "dark" && "bg-neutral-950",
            spec.previewBg === "light" && "bg-neutral-50",
            spec.previewBg === "icon" && "bg-muted/50",
          )}
        >
          {previewSrc ? (
            <img
              src={previewSrc}
              alt={spec.title}
              className={cn("object-contain", spec.previewClass)}
            />
          ) : (
            <ImageIcon className="h-10 w-10 text-muted-foreground/40" />
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{spec.hint}</p>
        {editable ? (
          <div className="mt-auto flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={onPick}
            />
            <Button
              type="button"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="flex-1"
            >
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              {isCustom ? "Substituir" : "Enviar imagem"}
            </Button>
            {isCustom && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={removeMut.isPending || busy}
                onClick={() => removeMut.mutate()}
              >
                {removeMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        ) : (
          <p className="mt-auto text-xs text-muted-foreground">
            {isCustom ? "Personalizada por este ambiente." : "Usando o padrão do sistema."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
