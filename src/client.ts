import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

let arka = 0;

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type XaiFunction = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

async function callGrok(
  apiKey: string,
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  tools: XaiFunction[]
): Promise<ChatMessage> {
  const body: Record<string, unknown> = { model, messages };
  if (tools.length > 0) body.tools = tools;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`xAI API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { choices: { message: ChatMessage }[] };
  return data.choices[0].message;
}

async function main() {
  const apiKey = process.env.XAI_API_KEY;
  const model = process.env.XAI_MODEL || "grok-4.1-fast-non-reasoning";
  const baseUrl = process.env.XAI_BASE_URL || "https://api.x.ai/v1";

  if (!apiKey) {
    console.error(
      "Missing XAI_API_KEY env var. Get a free key from console.x.ai and:\n" +
        "  export XAI_API_KEY=xai-..."
    );
    process.exit(1);
  }

  const serverPath = new URL("./server.js", import.meta.url).pathname;

  const client = new Client({
    name: "notes-client",
    version: "1.0.0",
  });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
  });

  await client.connect(transport);
  console.error(`Connected to MCP server: ${serverPath}`);

  const toolsResult = await client.listTools();
  const tools: XaiFunction[] = toolsResult.tools.map((t) => {
    const parsed = z.record(z.unknown()).safeParse(t.inputSchema);
    return {
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description || t.name,
        parameters: parsed.success ? parsed.data : {},
      },
    };
  });
  console.error(`Discovered ${tools.length} tools: ${tools.map((t) => t.function.name).join(", ")}`);

  const prompt = process.argv[2] || "List my notes";
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a helpful assistant with access to a notes MCP server. Use the provided tools to manage notes when relevant, then answer the user.",
    },
    { role: "user", content: prompt },
  ];

  const maxIterations = 10;
  for (let i = 0; i < maxIterations; i++) {
    const msg = await callGrok(apiKey, baseUrl, model, messages, tools);
    messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      console.log(msg.content ?? "(no response)");
      break;
    }

    for (const call of msg.tool_calls) {
      const name = call.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      console.error(`  → calling tool: ${name}(${JSON.stringify(args)})`);
      const result = await client.callTool({ name, arguments: args });
      const content = result.content;
      const text = Array.isArray(content)
        ? content
            .map((c: { type?: string; text?: string }) =>
              c.type === "text" && c.text ? c.text : ""
            )
            .filter(Boolean)
            .join("\n")
        : JSON.stringify(content);
      const finalText = text || "(empty)";
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: finalText,
      });
    }
  }

  await client.close();
}

main().catch((err) => {
  console.error("Client error:", err);
  process.exit(1);
});
