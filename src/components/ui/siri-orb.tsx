import { cn } from "@/lib/utils";

export function SiriOrb({ className, size = 96 }: { className?: string; size?: number }) {
  return (
    <div
      className={cn("relative mx-auto select-none", className)}
      style={{ width: size, height: size, animation: "orb-breathe 4s ease-in-out infinite" }}
      aria-hidden
    >
      <div
        className="absolute inset-[-18%] rounded-full opacity-70 blur-2xl"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, rgba(139,92,246,0.55), rgba(236,72,153,0.25) 55%, transparent 75%)",
        }}
      />
      <div
        className="absolute inset-0 overflow-hidden rounded-full"
        style={{ mixBlendMode: "screen", filter: "blur(12px)" }}
      >
        <div
          className="absolute inset-[-10%] rounded-full"
          style={{
            background:
              "radial-gradient(circle at 30% 35%, rgba(236,72,153,0.95), transparent 60%)",
            animation: "orb-drift-a 7s ease-in-out infinite",
          }}
        />
        <div
          className="absolute inset-[-10%] rounded-full"
          style={{
            background: "radial-gradient(circle at 70% 40%, rgba(34,211,238,0.9), transparent 60%)",
            animation: "orb-drift-b 9s ease-in-out infinite",
          }}
        />
        <div
          className="absolute inset-[-10%] rounded-full"
          style={{
            background:
              "radial-gradient(circle at 55% 70%, rgba(139,92,246,0.95), transparent 62%)",
            animation: "orb-drift-c 11s ease-in-out infinite",
          }}
        />
        <div
          className="absolute inset-[-10%] rounded-full"
          style={{
            background:
              "radial-gradient(circle at 40% 60%, rgba(99,102,241,0.85), transparent 60%)",
            animation: "orb-drift-d 13s ease-in-out infinite",
          }}
        />
      </div>
      <div
        className="absolute inset-0 rounded-full"
        style={{
          boxShadow: "inset 0 0 24px rgba(255,255,255,0.18), inset 0 0 1px rgba(255,255,255,0.6)",
        }}
      />
      <div
        className="absolute left-1/2 top-1/2 h-3 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90 blur-md"
        style={{ animation: "orb-core-pulse 3.2s ease-in-out infinite" }}
      />
    </div>
  );
}
