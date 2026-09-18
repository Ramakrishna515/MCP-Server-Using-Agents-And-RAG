import * as fs from "fs/promises";
import * as path from "path";
import { ChatMessage, FunctionTool, callLLM } from "./providers.js";
import { buildIndex, searchIndex, logStep } from "./rag.js";

const DATA_DIR = path.join(process.cwd(), "data");
const NOTES_FILE = path.join(DATA_DIR, "notes.json");

type Note = {
  id: number;
  title: string;
  content: string;
  createdAt: string;
};

// ─── TinyFish Search Tool ───────────────────────────────────────────────

async function tinyFishSearch(query: string, location = "US", language = "en"): Promise<string> {
  const apiKey = process.env.TINYFISH_API_KEY;
  if (!apiKey) return "> ❌ TINYFISH_API_KEY not set";

  const params = new URLSearchParams({
    query,
    location,
    language,
  });

  const res = await fetch(`https://api.search.tinyfish.ai?${params}`, {
    method: "GET",
    headers: {
      "X-API-Key": apiKey,
      "X-TF-Request-Origin": "api",
      "X-TF-API-Source": "onboarding",
    },
  });

  if (!res.ok) {
    return `> ❌ Search API error: ${res.status}`;
  }

  const data = (await res.json()) as {
    query?: string;
    total_results?: number;
    results?: { position?: number; title?: string; snippet?: string; url?: string; site_name?: string }[];
  };

  const results = data.results || [];
  const lines: string[] = [];
  lines.push(`## Search results for "${query}"`);
  lines.push(`_${data.total_results ?? results.length} results_`);
  lines.push("");
  results.forEach((r) => {
    const title = (r.title || "Untitled").replace(/\s+/g, " ").trim();
    const snippet = (r.snippet || "").replace(/\s+/g, " ").trim();
    lines.push(`### ${title}`);
    if (snippet) lines.push(snippet);
    if (r.url) lines.push(`🔗 ${r.url}`);
    lines.push("");
  });
  if (results.length === 0) lines.push("No results found.");
  return lines.join("\n");
}

// ─── Notes Tools (MCP-style but inline) ─────────────────────────────────

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function loadNotes(): Promise<Note[]> {
  try {
    const raw = await fs.readFile(NOTES_FILE, "utf-8");
    return JSON.parse(raw) as Note[];
  } catch {
    return [];
  }
}

async function saveNotes(notes: Note[]) {
  await ensureDataDir();
  await fs.writeFile(NOTES_FILE, JSON.stringify(notes, null, 2), "utf-8");
}

async function addNote(title: string, content: string): Promise<string> {
  const notes = await loadNotes();
  const note: Note = {
    id: Date.now(),
    title,
    content,
    createdAt: new Date().toISOString(),
  };
  notes.push(note);
  await saveNotes(notes);
  return `Note added (id: ${note.id}): ${title}`;
}

async function listNotes(): Promise<string> {
  const notes = await loadNotes();
  if (notes.length === 0) return "No notes found.";
  return notes.map((n) => `[${n.id}] ${n.title}\n  ${n.content}`).join("\n");
}

async function getNote(id: number): Promise<string> {
  const notes = await loadNotes();
  const note = notes.find((n) => n.id === id);
  if (!note) return `Note ${id} not found`;
  return `[${note.id}] ${note.title}\n${note.content}\n(created ${note.createdAt})`;
}

async function deleteNote(id: number): Promise<string> {
  let notes = await loadNotes();
  const before = notes.length;
  notes = notes.filter((n) => n.id !== id);
  if (notes.length === before) return `Note ${id} not found`;
  await saveNotes(notes);
  return `Deleted note ${id}`;
}

// ─── RAG Tools ──────────────────────────────────────────────────────────

async function indexNotes(): Promise<string> {
  const { count, model } = await buildIndex();
  return `Indexed ${count} chunk(s) into the vector store (model: ${model}). Ready for ask_rag.`;
}

async function askRag(
  query: string,
  k = 5,
  provider = "gemini",
  model?: string
): Promise<string> {
  const hits = await searchIndex(query, k);
  if (hits.length === 0) {
    return "> ⚠️ No indexed notes found. Run index_notes first (or add some notes).";
  }

  const context = hits.map((h) => h.text).join("\n\n---\n\n");

  // ── Step 6: Augment ──
  logStep(6, "Augment", `built context from ${hits.length} hit(s) (${context.length} chars)`);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a RAG assistant. Answer the user's question using ONLY the context below. " +
        "If the context does not contain the answer, say so clearly. Cite the note id in [brackets].\n\n" +
        "=== CONTEXT ===\n" +
        context,
    },
    { role: "user", content: query },
  ];

  // ── Step 7: Generate ──
  const t0 = performance.now();
  logStep(7, "Generate", `calling ${provider}/${model ?? "default"} with ${messages.length} message(s)…`);
  const result = await callLLM(provider, model, messages, []);
  logStep(7, "Generate", `answer received (${result.content.length} chars) in ${(performance.now() - t0).toFixed(0)}ms`);

  const sources = hits.map((h) => `- [${h.id}] ${h.title} (score ${h.score.toFixed(3)})`);
  return `# Answer\n\n${result.content || "(no response)"}\n\n**Sources:**\n${sources.join("\n")}`;
}

// ─── Tool Definitions & Registry ────────────────────────────────────────

export type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
};

export const ALL_TOOLS: ToolDef[] = [
  {
    name: "search_web",
    description: "Search the web using TinyFish AI search API. Returns search results for a given query.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        location: { type: "string", description: "Country code (default: US)" },
        language: { type: "string", description: "Language code (default: en)" },
      },
      required: ["query"],
    },
    execute: (args) => tinyFishSearch(args.query as string, args.location as string, args.language as string),
  },
  {
    name: "add_note",
    description: "Create a new note with a title and content",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of the note" },
        content: { type: "string", description: "Body content of the note" },
      },
      required: ["title", "content"],
    },
    execute: (args) => addNote(args.title as string, args.content as string),
  },
  {
    name: "list_notes",
    description: "List all saved notes",
    parameters: { type: "object", properties: {} },
    execute: () => listNotes(),
  },
  {
    name: "get_note",
    description: "Get a single note by its id",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "Note id" },
      },
      required: ["id"],
    },
    execute: (args) => getNote(args.id as number),
  },
  {
    name: "delete_note",
    description: "Delete a note by its id",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "Note id to delete" },
      },
      required: ["id"],
    },
    execute: (args) => deleteNote(args.id as number),
  },
  {
    name: "get_datetime",
    description: "Get the current date and time",
    parameters: { type: "object", properties: {} },
    execute: async () => new Date().toISOString(),
  },
  {
    name: "index_notes",
    description:
      "Build or rebuild the vector index from saved notes using embeddings. Run this after adding or editing notes so RAG can find them.",
    parameters: { type: "object", properties: {} },
    execute: () => indexNotes(),
  },
  {
    name: "ask_rag",
    description:
      "Ask a question about your saved notes using retrieval-augmented generation. Retrieves the most relevant notes with embeddings and answers with the LLM using that context.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The question to ask about your notes" },
        k: { type: "number", description: "How many notes to retrieve (default: 5)" },
        provider: { type: "string", description: "LLM provider for the answer (default: gemini)" },
        model: { type: "string", description: "Optional model id to use" },
      },
      required: ["query"],
    },
    execute: (args) =>
      askRag(args.query as string, args.k as number, args.provider as string, args.model as string),
  },
];

export function getToolByName(name: string): ToolDef | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

export function getToolsForAgent(toolNames: string[]): FunctionTool[] {
  return ALL_TOOLS
    .filter((t) => toolNames.includes(t.name))
    .map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
}

export async function executeToolCall(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = getToolByName(name);
  if (!tool) return `Unknown tool: ${name}`;
  try {
    return await tool.execute(args);
  } catch (err) {
    return `Tool error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
