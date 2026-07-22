import { Badge } from "@/components/ui/badge";
import type { AtomStatus, ScopeStatus, ActionModality } from "@/types/atom";
import { cn } from "@/lib/utils";

const LIFECYCLE_VARIANT: Record<AtomStatus, string> = {
  candidate: "bg-muted text-muted-foreground border-border",
  under_review: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  approved: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30",
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  superseded: "bg-muted text-muted-foreground border-border line-through",
  withdrawn: "bg-destructive/10 text-destructive border-destructive/30",
};

const SCOPE_VARIANT: Record<ScopeStatus, string> = {
  explicit: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  inherited: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30",
  inferred: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  not_stated: "bg-destructive/10 text-destructive border-destructive/30",
};

const MODALITY_VARIANT: Record<ActionModality, string> = {
  MUST: "bg-primary text-primary-foreground border-primary",
  MUST_NOT: "bg-destructive text-destructive-foreground border-destructive",
  MAY: "bg-secondary text-secondary-foreground border-border",
};

export function LifecycleBadge({ status }: { status: AtomStatus }) {
  return (
    <Badge variant="outline" className={cn("uppercase tracking-wide text-[10px]", LIFECYCLE_VARIANT[status])}>
      {status.replace("_", " ")}
    </Badge>
  );
}

export function ScopeBadge({ status }: { status: ScopeStatus }) {
  return (
    <Badge variant="outline" className={cn("text-[10px]", SCOPE_VARIANT[status])}>
      {status.replace("_", " ")}
    </Badge>
  );
}

export function ModalityBadge({ modality }: { modality: ActionModality }) {
  return (
    <Badge variant="outline" className={cn("font-mono text-[10px]", MODALITY_VARIANT[modality])}>
      {modality}
    </Badge>
  );
}