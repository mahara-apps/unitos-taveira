// Upload de foto de perfil. Reutiliza Supabase Storage (bucket privado
// `avatars`, pasta por usuário) e devolve uma URL assinada de longa duração,
// que continua sendo gravada em `user_profiles.avatar_url` pelo fluxo de
// salvamento existente do Perfil — sem segunda fonte de verdade.
import { useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BUCKET = "avatars";
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const SIGNED_TTL = 60 * 60 * 24 * 365 * 5; // 5 anos

export function AvatarUploader({
  userId,
  value,
  initials,
  name,
  onChange,
  className,
}: {
  userId: string;
  value: string;
  initials: string;
  name: string;
  onChange: (nextUrl: string) => void;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const shown = preview ?? (value || null);

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      toast.error("Formato inválido — use JPG, PNG ou WebP");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Imagem muito grande — limite de 2 MB");
      return;
    }

    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);
    setBusy(true);
    try {
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const path = `${userId}/avatar-${Date.now()}.${ext}`;
      const up = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type, cacheControl: "3600" });
      if (up.error) throw up.error;

      const signed = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL);
      if (signed.error || !signed.data?.signedUrl) {
        throw signed.error ?? new Error("Não foi possível gerar o link da imagem");
      }

      // Limpa versões anteriores da própria pasta.
      const listed = await supabase.storage.from(BUCKET).list(userId);
      const stale = (listed.data ?? []).map((f) => `${userId}/${f.name}`).filter((p) => p !== path);
      if (stale.length) await supabase.storage.from(BUCKET).remove(stale);

      onChange(signed.data.signedUrl);
      toast.success("Foto enviada — salve as alterações para aplicar");
    } catch (err) {
      setPreview(null);
      toast.error(err instanceof Error ? err.message : "Falha no upload da foto");
    } finally {
      setBusy(false);
      URL.revokeObjectURL(localUrl);
    }
  }

  function handleRemove() {
    setPreview(null);
    onChange("");
  }

  return (
    <div className={cn("flex items-center gap-4 sm:gap-5", className)}>
      <div className="relative">
        <Avatar className="h-20 w-20 rounded-2xl ring-1 ring-border sm:h-24 sm:w-24">
          {shown ? <AvatarImage src={shown} alt={name} className="object-cover" /> : null}
          <AvatarFallback className="rounded-2xl bg-brand-lime/15 text-xl font-semibold text-foreground">
            {initials}
          </AvatarFallback>
        </Avatar>
        <button
          type="button"
          aria-label="Trocar foto de perfil"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="absolute -bottom-1.5 -right-1.5 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
        </button>
      </div>

      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {shown ? "Trocar foto" : "Enviar foto"}
          </Button>
          {shown ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={handleRemove}
              className="text-muted-foreground hover:text-foreground"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Remover
            </Button>
          ) : null}
        </div>
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          JPG, PNG ou WebP · até 2 MB. Sem foto, usamos suas iniciais.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handlePick}
      />
    </div>
  );
}
