import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  UNITOS_MARK_RATIO,
  UNITOS_WORDMARK_RATIO,
  UnitosMarkGlyph,
  UnitosWordmarkGlyph,
} from "@/components/brand/unitos-wordmark";

/**
 * COMPONENTE ÚNICO DE BRANDING (login, recuperação de senha, sidebar, portal e
 * demais telas). Toda tela do sistema deve usar este componente — não criar
 * outra lógica de fallback.
 *
 * Regras estruturais:
 * - o fallback padrão é SVG INLINE do Unitos: não depende de CDN, Storage,
 *   domínio nem de asset que possa não existir em uma nova instalação;
 * - o container reserva as dimensões (aspect-ratio) desde o primeiro render,
 *   portanto nunca há layout shift;
 * - a logo da instalação só substitui o fallback depois de pré-carregada com
 *   sucesso; URL vazia/inválida ou erro de rede mantém o SVG padrão;
 * - se a imagem remota falhar DEPOIS de renderizada, volta imediatamente para
 *   o SVG padrão — nunca sobra imagem quebrada, texto "Logo" ou espaço vazio;
 * - o pré-carregamento é memoizado por URL, evitando fetch duplicado.
 */

/** Proporção original do wordmark (10:3). */
export const BRAND_LOGO_RATIO = UNITOS_WORDMARK_RATIO;
/** Proporção do ícone/mark (quadrado). */
export const BRAND_MARK_RATIO = UNITOS_MARK_RATIO;

const preloadCache = new Map<string, Promise<boolean>>();

function isUsableUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return false;
  return /^(https?:|blob:|data:|\/)/.test(trimmed);
}

function preload(url: string): Promise<boolean> {
  const cached = preloadCache.get(url);
  if (cached) return cached;
  const p = new Promise<boolean>((resolve) => {
    if (typeof window === "undefined") {
      resolve(false);
      return;
    }
    const img = new window.Image();
    img.decoding = "async";
    img.onload = () => resolve(img.naturalWidth > 0);
    img.onerror = () => resolve(false);
    img.src = url;
  }).then((ok) => {
    if (!ok) preloadCache.delete(url);
    return ok;
  });
  preloadCache.set(url, p);
  return p;
}

export type BrandLogoProps = {
  /** URL da identidade da instalação (pode ser nula/inválida). */
  src?: string | null;
  /** Variante do fallback institucional padrão. */
  variant?: "full" | "mark";
  /** Proporção reservada no container (largura / altura). */
  ratio?: number;
  alt?: string;
  eager?: boolean;
  /** Classes do container (controle de largura/altura). */
  className?: string;
  /** Classes extra da imagem. */
  imgClassName?: string;
  /** Alinhamento horizontal da imagem dentro do container. */
  align?: "left" | "center";
};

export function BrandLogo({
  src,
  variant = "full",
  ratio,
  alt = "Unitos",
  eager = true,
  className,
  imgClassName,
  align = "left",
}: BrandLogoProps) {
  const remote = isUsableUrl(src) ? src.trim() : null;
  const [resolved, setResolved] = useState<string | null>(() =>
    remote && preloadCache.has(remote) ? remote : null,
  );

  useEffect(() => {
    if (!remote) {
      setResolved(null);
      return;
    }
    let alive = true;
    void preload(remote).then((ok) => {
      if (alive) setResolved(ok ? remote : null);
    });
    return () => {
      alive = false;
    };
  }, [remote]);

  const isMark = variant === "mark";
  const aspect = ratio ?? (isMark ? BRAND_MARK_RATIO : BRAND_LOGO_RATIO);

  return (
    <span
      className={cn("relative block w-full select-none overflow-hidden", className)}
      style={{ aspectRatio: String(aspect) }}
    >
      {resolved ? (
        <img
          src={resolved}
          alt={alt}
          draggable={false}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onError={() => {
            preloadCache.delete(resolved);
            setResolved(null);
          }}
          className={cn(
            "absolute inset-0 h-full w-full object-contain",
            align === "left" ? "object-left" : "object-center",
            imgClassName,
          )}
        />
      ) : (
        <span
          className={cn(
            "absolute inset-0 flex h-full w-full items-center",
            align === "left" ? "justify-start" : "justify-center",
          )}
        >
          {isMark ? <UnitosMarkGlyph /> : <UnitosWordmarkGlyph />}
        </span>
      )}
    </span>
  );
}
