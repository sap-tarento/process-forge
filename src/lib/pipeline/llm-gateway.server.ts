/**
 * LLM Gateway — single entry point for chat + embeddings across providers.
 * Providers: "lovable" (default via LOVABLE_API_KEY), "openai", "anthropic", "custom".
 * The API key for non-Lovable providers is read from the Supabase secret whose
 * name is stored in llm_settings.api_key_secret_name.
 */

export interface LlmSettings {
  provider: string;
  model: string;
  embedding_provider: string;
  embedding_model: string;
  api_key_secret_name: string | null;
  base_url?: string | null;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCallOptions {
  settings: LlmSettings;
  messages: ChatMessage[];
  json?: boolean;
  temperature?: number;
  promptKey?: string;
  promptVersion?: number;
}

export interface ChatResult {
  content: string;
  model: string;
  provider: string;
  prompt_key?: string;
  prompt_version?: number;
}

function providerKey(settings: LlmSettings): string {
  if (settings.provider === "lovable") {
    const k = process.env.LOVABLE_API_KEY;
    if (!k) throw new Error("LOVABLE_API_KEY is not configured");
    return k;
  }
  const name = settings.api_key_secret_name;
  if (!name) throw new Error(`Provider "${settings.provider}" needs api_key_secret_name in llm_settings`);
  const key = process.env[name];
  if (!key) throw new Error(`Secret "${name}" is not set for provider "${settings.provider}"`);
  return key;
}

async function callOpenAICompatible(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<{ text: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LLM ${res.status}: ${errText.slice(0, 500)}`);
  }
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? "";
  return { text: content };
}

async function callAnthropic(apiKey: string, model: string, messages: ChatMessage[], json?: boolean): Promise<{ text: string }> {
  const system = messages.find((m) => m.role === "system")?.content;
  const rest = messages.filter((m) => m.role !== "system");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: json ? `${system ?? ""}\n\nRespond with valid JSON only.` : system,
      messages: rest.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = await res.json() as { content?: { text?: string }[] };
  return { text: data.content?.[0]?.text ?? "" };
}

export async function chat(opts: ChatCallOptions): Promise<ChatResult> {
  const { settings, messages, json } = opts;
  const apiKey = providerKey(settings);
  let text = "";

  if (settings.provider === "lovable") {
    const body: Record<string, unknown> = {
      model: settings.model,
      messages,
      temperature: opts.temperature ?? 0.2,
    };
    if (json) body.response_format = { type: "json_object" };
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Lovable AI ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    text = data.choices?.[0]?.message?.content ?? "";
  } else if (settings.provider === "openai") {
    const body: Record<string, unknown> = { model: settings.model, messages, temperature: opts.temperature ?? 0.2 };
    if (json) body.response_format = { type: "json_object" };
    const r = await callOpenAICompatible("https://api.openai.com/v1/chat/completions", apiKey, body);
    text = r.text;
  } else if (settings.provider === "anthropic") {
    const r = await callAnthropic(apiKey, settings.model, messages, json);
    text = r.text;
  } else if (settings.provider === "custom") {
    if (!settings.base_url) throw new Error("Custom provider requires base_url");
    const body: Record<string, unknown> = { model: settings.model, messages, temperature: opts.temperature ?? 0.2 };
    if (json) body.response_format = { type: "json_object" };
    const r = await callOpenAICompatible(settings.base_url.replace(/\/$/, "") + "/chat/completions", apiKey, body);
    text = r.text;
  } else {
    throw new Error(`Unknown provider "${settings.provider}"`);
  }

  return {
    content: text,
    model: settings.model,
    provider: settings.provider,
    prompt_key: opts.promptKey,
    prompt_version: opts.promptVersion,
  };
}

/**
 * Parse JSON from an LLM reply that may include prose or code fences.
 */
export function parseJsonLoose<T = unknown>(raw: string): T {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    // Try to grab the first {...} block
    const brace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (brace >= 0 && lastBrace > brace) {
      return JSON.parse(candidate.slice(brace, lastBrace + 1)) as T;
    }
    throw new Error("Model did not return parseable JSON");
  }
}

/**
 * Chat call that expects a JSON object matching a validator; retries once on failure.
 */
export async function chatJson<T>(
  opts: ChatCallOptions,
  validate: (v: unknown) => { ok: true; value: T } | { ok: false; errors: string[] },
): Promise<{ value: T; result: ChatResult }> {
  const first = await chat({ ...opts, json: true });
  try {
    const parsed = parseJsonLoose(first.content);
    const check = validate(parsed);
    if (check.ok) return { value: check.value, result: first };
    // Retry once with the error attached
    const retryMessages: ChatMessage[] = [
      ...opts.messages,
      { role: "assistant", content: first.content },
      {
        role: "user",
        content: `Your JSON did not match the schema. Errors:\n${check.errors.join("\n")}\nReturn a corrected JSON object only.`,
      },
    ];
    const second = await chat({ ...opts, messages: retryMessages, json: true });
    const parsed2 = parseJsonLoose(second.content);
    const check2 = validate(parsed2);
    if (check2.ok) return { value: check2.value, result: second };
    throw new Error(`Schema validation failed after retry: ${check2.errors.slice(0, 3).join("; ")}`);
  } catch (e) {
    if (e instanceof Error) throw e;
    throw new Error(String(e));
  }
}
