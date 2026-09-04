import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { classifyBrainEvent } from "./classify";

export type BrainStreamEvent = {
  id: string;
  brandId: string | null;
  category: "content" | "media" | "messaging" | "insight";
  eventType: string;
  sourceModule: string;
  at: number;
};

/**
 * Subscribe to realtime Brain events. Filtered by brand when provided,
 * otherwise streams the agency-wide feed.
 */
export function useBrainStream(brandId?: string | null) {
  const [last, setLast] = useState<BrainStreamEvent | null>(null);
  useEffect(() => {
    const filter = brandId ? `brand_id=eq.${brandId}` : undefined;
    const ch = supabase.channel(`brain-events:${brandId ?? "all"}`);
    ch.on(
      "postgres_changes" as never,
      { event: "INSERT", schema: "public", table: "brain_events", filter },
      (payload: { new: Record<string, unknown> }) => {
        const row = payload.new;
        setLast({
          id: String(row.id),
          brandId: (row.brand_id as string | null) ?? null,
          category: classifyBrainEvent(
            String(row.source_module ?? ""),
            String(row.event_type ?? ""),
          ),
          eventType: String(row.event_type ?? ""),
          sourceModule: String(row.source_module ?? ""),
          at: Date.now(),
        });
      },
    );
    ch.on(
      "postgres_changes" as never,
      { event: "INSERT", schema: "public", table: "brain_insights", filter },
      () => {
        setLast({
          id: `insight-${Date.now()}`,
          brandId: brandId ?? null,
          category: "insight",
          eventType: "insight_created",
          sourceModule: "brain",
          at: Date.now(),
        });
      },
    );
    ch.subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [brandId]);
  return last;
}
