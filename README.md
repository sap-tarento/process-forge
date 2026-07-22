# AtomForge

**Compile organizational documents into governed process atoms that AI agents can safely consume at runtime.**

AtomForge is an open-source reference implementation of the Tarento Labs research paper
*"Process Atoms as Compiled Units of Organizational Policy"*. It takes policies, SOPs,
regulations, and contracts and compiles them into versioned, source-grounded units of
procedural knowledge — with human review, conflict resolution, and a bitemporal lifecycle
built in.

## Why atoms

LLM agents ingesting raw policy documents fail in two predictable ways:

- **Silent scope widening** — a rule stated for one activity is applied everywhere.
- **Ungrounded reasoning** — the agent paraphrases and invents obligations that don't exist.

A process atom fixes both. Each atom captures **exactly one** obligation, prohibition,
permission, responsibility, decision rule, data requirement, escalation, sequence,
temporal rule, or exception — and strictly separates:

- **Applicability (Φ)** — the typed conditions under which the rule applies.
- **Action (A)** — the required behavior (`MUST` / `MUST_NOT` / `MAY`), with actor, object, and on-noncompliance.
- **Purpose** — the reason the rule exists (descriptive, never operational).

### The core safeguard

**Unknown scope is never universal scope.** A missing scope dimension is
`{value: null, status: "not_stated", requires_review: true}` — never `"*"`. LLM output
that omits scope cannot silently become "applies to everything"; it becomes a
review task.

## The 12-component atom

```
⟨Identity, Version, KnowledgeType, Provenance, Applicability(Φ), Action(A),
 Purpose, DomainTags, Governance, Relationships,
 RetrievalRepresentations, ValidationMetadata⟩
```

See `src/types/atom.ts` for the single source of truth.

## The 14-stage compilation pipeline

```
1  source_registration              8  provenance_binding
2  layout_aware_parsing             9  quality_validation (4 layers)
3  document_section_classification 10  memory_retrieval
4  candidate_span_detection        11  conflict_analysis
5  atomic_decomposition            12  change_set_generation
6  phi_a_p_extraction              13  human_review        ← mandatory
7  domain_grounding                14  versioned_publication
```

Human review at Stage 13 is **mandatory** — there is no code path to `active` status
that bypasses it. Publication at Stage 14 has a hard groundedness gate: any action or
scope field with derivation `unknown`, or any dimension still flagged
`requires_review`, refuses publication.

## Runtime

Agents fetch atoms via `POST /api/public/retrieve` (or from the in-app **Runtime**
playground), which returns the ranked atoms plus the full 8-step retrieval trace:
concept resolution → global atoms → scope filtering → predicate evaluation →
semantic rerank → relationship pull → precedence resolution → final ranking.

Set the `ATOMFORGE_RUNTIME_TOKEN` secret to require a bearer token on the public endpoint.

## Getting started

1. Sign in — the first account becomes `admin`.
2. **Settings** → configure the LLM provider (Lovable AI works with no key) and
   optionally click **Load demo scenario** for the paper's procurement example.
3. **Sources** → register a document (PDF, Markdown, plain text). NORMATIVE sources
   produce binding atoms; DESCRIPTIVE sources (event logs, agent traces) produce
   only candidate observed practice.
4. **Pipeline** → run the 14-stage compilation.
5. **Review** → approve, edit, reject, or open conflict resolution.
6. **Runtime** → simulate an agent context request against the resulting memory.

## Tech stack

TanStack Start (React 19, Vite 7) · Tailwind v4 · Supabase (Postgres + pgvector) ·
pluggable LLM gateway (Lovable AI / OpenAI / Anthropic / custom).

## Research credit

AtomForge implements the model described in *"Process Atoms as Compiled Units of
Organizational Policy"* (Tarento Labs). The 12-component atom, the 14-stage
compilation pipeline, the deontic action semantics, the deterministic conflict
calculus, and the not-stated-is-not-universal safeguard are all drawn directly
from that work.

## License

MIT — see [LICENSE](./LICENSE).
