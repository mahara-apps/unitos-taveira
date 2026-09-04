import type { ComponentType } from "react";
import { ExternalLink, IdCard, Instagram, Linkedin, Music2, Youtube } from "lucide-react";
import { OverviewCard, OverviewEmpty, OverviewLink } from "./overview-shared";

const SOCIALS: Array<{
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  urlPrefix: string;
}> = [
  { key: "instagram", label: "Instagram", icon: Instagram, urlPrefix: "https://instagram.com/" },
  { key: "tiktok", label: "TikTok", icon: Music2, urlPrefix: "https://tiktok.com/@" },
  { key: "linkedin", label: "LinkedIn", icon: Linkedin, urlPrefix: "https://linkedin.com/in/" },
  { key: "youtube", label: "YouTube", icon: Youtube, urlPrefix: "https://youtube.com/@" },
];

export function OverviewClientInfo({
  contactName,
  contactEmail,
  niche,
  socials,
  onOpenCadastro,
}: {
  contactName: string | null;
  contactEmail: string | null;
  niche: string | null;
  socials: Record<string, string | undefined>;
  onOpenCadastro?: () => void;
}) {
  const linked = SOCIALS.filter((s) => !!socials?.[s.key]);
  const hasInfo = !!contactName || !!contactEmail || !!niche || linked.length > 0;

  return (
    <OverviewCard
      title="Informações do cliente"
      subtitle="Contato e canais"
      icon={<IdCard className="h-4 w-4" />}
      footer={<OverviewLink label="Ver cadastro" onClick={onOpenCadastro} />}
    >
      {!hasInfo ? (
        <OverviewEmpty
          icon={<IdCard className="h-4 w-4" />}
          title="Cadastro incompleto"
          hint="Adicione contato e canais no cadastro do cliente."
        />
      ) : (
        <div className="space-y-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Contato principal
            </div>
            <div className="mt-1 text-[13px] font-medium">{contactName ?? "—"}</div>
            {contactEmail ? (
              <a
                href={`mailto:${contactEmail}`}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                {contactEmail}
              </a>
            ) : null}
          </div>
          {niche ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Nicho
              </div>
              <div className="mt-1 truncate text-[13px]">{niche}</div>
            </div>
          ) : null}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Canais</div>
            {linked.length === 0 ? (
              <div className="mt-1 text-[12px] text-muted-foreground">
                Nenhum canal vinculado ainda.
              </div>
            ) : (
              <ul className="mt-1.5 space-y-1.5">
                {linked.map((s) => {
                  const handle = (socials?.[s.key] ?? "").replace(/^@/, "");
                  const Icon = s.icon;
                  return (
                    <li key={s.key}>
                      <a
                        href={`${s.urlPrefix}${handle}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-accent/40"
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="text-[13px] font-medium">{s.label}</span>
                        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                          @{handle}
                        </span>
                        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </OverviewCard>
  );
}
