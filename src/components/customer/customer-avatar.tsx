import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function getCustomerInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name
    .trim()
    .split(/[\s\-_/·•]+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    const p = parts[0];
    return (p[0]! + (p[1] ?? "")).toUpperCase();
  }
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Deterministic subtle gradient derived from the name so the fallback stays
 *  premium (Vercel/Stripe-style) yet consistent per customer. */
function gradientFromName(name: string | null | undefined): string {
  const s = name ?? "";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const hue2 = (hue + 40) % 360;
  return `linear-gradient(135deg, oklch(0.62 0.16 ${hue}), oklch(0.5 0.18 ${hue2}))`;
}

export function CustomerAvatar({
  name,
  logoUrl,
  className,
  textClassName,
}: {
  name: string | null | undefined;
  logoUrl?: string | null;
  className?: string;
  textClassName?: string;
}) {
  const initials = getCustomerInitials(name);
  return (
    <Avatar className={cn("h-6 w-6 rounded-md", className)}>
      {logoUrl ? (
        <AvatarImage
          src={logoUrl}
          alt={name ? `${name} logo` : "Customer logo"}
          className="object-cover"
        />
      ) : null}
      <AvatarFallback
        className={cn("rounded-md text-[10px] font-semibold text-white", textClassName)}
        style={{ background: gradientFromName(name) }}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
