import { useTheme } from "@/components/theme-provider";
import { useActiveContextOptional } from "@/hooks/use-active-context";
import { useBrandBranding } from "@/hooks/use-brand-branding";
import { BrandLogo } from "@/components/brand/brand-logo";

type Props = {
  variant?: "full" | "mark";
  className?: string;
  eager?: boolean;
  align?: "left" | "center";
};

/**
 * Logo da instalação (sidebar e telas internas). Casca fina sobre `BrandLogo`:
 * dimensões reservadas, fallback SVG local imediato e zero layout shift.
 */
export function UnitosLogo({ variant = "full", className, eager = true, align = "left" }: Props) {
  const { resolvedTheme } = useTheme();
  const { brandId } = useActiveContextOptional();
  const branding = useBrandBranding(brandId);
  const isMark = variant === "mark";
  const src = isMark
    ? branding.icon
    : resolvedTheme === "dark"
      ? branding.logoDark
      : branding.logoLight;

  return (
    <BrandLogo
      src={src}
      variant={variant}
      alt="Unitos"
      eager={eager}
      align={align}
      className={className}
    />
  );
}
