import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import { usePageHeader } from "@/hooks/use-page-header";
import { Button } from "@/components/ui/button";
import { BrainIntelligencePanel } from "@/components/brain/brain-intelligence-panel";
import { ensureFeatureEnabled } from "@/lib/feature-flags.gate";
import { useActiveContext } from "@/hooks/use-active-context";

export const Route = createFileRoute("/_authenticated/brain")({
  beforeLoad: () => ensureFeatureEnabled("brain"),
  component: BrainRoute,
});

function BrainRoute() {
  usePageHeader(
    {
      title: "Brain",
      subtitle: "Memória viva da agência — a IA aprendendo com cada evento.",
      actions: (
        <Button asChild variant="outline" size="sm">
          <Link to="/brain/diagnostics">
            <Activity className="mr-2 h-4 w-4" />
            Diagnostics
          </Link>
        </Button>
      ),
    },
    [],
  );
  const { brandId, clientId } = useActiveContext();
  return <BrainIntelligencePanel brandId={brandId} clientId={clientId} lockClient={!!clientId} />;
}
