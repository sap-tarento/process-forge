
ALTER TABLE public.change_set_items
  ADD COLUMN IF NOT EXISTS extraction_debug jsonb;

UPDATE public.prompt_versions
   SET active = false
 WHERE prompt_key = 'extraction' AND active = true;

INSERT INTO public.prompt_versions (prompt_key, version, template, active)
VALUES ('extraction', 2,
$PROMPT$You are extracting PROCESS ATOMS from a candidate normative span, per the Tarento Labs specification.

Contract (do not violate):
1. Emit exactly ONE atom per independently changeable behavioral rule.
   - A rule + its enforcement consequence is ONE atom (the consequence goes in action.on_noncompliance).
   - Two independently changeable obligations become TWO atoms in the returned array.
2. Preserve every threshold, quantifier, deadline, negation, and exception verbatim in the atom fields.
3. Strictly separate applicability (WHEN) / action (WHAT) / purpose (WHY).
4. Derive applicability from: the span, the section heading path, document metadata, supplied domain context.
5. NEVER assume universal scope when scope is absent. If a dimension is not stated, emit
   {"value": null, "status": "not_stated", "requires_review": true}.
   Do NOT use "*" or "all" as a placeholder. Silence is not universality.
6. For every field, evidence.derivation is one of: explicit | inherited | inferred | unknown.
7. Include an exact evidence quote and page/section for each derivation.
8. Do not create rules from explanatory examples.
9. Do NOT emit purpose.execution_authoritative; the system forces it to false.
10. atom_id is a stable dotted slug: <domain>.<object>.<rule-slug> (lowercase, kebab-case parts).
11. identity.name is REQUIRED — a short imperative human-readable summary
    (e.g. "Require valid cost center on purchase requisitions",
     "Avoid XML/JSON parsers for XML/JSON transformations").
    NEVER return an atom without a non-empty name.

Atomicity test: "Can this requirement be independently retrieved, approved, changed, superseded, or violated?" If yes, it is a separate atom.

Return schema-valid JSON of the form:
{"atoms": [ <ProcessAtom>, ... ]}
Return {"atoms": []} if the span does not encode a rule after all.

Each ProcessAtom MUST match this exact nested shape (fields marked ? are optional):

{
  "identity": {
    "atom_id": "<domain>.<object>.<rule-slug>",        // REQUIRED, lowercase kebab dotted
    "name":    "<concise imperative summary>"          // REQUIRED, never empty
  },
  "knowledge_type": "OBLIGATION" | "PROHIBITION" | "PERMISSION" | "RESPONSIBILITY" |
                    "DECISION_RULE" | "DATA_REQUIREMENT" | "ESCALATION" | "SEQUENCE" |
                    "TEMPORAL_RULE" | "EXCEPTION",
  "action": {
    "modality":  "MUST" | "MUST_NOT" | "MAY",           // REQUIRED
    "actor":     "<role or system that acts>",          // REQUIRED, non-empty
    "operation": "<verb, e.g. 'assign', 'approve'>",    // REQUIRED, non-empty
    "object":    "<business object acted upon>",        // REQUIRED, non-empty
    "target":    "<optional recipient/target>"?,
    "parameters": { ... }?,
    "deadline":  "<optional deadline string>"?,
    "timing":    "<optional timing string>"?,
    "on_noncompliance": [                                // enforcement consequences of THIS rule
      { "modality": "...", "actor": "...", "operation": "...", "object": "..." }
    ]
  },
  "applicability": {
    "process":          <ScopedValue>,
    "activities":       <ScopedValue>,
    "roles":            <ScopedValue>,
    "business_objects": <ScopedValue>,
    "organizational_scope": {
      "company_codes": <ScopedValue>,
      "subsidiaries":  <ScopedValue>,
      "plants":        <ScopedValue>
    },
    "preconditions": [
      { "field": "<attribute>", "operator": "EQUALS" | "IN" | "NOT_IN" | "GT" | "GTE" | "LT" | "LTE" | "EXISTS", "value": ... }
    ],
    "exceptions": [ /* same shape as preconditions */ ],
    "temporal_scope": { "valid_from": "<iso date | null>", "valid_to": "<iso date | null>" }
  },
  "purpose": {
    "text":       "<why this rule exists>",
    "derivation": "explicit" | "inferred" | "unknown",
    "confidence": 0.0-1.0
    // DO NOT emit execution_authoritative; the system forces it to false.
  },
  "domain_tags": {
    "corporate_function":  [ "..." ],
    "end_to_end_process":  [ "..." ],
    "process":             [ "..." ],
    "activity":            [ "..." ],
    "business_object":     [ "..." ],
    "role":                [ "..." ],
    "system":              [ "..." ],
    "organizational_unit": [ "..." ]
  },
  "provenance": {
    "page":            <int?>,
    "section":         "<heading path?>",
    "paragraph_id":    "<optional>",
    "character_start": <int?>,
    "character_end":   <int?>,
    "quoted_evidence": [
      { "text": "<verbatim quote>", "page": <int?>, "section": "<heading?>" }
    ]                                                  // REQUIRED: at least one entry
  },
  "governance": {
    "owner":              "<optional owner role>"?,
    "required_approvers": [ "..." ]?,
    "authority_level":    "regulatory" | "board" | "executive" | "functional" | "local"
  },
  "quality": {
    "action_confidence":        0.0-1.0,
    "applicability_confidence": 0.0-1.0,
    "purpose_confidence":       0.0-1.0,
    "atomicity_score":          0.0-1.0
  }
}

Where <ScopedValue> is:
{
  "value":  [ "..." ] | null,                                       // null when not stated
  "status": "explicit" | "inherited" | "inferred" | "not_stated",
  "requires_review": true | false,                                  // true whenever status != explicit
  "evidence": {
    "derivation":     "explicit" | "inherited" | "inferred" | "unknown",
    "source_page":    <int?>,
    "source_section": "<heading path?>",
    "source_span":    "<verbatim quote?>"
  }
}

Fully-filled example (COPY this structure exactly for every atom):

{
  "atoms": [
    {
      "identity": {
        "atom_id": "procurement.purchase-requisition.cost-center-required",
        "name": "Require valid cost center on purchase requisitions"
      },
      "knowledge_type": "DATA_REQUIREMENT",
      "action": {
        "modality": "MUST",
        "actor": "Requester",
        "operation": "assign",
        "object": "cost center",
        "target": "purchase requisition",
        "on_noncompliance": [
          { "modality": "MUST_NOT", "actor": "System", "operation": "submit", "object": "purchase requisition" }
        ]
      },
      "applicability": {
        "process": {
          "value": ["Procure-to-Pay"],
          "status": "explicit",
          "requires_review": false,
          "evidence": { "derivation": "explicit", "source_page": 12, "source_section": "3.2 Purchase Requisitions",
                        "source_span": "For every purchase requisition submitted under Procure-to-Pay ..." }
        },
        "activities": {
          "value": ["Create purchase requisition"],
          "status": "explicit",
          "requires_review": false,
          "evidence": { "derivation": "explicit", "source_page": 12, "source_section": "3.2 Purchase Requisitions",
                        "source_span": "When creating a purchase requisition ..." }
        },
        "roles": {
          "value": ["Requester"],
          "status": "explicit",
          "requires_review": false,
          "evidence": { "derivation": "explicit", "source_page": 12, "source_section": "3.2 Purchase Requisitions",
                        "source_span": "the requester shall assign a valid cost center" }
        },
        "business_objects": {
          "value": ["purchase requisition"],
          "status": "explicit",
          "requires_review": false,
          "evidence": { "derivation": "explicit", "source_page": 12, "source_section": "3.2 Purchase Requisitions",
                        "source_span": "purchase requisition" }
        },
        "organizational_scope": {
          "company_codes": { "value": null, "status": "not_stated", "requires_review": true,
                             "evidence": { "derivation": "unknown" } },
          "subsidiaries":  { "value": null, "status": "not_stated", "requires_review": true,
                             "evidence": { "derivation": "unknown" } },
          "plants":        { "value": null, "status": "not_stated", "requires_review": true,
                             "evidence": { "derivation": "unknown" } }
        },
        "preconditions": [
          { "field": "cost_center", "operator": "EXISTS", "value": true }
        ],
        "exceptions": [],
        "temporal_scope": { "valid_from": null, "valid_to": null }
      },
      "purpose": {
        "text": "Ensures spend is attributed to the correct budget owner for reporting and controls.",
        "derivation": "inferred",
        "confidence": 0.75
      },
      "domain_tags": {
        "corporate_function":  ["Finance", "Procurement"],
        "end_to_end_process":  ["Procure-to-Pay"],
        "process":             ["Purchase Requisition"],
        "activity":            ["Create purchase requisition"],
        "business_object":     ["purchase requisition", "cost center"],
        "role":                ["Requester"],
        "system":              [],
        "organizational_unit": []
      },
      "provenance": {
        "page": 12,
        "section": "3.2 Purchase Requisitions",
        "quoted_evidence": [
          { "text": "The requester shall assign a valid cost center to every purchase requisition before submission.",
            "page": 12, "section": "3.2 Purchase Requisitions" }
        ]
      },
      "governance": {
        "authority_level": "functional",
        "required_approvers": ["Policy Owner: Procurement"]
      },
      "quality": {
        "action_confidence": 0.9,
        "applicability_confidence": 0.8,
        "purpose_confidence": 0.6,
        "atomicity_score": 0.9
      }
    }
  ]
}

Return ONLY the JSON object, no prose, no code fences.$PROMPT$,
true)
ON CONFLICT DO NOTHING;
