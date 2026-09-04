import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ImageUp, Loader2, Palette, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  getPortalThemeFn,
  updatePortalThemeFn,
  uploadPortalLogoFn,
} from "@/lib/customer-dashboard.functions";
import { normalizePortalTheme, type PortalTheme } from "@/lib/portal-theme";

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Fase 3 — identidade visual do portal público.
 * "Padrão do sistema" mantém o comportamento atual (accent de clients.color,
 * iniciais como avatar, crédito da agência no rodapé). "Customizada" sugere
 * cor/logo do cadastro, mas permite divergir (white-label).
 */
export function PortalThemeForm({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const load = useServerFn(getPortalThemeFn);
  const save = useServerFn(updatePortalThemeFn);
  const upload = useServerFn(uploadPortalLogoFn);
  const fileRef = useRef<HTMLInputElement>(null);

  const q = useQuery({
    queryKey: ["portal-theme", clientId],
    queryFn: () => load({ data: { clientId } }),
    staleTime: 30_000,
  });

  const [theme, setTheme] = useState<PortalTheme>({ mode: "system" });
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (q.data) setTheme(normalizePortalTheme(q.data.theme));
  }, [q.data]);

  const defaults = q.data?.defaults;
  const custom = theme.mode === "custom";
  const accent = theme.accent ?? defaults?.color ?? "#6366F1";
  const patch = (p: Partial<PortalTheme>) => setTheme((t) => ({ ...t, ...p }));

  const saveMut = useMutation({
    mutationFn: (t: PortalTheme) => save({ data: { clientId, theme: t } }),
    onSuccess: (res) => {
      toast.success("Identidade do portal salva.");
      setTheme(normalizePortalTheme(res.theme));
      qc.invalidateQueries({ queryKey: ["portal-theme", clientId] });
    },
    onError: (e: Error) => toast.error("Falha ao salvar identidade", { description: e.message }),
  });

  const toggleMode = (on: boolean) => {
    if (!on) {
      patch({ mode: "system" });
      return;
    }
    // Sugestão inicial a partir do cadastro — o usuário pode divergir.
    setTheme((t) => ({
      ...t,
      mode: "custom",
      accent: t.accent ?? defaults?.color ?? "#6366F1",
      logo_url: t.logo_url ?? defaults?.logoUrl ?? null,
    }));
  };

  const pickLogo = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Arquivo muito grande", { description: "Limite de 5 MB." });
      return;
    }
    setUploading(true);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (const b of buf) bin += String.fromCharCode(b);
      const res = await upload({
        data: {
          clientId,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          base64: btoa(bin),
        },
      });
      patch({ logo_url: res.url, mode: "custom" });
      toast.success("Logo enviada. Salve para aplicar.");
    } catch (e) {
      toast.error("Falha no upload", { description: (e as Error).message });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const invalidAccent = custom && !!theme.accent && !HEX.test(theme.accent);

  if (q.isLoading) return <Skeleton className="h-40 w-full rounded-lg" />;

  return (
    <div className="space-y-4 border-t border-border/60 pt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label className="flex items-center gap-1.5">
            <Palette className="h-3.5 w-3.5 text-muted-foreground" />
            Identidade visual
          </Label>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {custom
              ? "Customizada — cor e logo aplicadas no portal do cliente."
              : "Padrão do sistema — cor do cadastro, iniciais como avatar e crédito da agência."}
          </p>
        </div>
        <Switch checked={custom} onCheckedChange={toggleMode} aria-label="Identidade customizada" />
      </div>

      {custom && (
        <div className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="space-y-1.5">
            <Label htmlFor="portal-accent">Cor de destaque</Label>
            <div className="flex items-center gap-2">
              <input
                id="portal-accent"
                type="color"
                value={HEX.test(accent) ? accent : "#6366F1"}
                onChange={(e) => patch({ accent: e.target.value })}
                className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent p-1"
              />
              <Input
                value={theme.accent ?? ""}
                placeholder={defaults?.color ?? "#6366F1"}
                maxLength={7}
                onChange={(e) => patch({ accent: e.target.value || null })}
                className="h-9 font-mono text-xs"
              />
            </div>
            {invalidAccent && (
              <p className="text-[11px] text-destructive">Use um hex válido (#RRGGBB).</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Logo do portal</Label>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-background">
                {theme.logo_url ? (
                  <img
                    src={theme.logo_url}
                    alt="Logo do portal"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <ImageUp className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImageUp className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Enviar logo
                </Button>
                {defaults?.logoUrl && defaults.logoUrl !== theme.logo_url && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => patch({ logo_url: defaults.logoUrl })}
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    Usar logo do cadastro
                  </Button>
                )}
                {theme.logo_url && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => patch({ logo_url: null })}
                  >
                    Remover
                  </Button>
                )}
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void pickLogo(f);
              }}
            />
            <p className="text-[11px] text-muted-foreground">
              PNG/SVG até 5 MB. Pode ser diferente da logo usada no briefing interno.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="portal-footer">Rótulo do rodapé</Label>
            <Input
              id="portal-footer"
              value={theme.footer_label ?? ""}
              maxLength={80}
              placeholder="por Pitada Digital"
              onChange={(e) => patch({ footer_label: e.target.value || null })}
              className="h-9"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="portal-dark" className="font-normal">
              Tema escuro no portal
            </Label>
            <Switch
              id="portal-dark"
              checked={!!theme.dark}
              onCheckedChange={(v) => patch({ dark: v })}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="portal-credit" className="font-normal">
              Mostrar crédito da agência
            </Label>
            <Switch
              id="portal-credit"
              checked={theme.show_agency_credit !== false}
              onCheckedChange={(v) => patch({ show_agency_credit: v })}
            />
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={saveMut.isPending || invalidAccent}
          onClick={() => saveMut.mutate(theme)}
        >
          {saveMut.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Salvar identidade
        </Button>
      </div>
    </div>
  );
}
