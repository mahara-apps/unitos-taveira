import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ensureFeatureEnabled } from "@/lib/feature-flags.gate";

export const Route = createFileRoute("/_authenticated/customers")({
  beforeLoad: () => ensureFeatureEnabled("customers"),
  component: () => <Outlet />,
});
