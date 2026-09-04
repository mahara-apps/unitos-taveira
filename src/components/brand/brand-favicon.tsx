import { useEffect } from "react";
import { useActiveContext } from "@/hooks/use-active-context";
import { useBrandBranding } from "@/hooks/use-brand-branding";

export function BrandFavicon() {
  const { brandId } = useActiveContext();
  const { icon, iconCustom } = useBrandBranding(brandId);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!iconCustom || !icon) return; // keep default favicon when no custom icon
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
    const previous = links.map((l) => ({ el: l, href: l.href }));
    links.forEach((l) => {
      l.href = icon;
    });
    if (links.length === 0) {
      const el = document.createElement("link");
      el.rel = "icon";
      el.href = icon;
      document.head.appendChild(el);
      return () => {
        el.remove();
      };
    }
    return () => {
      previous.forEach(({ el, href }) => {
        el.href = href;
      });
    };
  }, [icon, iconCustom]);

  return null;
}
