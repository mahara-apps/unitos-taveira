import { useMemo, useRef, useState } from "react";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Heart,
  Image as ImageIcon,
  MessageSquare,
  MoreHorizontal,
  Share,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { PlacementFormat } from "@/lib/scheduling-formats";
import type { SocialChannel } from "@/lib/social-core/capabilities";


/**
 * PostPreview — mock visual da peça no canal escolhido (feed, reels, stories).
 *
 * Fonte ÚNICA de prévia: usada pelo Composer de agendamento e pelo detalhe da
 * publicação no calendário. Puramente apresentacional — nenhuma chamada de
 * servidor, nenhuma regra de negócio.
 */

/** Mídia da prévia: aceita o asset da biblioteca ou apenas uma URL (capa). */
export type PreviewMedia = {
  publicUrl: string | null;
  kind?: "image" | "video" | "other" | string;
};

export function PostPreview({
  channel,
  format,
  handle,
  avatarUrl,
  copy,
  hashtags = [],
  media,
  mediaItems,
  mediaCount = 1,
  location = "",
  className,
}: {
  channel: SocialChannel;
  format: PlacementFormat;
  handle: string;
  avatarUrl: string | null;
  copy: string;
  hashtags?: string[];
  media: PreviewMedia | undefined | null;
  /** Lista completa de mídias, na MESMA ordem em que a peça será publicada. */
  mediaItems?: PreviewMedia[] | null;
  mediaCount?: number;
  location?: string;
  className?: string;
}) {
  const fullCopy = [copy.trim(), hashtags.map((t) => `#${t}`).join(" ")]
    .filter(Boolean)
    .join("\n\n");
  const initials = (handle || "?").slice(0, 2).toUpperCase();
  const vertical =
    format === "reels" || format === "stories" || channel === "tiktok" || channel === "youtube";
  const wideMedia = channel === "linkedin" || channel === "x";
  const isStories = format === "stories";
  const isReels = format === "reels" || channel === "tiktok" || channel === "youtube";
  const chromeStyle = channelChromeStyle(channel);

  // Slides do carrossel: usa a lista completa quando disponível; senão, a capa.
  const slides = useMemo<PreviewMedia[]>(() => {
    const list = (mediaItems ?? []).filter((m) => m && m.publicUrl);
    if (list.length) return list;
    return media?.publicUrl ? [media] : [];
  }, [mediaItems, media]);
  const isCarousel = format === "carrossel" && slides.length > 1;


  if (vertical) {
    // Reels/TikTok/Shorts/Stories — full-bleed 9:16 com overlay.
    return (
      <div
        className={cn(
          "relative w-full max-w-[300px] overflow-hidden rounded-2xl border border-border/60 bg-black shadow-lg",
          className,
        )}
        style={{ aspectRatio: "9 / 16" }}
      >
        {media?.publicUrl ? (
          media.kind === "video" ? (
            <video
              src={media.publicUrl}
              className="absolute inset-0 h-full w-full object-cover"
              muted
              playsInline
              loop
              autoPlay
            />
          ) : (
            <img
              src={media.publicUrl}
              alt="Prévia da peça"
              className="absolute inset-0 h-full w-full object-cover"
            />
          )
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-background/60">
            <ImageIcon className="h-6 w-6" />
            <span className="text-[10.5px]">Nenhuma mídia selecionada</span>
          </div>
        )}
        {/* Top gradient + header (Stories mostra barra de progresso) */}
        <div className="absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/60 to-transparent p-3">
          {isStories ? (
            <div className="mb-2 flex gap-1">
              <div className="h-0.5 flex-1 rounded-full bg-white/80" />
              <div className="h-0.5 flex-1 rounded-full bg-white/30" />
              <div className="h-0.5 flex-1 rounded-full bg-white/30" />
            </div>
          ) : null}
          <div className="flex items-center gap-2 text-white">
            <Avatar className="h-6 w-6 shrink-0 ring-1 ring-white/60">
              <AvatarImage src={avatarUrl ?? undefined} />
              <AvatarFallback className="text-[9px] uppercase">{initials}</AvatarFallback>
            </Avatar>
            <span className="truncate text-[11px] font-semibold drop-shadow">{handle}</span>
            {location ? (
              <span className="truncate text-[10px] text-white/80 drop-shadow">· {location}</span>
            ) : null}
          </div>
        </div>
        {/* Right rail — Reels/TikTok */}
        {isReels ? (
          <div className="absolute bottom-16 right-2 z-10 flex flex-col items-center gap-3 text-white drop-shadow">
            <Heart className="h-5 w-5" />
            <MessageSquare className="h-5 w-5" />
            <Share className="h-5 w-5" />
            <Bookmark className="h-5 w-5" />
          </div>
        ) : null}
        {/* Bottom overlay copy (Reels/TikTok) */}
        {isReels ? (
          <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent p-3 text-white">
            <div className="text-[11px] font-semibold drop-shadow">{handle}</div>
            <div className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-[10.5px] drop-shadow">
              {fullCopy || <span className="text-white/60">Sua legenda aparece aqui…</span>}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // Feed padrão (IG/FB/LinkedIn/X)
  return (
    <div
      className={cn(
        "w-full max-w-[380px] overflow-hidden rounded-2xl border shadow-sm",
        chromeStyle.card,
        className,
      )}
    >
      {/* Header (X mostra @handle · texto acima da mídia) */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar className={cn("h-8 w-8 shrink-0", chromeStyle.avatarRing)}>
            <AvatarImage src={avatarUrl ?? undefined} />
            <AvatarFallback className="text-[10px] uppercase">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold">{handle}</div>
            {location ? (
              <div className="truncate text-[10px] text-muted-foreground">{location}</div>
            ) : (
              <div className="truncate text-[10px] capitalize text-muted-foreground">{channel}</div>
            )}
          </div>
        </div>
        <MoreHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>

      {/* Copy acima da mídia — LinkedIn/X */}
      {(channel === "linkedin" || channel === "x") && fullCopy ? (
        <div className="px-3 pb-2 text-[11.5px] leading-snug">
          <span className="whitespace-pre-wrap text-foreground/90">{fullCopy}</span>
        </div>
      ) : null}

      {/* Media */}
      {isCarousel ? (
        <CarouselPreview slides={slides} wide={wideMedia} />
      ) : (
        <div
          className="relative w-full bg-muted"
          style={{ aspectRatio: wideMedia ? "1.91 / 1" : "1 / 1" }}
        >
          {media?.publicUrl ? (
            media.kind === "video" ? (
              <video
                src={media.publicUrl}
                className="h-full w-full object-cover"
                muted
                playsInline
                loop
                autoPlay
              />
            ) : (
              <img
                src={media.publicUrl}
                alt="Prévia da peça"
                className="h-full w-full object-cover"
              />
            )
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
              <ImageIcon className="h-6 w-6" />
              <span className="text-[10.5px]">Nenhuma mídia selecionada</span>
            </div>
          )}
          {/* Carrossel sem lista de mídias — apenas indicadores */}
          {format === "carrossel" && mediaCount > 1 ? (
            <div className="absolute inset-x-0 bottom-2 z-10 flex items-center justify-center gap-1">
              {Array.from({ length: Math.min(mediaCount, 10) }).map((_, i) => (
                <span
                  key={i}
                  className={cn("h-1.5 w-1.5 rounded-full", i === 0 ? "bg-white" : "bg-white/50")}
                />
              ))}
            </div>
          ) : null}
        </div>
      )}


      {/* Actions bar — Instagram/Facebook only */}
      {channel === "instagram" || channel === "facebook" ? (
        <div className="flex items-center justify-between px-3 pt-2.5">
          <div className="flex items-center gap-3 text-foreground">
            <Heart className="h-5 w-5" />
            <MessageSquare className="h-5 w-5" />
            <Share className="h-5 w-5" />
          </div>
          <Bookmark className="h-5 w-5" />
        </div>
      ) : null}

      {/* Copy abaixo — IG/FB */}
      {channel === "instagram" || channel === "facebook" ? (
        <div className="px-3 pb-3 pt-2">
          <div className="text-[11.5px] leading-snug">
            <span className="font-semibold">{handle}</span>{" "}
            <span className="whitespace-pre-wrap text-foreground/90">
              {fullCopy || <span className="text-muted-foreground">Sua legenda aparece aqui…</span>}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Carrossel navegável — arraste lateral (mouse/toque), setas, dots e teclado.
 * A ordem exibida é exatamente a ordem de publicação.
 */
function CarouselPreview({ slides, wide }: { slides: PreviewMedia[]; wide: boolean }) {
  const [index, setIndex] = useState(0);
  const dragStart = useRef<number | null>(null);
  const total = slides.length;
  const current = Math.min(index, total - 1);

  const go = (next: number) => setIndex(Math.max(0, Math.min(total - 1, next)));

  return (
    <div
      className="relative w-full select-none overflow-hidden bg-muted"
      style={{ aspectRatio: wide ? "1.91 / 1" : "1 / 1" }}
      role="group"
      aria-roledescription="carrossel"
      aria-label={`Prévia do carrossel — ${total} mídias`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          go(current + 1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(current - 1);
        }
      }}
      onPointerDown={(e) => {
        dragStart.current = e.clientX;
      }}
      onPointerUp={(e) => {
        const start = dragStart.current;
        dragStart.current = null;
        if (start === null) return;
        const delta = e.clientX - start;
        if (Math.abs(delta) < 30) return;
        go(delta < 0 ? current + 1 : current - 1);
      }}
      onPointerCancel={() => {
        dragStart.current = null;
      }}
    >
      <div
        className="flex h-full w-full transition-transform duration-300 ease-out"
        style={{ transform: `translateX(-${current * 100}%)` }}
      >
        {slides.map((slide, i) => (
          <div key={`${slide.publicUrl ?? "slot"}-${i}`} className="h-full w-full shrink-0">
            {slide.kind === "video" ? (
              <video
                src={slide.publicUrl ?? undefined}
                className="pointer-events-none h-full w-full object-cover"
                muted
                playsInline
                loop
              />
            ) : (
              <img
                src={slide.publicUrl ?? undefined}
                alt={`Mídia ${i + 1} de ${total}`}
                draggable={false}
                className="pointer-events-none h-full w-full object-cover"
              />
            )}
          </div>
        ))}
      </div>

      {/* Contador de ordem */}
      <div className="absolute right-2 top-2 z-10 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">
        {current + 1}/{total}
      </div>

      {/* Setas */}
      {current > 0 ? (
        <button
          type="button"
          aria-label="Mídia anterior"
          onClick={() => go(current - 1)}
          className="absolute left-1.5 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-1 text-white transition-opacity hover:bg-black/70"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      ) : null}
      {current < total - 1 ? (
        <button
          type="button"
          aria-label="Próxima mídia"
          onClick={() => go(current + 1)}
          className="absolute right-1.5 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-1 text-white transition-opacity hover:bg-black/70"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      ) : null}

      {/* Dots */}
      <div className="absolute inset-x-0 bottom-2 z-10 flex items-center justify-center gap-1">
        {slides.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Ir para a mídia ${i + 1}`}
            aria-current={i === current}
            onClick={() => go(i)}
            className={cn(
              "h-1.5 w-1.5 rounded-full transition-colors",
              i === current ? "bg-white" : "bg-white/50",
            )}
          />
        ))}
      </div>
    </div>
  );
}



function channelChromeStyle(channel: SocialChannel) {
  switch (channel) {
    case "linkedin":
      return {
        card: "border-[#0A66C2]/20 bg-background",
        avatarRing: "ring-2 ring-[#0A66C2]/30",
      };
    case "x":
      return {
        card: "border-neutral-800 bg-background",
        avatarRing: "ring-2 ring-neutral-500/40",
      };
    case "facebook":
      return {
        card: "border-[#1877F2]/20 bg-background",
        avatarRing: "ring-2 ring-[#1877F2]/30",
      };
    default:
      return {
        card: "border-border/60 bg-background",
        avatarRing: "ring-2 ring-primary/30",
      };
  }
}
