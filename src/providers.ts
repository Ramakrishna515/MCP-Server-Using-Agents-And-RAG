export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type FunctionTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ProviderConfig = {
  name: string;
  displayName: string;
  apiKeyEnv: string;
  baseUrl: string;
  defaultModel: string;
  models: { id: string; name: string }[];
};

export const PROVIDERS: Record<string, ProviderConfig> = {
  grok: {
    name: "grok",
    displayName: "Grok (xAI)",
    apiKeyEnv: "XAI_API_KEY",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4.1-fast-non-reasoning",
    models: [
      { id: "grok-4.1-fast-non-reasoning", name: "Grok 4.1 Fast" },
      { id: "grok-3-mini-beta", name: "Grok 3 Mini" },
    ],
  },
  openai: {
    name: "openai",
    displayName: "OpenAI (GPT)",
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: [
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
    ],
  },
  anthropic: {
    name: "anthropic",
    displayName: "Anthropic (Claude)",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-5-sonnet-20241022",
    models: [
      { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
      { id: "claude-3-haiku-20240307", name: "Claude 3 Haiku" },
    ],
  },
  tinyfish: {
    name: "tinyfish",
    displayName: "TinyFish (Search)",
    apiKeyEnv: "TINYFISH_API_KEY",
    baseUrl: "https://api.search.tinyfish.ai",
    defaultModel: "tinyfish-search",
    models: [{ id: "tinyfish-search", name: "TinyFish Search" }],
  },
  gemini: {
    name: "gemini",
    displayName: "Gemini (Google)",
    apiKeyEnv: "GEMINI_API_KEY",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-3.6-flash",
    models: [
      { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    ],
  },
};

function resolveBaseUrl(provider: ProviderConfig): string {
  const envName = provider.apiKeyEnv.replace("_API_KEY", "_BASE_URL");
  return process.env[envName] || provider.baseUrl;
}

async function callOpenAICompatible(
  provider: ProviderConfig,
  model: string,
  messages: ChatMessage[],
  tools: FunctionTool[],
  apiKey: string,
  signal?: AbortSignal
): Promise<ChatMessage> {
  const body: Record<string, unknown> = { model, messages };
  if (tools.length > 0) body.tools = tools;

  const res = await fetch(`${resolveBaseUrl(provider)}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${provider.displayName} API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { choices: { message: ChatMessage }[] };
  return data.choices[0].message;
}

async function callAnthropic(
  model: string,
  messages: ChatMessage[],
  tools: FunctionTool[],
  apiKey: string,
  signal?: AbortSignal
): Promise<ChatMessage> {
  const systemMsg = messages.find((m) => m.role === "system");
  const otherMsgs = messages.filter((m) => m.role !== "system");

  const formattedMessages = otherMsgs.map((m) => {
    if (m.role === "tool") {
      return {
        role: "user" as const,
        content: [
          {
            type: "tool_result" as const,
            tool_use_id: m.tool_call_id!,
            content: m.content,
          },
        ],
      };
    }
    if (m.role === "assistant" && m.tool_calls) {
      return {
        role: "assistant" as const,
        content: m.tool_calls.map((tc) => ({
          type: "tool_use" as const,
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments || "{}"),
        })),
      };
    }
    return { role: m.role as "user" | "assistant", content: m.content };
  });

  const body: Record<string, unknown> = {
    model,
    max_tokens: 4096,
    messages: formattedMessages,
  };
  if (systemMsg) body.system = systemMsg.content;
  if (tools.length > 0) {
    body.tools = tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }

  const res = await fetch(`https://api.anthropic.com/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    content: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
  };

  const textBlocks = data.content.filter((b) => b.type === "text");
  const toolBlocks = data.content.filter((b) => b.type === "tool_use");

  const result: ChatMessage = {
    role: "assistant",
    content: textBlocks.map((b) => b.text).join("\n") || "",
  };

  if (toolBlocks.length > 0) {
    result.tool_calls = toolBlocks.map((b) => ({
      id: b.id!,
      type: "function" as const,
      function: {
        name: b.name!,
        arguments: JSON.stringify(b.input || {}),
      },
    }));
  }

  return result;
}

function toGeminiPayload(messages: ChatMessage[], tools: FunctionTool[]) {
  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");

  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.role === "tool") {
        return {
          role: "user" as const,
          parts: [{ text: `Tool result: ${m.content}` }],
        };
      }
      return {
        role: m.role === "assistant" ? ("model" as const) : ("user" as const),
        parts: [{ text: m.content }],
      };
    });

  const body: Record<string, unknown> = { contents };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
  if (tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      },
    ];
  }
  return body;
}

async function callGemini(
  provider: ProviderConfig,
  model: string,
  messages: ChatMessage[],
  tools: FunctionTool[],
  apiKey: string,
  signal?: AbortSignal
): Promise<ChatMessage> {
  const res = await fetch(
    `${resolveBaseUrl(provider)}/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(toGeminiPayload(messages, tools)),
      signal,
    }
  );

  if (!res.ok) {
    let detail = "";
    try {
      const json = (await res.json()) as { error?: { message?: string } };
      detail = json.error?.message || "";
    } catch {}
    throw new Error(`Gemini API error ${res.status}: ${detail || (await res.text())}`);
  }

  const data = (await res.json()) as {
    candidates?: {
      content?: { parts?: { text?: string; thought?: boolean }[] };
    }[];
  };

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text!)
    .join("\n");

  return { role: "assistant", content: text };
}

export async function* streamGemini(
  provider: ProviderConfig,
  model: string,
  messages: ChatMessage[],
  apiKey: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const res = await fetch(
    `${resolveBaseUrl(provider)}/models/${model}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(toGeminiPayload(messages, [])),
      signal,
    }
  );

  if (!res.ok) {
    let detail = "";
    try {
      const json = (await res.json()) as { error?: { message?: string } };
      detail = json.error?.message || "";
    } catch {}
    throw new Error(`Gemini API error ${res.status}: ${detail || (await res.text())}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let acc = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const jsonStr = trimmed.slice(5).trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;
      try {
        const data = JSON.parse(jsonStr) as {
          candidates?: {
            content?: { parts?: { text?: string; thought?: boolean }[] };
          }[];
        };
        const parts = data.candidates?.[0]?.content?.parts ?? [];
        const text = parts
          .filter((p) => p.text && !p.thought)
          .map((p) => p.text!)
          .join("\n");
        if (!text) continue;

        if (acc && text.startsWith(acc)) {
          const delta = text.slice(acc.length);
          acc = text;
          if (delta) yield delta;
        } else {
          acc += text;
          yield text;
        }
      } catch {}
    }
  }
}

export async function* streamLLM(
  providerName: string,
  model: string | undefined,
  messages: ChatMessage[],
  signal?: AbortSignal
): AsyncGenerator<string> {
  const provider = PROVIDERS[providerName];
  if (!provider) throw new Error(`Unknown provider: ${providerName}`);

  const apiKey = process.env[provider.apiKeyEnv];
  if (!apiKey) {
    throw new Error(
      `Missing ${provider.apiKeyEnv} env var for ${provider.displayName}. ` +
        `Get a key and set it in .env`
    );
  }

  const resolvedModel = model || provider.defaultModel;

  if (providerName === "gemini") {
    yield* streamGemini(provider, resolvedModel, messages, apiKey, signal);
    return;
  }

  const result = await callLLM(providerName, model, messages, [], signal);
  if (result.content) yield result.content;
}

export async function callLLM(
  providerName: string,
  model: string | undefined,
  messages: ChatMessage[],
  tools: FunctionTool[],
  signal?: AbortSignal
): Promise<ChatMessage> {
  const provider = PROVIDERS[providerName];
  if (!provider) throw new Error(`Unknown provider: ${providerName}`);

  const apiKey = process.env[provider.apiKeyEnv];
  if (!apiKey) {
    throw new Error(
      `Missing ${provider.apiKeyEnv} env var for ${provider.displayName}. ` +
        `Get a key and set it in .env`
    );
  }

  const resolvedModel = model || provider.defaultModel;

  if (providerName === "anthropic") {
    return callAnthropic(resolvedModel, messages, tools, apiKey, signal);
  }

  if (providerName === "gemini") {
    return callGemini(provider, resolvedModel, messages, tools, apiKey, signal);
  }

  return callOpenAICompatible(provider, resolvedModel, messages, tools, apiKey, signal);
}
