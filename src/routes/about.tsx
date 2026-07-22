import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — AtomForge" },
      { name: "description", content: "AtomForge is an open-source enterprise platform that compiles organizational documents into governed process atoms." },
      { property: "og:title", content: "About AtomForge" },
      { property: "og:description", content: "Open-source process atom compiler based on Tarento Labs research." },
    ],
  }),
  component: About,
});

function About() {
  return (
    <AppShell title="About AtomForge" description="Governed process atoms for AI-assisted operations.">
      <div className="mx-auto max-w-3xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What AtomForge does</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              AtomForge compiles organizational documents — policies, SOPs, regulations, contracts —
              into <span className="text-foreground font-medium">process atoms</span>: self-contained,
              versioned, source-grounded units of procedural knowledge that AI agents can safely
              consume at runtime.
            </p>
            <p>
              Each atom captures <span className="text-foreground">exactly one</span> rule, constraint,
              or responsibility, and strictly separates three concerns:
            </p>
            <ul className="ml-4 list-disc space-y-1">
              <li><span className="text-foreground font-medium">Applicability</span> — the conditions under which the rule applies.</li>
              <li><span className="text-foreground font-medium">Action</span> — the behavior required (MUST / MUST_NOT / MAY).</li>
              <li><span className="text-foreground font-medium">Purpose</span> — the reason the rule exists (descriptive, never operational).</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Core safeguards</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              <Badge variant="secondary" className="mr-2 font-mono text-[10px]">not_stated ≠ *</Badge>
              A missing scope is never widened to a wildcard. Every scope dimension carries an
              explicit epistemic status: <span className="font-mono">explicit</span>,
              <span className="font-mono"> inherited</span>, <span className="font-mono">inferred</span>, or
              <span className="font-mono"> not_stated</span>.
            </p>
            <p>
              <Badge variant="secondary" className="mr-2 font-mono text-[10px]">provenance</Badge>
              Every atom is grounded in quoted source text, with hash, page, section, parser and
              extractor versions pinned for reproducibility.
            </p>
            <p>
              <Badge variant="secondary" className="mr-2 font-mono text-[10px]">governance</Badge>
              Atoms transition through a bitemporal lifecycle (candidate → under_review → approved →
              active → superseded / withdrawn) with explicit owners and required approvers.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Research credit</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              AtomForge implements the model described in the Tarento Labs research paper
              <span className="text-foreground font-medium"> "Process Atoms as Compiled Units of Organizational Policy"</span>.
              The 12-component atom, the 14-stage compilation pipeline, and the not-stated-is-not-universal
              safeguard are all drawn directly from that work.
            </p>
            <p>
              AtomForge is open source. Contributions, adaptations, and research forks are welcome — the
              goal is a shared reference implementation of the atom model, not a closed platform.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
