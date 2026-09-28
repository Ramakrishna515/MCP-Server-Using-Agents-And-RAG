import { ChatMessage, streamLLM } from "./providers.js";
import { getToolsForAgent, executeToolCall } from "./tools.js";
import { Agent } from "./agents.js";

export type GatewayEvents = {
  status: (msg: string) => void;
  delta: (text: string) => void;
  toolCall: (name: string, args: string) => void;
  toolResult: (name: string, result: string) => void;
  done: (finalMessage: ChatMessage) => void;
  error: (err: Error) => void;
};

const SEARCH_NOISE =
  /^(please\s+|can you\s+|could you\s+|explain\s+about\s+|explain\s+|what\s+is\s+|what\s+are\s+|who\s+is\s+|tell\s+me\s+about\s+|tell\s+me\s+|search\s+(for\s+|about\s+)?|find\s+(information\s+)?(about\s+|on\s+)?|info\s+(about\s+)?|details\s+(about\s+)?|look\s+up\s+)/i;

function cleanSearchQuery(query: string): string {
  return query.replace(SEARCH_NOISE, "").replace(/["'?.]$/g, "").trim();
}

export function routeQueryToTool(
  agent: Agent,
  query: string
): { name: string; args: Record<string, unknown>; hint?: string } {
  const q = query.trim();
  const ql = q.toLowerCase();

  // --- Note tools (check first, most specific) ---
  if (agent.tools.includes("list_notes")) {
    // Extract any numeric ID from the query
    const idMatch = q.match(/#?(\d{8,})/);

    // DELETE note
    if (/\b(delete|remove|del|erase)\b/i.test(q)) {
      if (idMatch) return { name: "delete_note", args: { id: Number(idMatch[1]) } };
      return { name: "list_notes", args: {}, hint: "Pass the note id to delete (e.g. delete note 123)" };
    }

    // ADD note
    if (/\b(add|create|new|save|store|write)\b/i.test(q)) {
      // Normalize typo: "node" → "note"
      const normalized = q.replace(/\bnode\b/gi, "note");
      const title = normalized.replace(/.*(?:add|create|new|save|store|write)\s+(?:a\s+|the\s+|new\s+)?note\s*:?\s*/i, "").trim();
      const parts = title.split(/\bcontent\s*:?\s*/i);
      return {
        name: "add_note",
        args: {
          title: parts[0].trim() || title || "Untitled",
          content: parts[1] || "",
        },
      };
    }

    // GET note (by ID)
    if (idMatch && /\b(get|show|open|read|fetch|details|detail|more|info)\b/i.test(q)) {
      return { name: "get_note", args: { id: Number(idMatch[1]) } };
    }

    // GET note (by ID, even without verb if ID is prominent)
    if (idMatch && /\b(note|node)\b/i.test(q)) {
      return { name: "get_note", args: { id: Number(idMatch[1]) } };
    }

    // LIST notes
    if (/\b(list|show|all|get|read|see|display|view)\b/i.test(q) && /\b(note|node|notes|nodes)\b/i.test(q)) {
      return { name: "list_notes", args: {} };
    }
    if (/^notes?$/i.test(ql) || /^all\s+notes?$/i.test(ql) || /^get\s+(all\s+)?notes?$/i.test(ql)) {
      return { name: "list_notes", args: {} };
    }
  }

  // --- RAG (ask about notes content) ---
  if (agent.tools.includes("ask_rag") && agent.tools.includes("index_notes")) {
    if (/\b(re-?index|index notes|rebuild index)\b/i.test(q)) {
      return { name: "index_notes", args: {} };
    }
    const ragIntent =
      /\b(rag|search|find|look up|remember|recall|summar(y|ize)|what did|tell me about)\b/i.test(q) &&
      /\b(note|notes|content|wrote|written|saved|stored)\b/i.test(q);
    if (ragIntent) return { name: "ask_rag", args: { query: q } };
  }

  // --- Search ---
  if (agent.tools.includes("search_web")) {
    return { name: "search_web", args: { query: cleanSearchQuery(q) || q } };
  }

  if (agent.defaultTool === "ask_rag") return { name: "ask_rag", args: { query: q } };

  return { name: agent.defaultTool, args: agent.defaultTool === "search_web" ? { query: q } : {} };
}

export function formatToolMarkdown(name: string, raw: string): string {
  if (name === "search_web" || name === "ask_rag") return raw;

  if (/Indexed \d+ chunk/.test(raw)) {
    return `> ${raw}`;
  }

  if (name === "list_notes" && !/(No notes found)/.test(raw)) {
    const blocks = raw.split(/\n(?=\[\d+\])/).filter(Boolean);
    const items = blocks.map((b) => {
      const m = b.match(/^\s*\[(\d+)\]\s+(.+?)(?:\n\s{2,}([\s\S]*))?$/);
      if (!m) return `- ${b.trim()}`;
      const content = (m[3] || "").trim();
      return `- **${m[2].trim()}** \`(${m[1]})\`${content ? ` — ${content}` : ""}`;
    });
    return `## Notes\n\n${items.join("\n")}`;
  }

  if (name === "get_note") {
    const m = raw.match(/^\[\d+\]\s+(.+)\n([\s\S]*)$/);
    if (m) {
      return `### ${m[1].trim()}\n\n${m[2].trim().replace(/^\(created (.+)\)$/m, `_created $1_`)}`;
    }
  }

  if (/Note added|Deleted note/.test(raw)) {
    return `> ${raw}`;
  }

  return `\`\`\`\n${raw}\n\`\`\``;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function emitMarkdown(events: GatewayEvents, markdown: string) {
  const CHUNK = 120;
  for (let i = 0; i < markdown.length; i += CHUNK) {
    events.delta(markdown.slice(i, i + CHUNK));
    if (i + CHUNK < markdown.length) await sleep(30);
  }
}

function extractSourceLinks(raw: string): string[] {
  const links: string[] = [];
  for (const m of raw.matchAll(/^🔗 (.+)$/gm)) links.push(m[1]);
  return links;
}

// Feed the tool output to the LLM and stream a human-readable Markdown answer.
async function streamSynthesizedAnswer(
  events: GatewayEvents,
  provider: string,
  model: string | undefined,
  query: string,
  toolName: string,
  toolResult: string
): Promise<string> {
  const system =
    toolName === "search_web"
      ? "You are a research assistant. The web search results for the user's question are below. " +
        "Analyze them and answer the user's original question in clear, human-readable Markdown. " +
        "Start with a short direct answer, then key points, and end with a Sources list using ONLY the URLs given below. " +
        "If the results do not actually answer the question, say so plainly. Do not invent facts or links.\n\n" +
        "=== SEARCH RESULTS ===\n" +
        toolResult
      : "You are a helpful assistant. The user asked a question which a tool handled below. " +
        "Rewrite the tool output into a concise, human-readable Markdown answer for the user's original request. " +
        "Do not add facts that are not present in the tool output. Use headings and lists where helpful.\n\n" +
        "=== TOOL OUTPUT ===\n" +
        toolResult;

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: query },
  ];

  let full = "";
  for await (const chunk of streamLLM(provider, model, messages)) {
    for (const ch of chunk) {
      full += ch;
      events.delta(ch);
      await sleep(10);
    }
  }
  return full;
}

export async function runAgent({
  agent,
  provider,
  model,
  toolSelection,
  conversation,
  userMessage,
  events,
}: {
  agent: Agent;
  provider: string;
  model?: string;
  toolSelection: string[];
  conversation: ChatMessage[];
  userMessage: string;
  events: GatewayEvents;
}): Promise<void> {
  // Auto-route: every provider uses the same smart routing
  try {
    const route = routeQueryToTool(agent, userMessage);
    const toolName = route.name;
    const args = route.args;

    events.status(`Routing to \`${toolName}\`…`);
    if (route.hint) events.status(route.hint);
    events.toolCall(toolName, JSON.stringify(args));
    const result = await executeToolCall(toolName, args);
    events.toolResult(toolName, result.slice(0, 500));

    // Always analyze the tool output with the LLM and stream a
    // human-readable Markdown answer, like the RAG endpoint does.
    try {
      events.status("✨ Writing the answer…");
      const answer = await streamSynthesizedAnswer(
        events,
        provider,
        model,
        userMessage,
        toolName,
        result
      );
      const links = extractSourceLinks(result);
      const sources =
        links.length > 0 && !/sources?/i.test(answer)
          ? `\n\n**Sources:**\n${links.map((u) => `- ${u}`).join("\n")}`
          : "";
      const md = answer + sources;
      events.done({ role: "assistant", content: md });
      return;
    } catch (err) {
      events.status("⚠️ Synthesizer failed, showing raw results instead.");
    }

    const md = formatToolMarkdown(toolName, result);
    await emitMarkdown(events, md);
    events.done({ role: "assistant", content: md });
  } catch (err) {
    events.error(err instanceof Error ? err : new Error(String(err)));
  }
}