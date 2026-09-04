import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Instagram, Loader2, UploadCloud, X } from "lucide-react";
import { z } from "zod";

import { ExpandedModal } from "@/components/ui/expanded-modal";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CustomerAvatar } from "@/components/customer/customer-avatar";
import { cn } from "@/lib/utils";
import { createClient, uploadCustomerLogo } from "@/lib/workspace.functions";

const BRAND_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f43f5e",
  "#f97316",
  "#f59e0b",
  "#10b981",
  "#14b8a6",
  "#0ea5e9",
  "#3b82f6",
  "#a855f7",
  "#64748b",
];

const ACCEPTED = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

const Schema = z.object({
  name: z.string().trim().min(2, "Informe o nome da marca").max(120),
  niche: z.string().max(120).optional(),
  color: z.string(),
  instagram: z.string().max(120).optional(),
});

export type QuickCreateCustomerDrawerProps = {
  brandId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (client: { id: string; name: string }) => void;
  /** Eleva o empilhamento quando aberto por cima de outro modal. */
  nested?: boolean;
};

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

export function QuickCreateCustomerDrawer({
  brandId,
  open,
  onOpenChange,
  onCreated,
  nested,
}: QuickCreateCustomerDrawerProps) {
  const qc = useQueryClient();
  const create = useServerFn(createClient);
  const upload = useServerFn(uploadCustomerLogo);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [niche, setNiche] = useState("");
  const [color, setColor] = useState(BRAND_COLORS[0]);
  const [instagram, setInstagram] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) {
      setName("");
      setNiche("");
      setColor(BRAND_COLORS[0]);
      setInstagram("");
      setLogoFile(null);
      setLogoPreview(null);
      setErrors({});
    }
  }, [open]);

  const handleFile = (file: File | null | undefined) => {
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      toast.error("Formato inválido", { description: "Aceitamos PNG, JPG, SVG ou WEBP." });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Arquivo muito grande", { description: "Máximo 5MB." });
      return;
    }
    setLogoFile(file);
    const url = URL.createObjectURL(file);
    setLogoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  };

  const removeLogo = () => {
    setLogoFile(null);
    setLogoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    if (inputRef.current) inputRef.current.value = "";
  };

  const mut = useMutation({
    mutationFn: async () => {
      if (!brandId) throw new Error("Selecione um workspace primeiro.");
      const parsed = Schema.safeParse({ name, niche, color, instagram });
      if (!parsed.success) {
        const errs: Record<string, string> = {};
        for (const i of parsed.error.issues) errs[i.path.join(".")] = i.message;
        setErrors(errs);
        throw new Error(parsed.error.issues[0]?.message ?? "Dados inválidos");
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
          name: parsed.data.name,
          niche: parsed.data.niche || undefined,
          color: parsed.data.color,
          logo_url: logoUrl,
          socials: parsed.data.instagram ? { instagram: parsed.data.instagram } : undefined,
        },
      });
      return client as { id: string; name: string };
    },
    onSuccess: async (client) => {
      await qc.invalidateQueries({ queryKey: ["clients", brandId] });
      onOpenChange(false);
      toast.success(`Cliente ${client.name} criado com sucesso`);
      onCreated?.(client);
      await navigate({
        to: "/customers/$customerId",
        params: { customerId: client.id },
        search: { onboarding: "1" },
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ExpandedModal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      nested={nested}
      title="Novo cliente"
      description={
        <>
          Cadastro rápido — refine identidade, redes e detalhes depois em
          <span className="mx-1 font-medium text-foreground">Cérebro da Marca › Identidade</span>.
        </>
      }
      bodyClassName="space-y-6 py-6"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !brandId}>
            {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Criar cliente
          </Button>
        </>
      }
    >
      <>
        {/* Preview + logo upload */}

        <div>
          <Label className="text-xs">Logo do cliente</Label>
          <div className="mt-2 flex items-center gap-4">
            <CustomerAvatar
              name={name || "?"}
              logoUrl={logoPreview}
              className="h-14 w-14"
              textClassName="text-base"
            />
            <div
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
              onClick={() => inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
              }}
              className={cn(
                "flex flex-1 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-3 text-xs text-muted-foreground transition hover:border-foreground/40 hover:bg-muted/50",
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
                    <div>PNG, JPG, SVG ou WEBP · até 5MB</div>
                  </>
                )}
              </div>
              {logoFile && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeLogo();
                  }}
                  aria-label="Remover logo"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED.join(",")}
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Nome da marca *</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Café Aurora"
            autoFocus
          />
          {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Nicho</Label>
          <Input
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            placeholder="Ex.: Cafeteria especial"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Cor da marca</Label>
          <div className="flex flex-wrap gap-1.5">
            {BRAND_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Selecionar cor ${c}`}
                className={cn(
                  "h-7 w-7 rounded-full ring-offset-2 ring-offset-background transition",
                  color === c ? "ring-2 ring-foreground" : "hover:ring-1 hover:ring-border",
                )}
                style={{ background: c }}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-7 w-7 cursor-pointer rounded-full border border-border bg-transparent p-0.5"
              aria-label="Cor personalizada"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Instagram</Label>
          <div className="relative">
            <Instagram className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
              placeholder="@usuario"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Demais canais e responsáveis ficam no Cérebro da Marca.
          </p>
        </div>
      </>
    </ExpandedModal>
  );
}
