export type Agent = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  defaultTool: string;
};

export const AGENTS: Agent[] = [
  {
    id: "test",
    name: "Test Agent",
    description: "Research agent using TinyFish web search + notes tools",
    systemPrompt:
      "You are a helpful research assistant. Use search_web to look up up-to-date information on the web when the user asks questions about companies, people, products, or facts. Save important findings to notes when useful. If the user asks about saved notes, use the note tools.",
    tools: ["search_web", "add_note", "list_notes", "get_note", "delete_note", "get_datetime"],
    defaultTool: "search_web",
  },
  {
    id: "notes",
    name: "Notes Agent",
    description: "Manages saved notes (CRUD)",
    systemPrompt:
      "You are a notes manager. Use the note tools (list_notes, get_note, add_note, delete_note) to help the user manage their notes. Check list_notes first before referencing existing notes.",
    tools: ["add_note", "list_notes", "get_note", "delete_note", "get_datetime"],
    defaultTool: "list_notes",
  },
  {
    id: "general",
    name: "General Agent",
    description: "General chat without special tools",
    systemPrompt:
      "You are a helpful general assistant. Answer questions conversationally. You can get the current date/time if relevant.",
    tools: ["get_datetime"],
    defaultTool: "get_datetime",
  },
  {
    id: "research",
    name: "Research Agent",
    description: "Deep web research, saves findings to notes",
    systemPrompt:
      "You are a deep research agent. Use search_web to gather information on the web, then summarize findings and save them as a note using add_note so the user can review later. Be thorough and cite the source titles/URLs in your summary.",
    tools: ["search_web", "add_note", "list_notes", "get_note", "delete_note", "get_datetime"],
    defaultTool: "search_web",
  },
  {
    id: "rag",
    name: "RAG Agent",
    description: "Ask questions about your saved notes via retrieval + LLM",
    systemPrompt:
      "You answer questions about the user's saved notes using retrieval-augmented generation. Use ask_rag to retrieve relevant notes and answer with them. Use index_notes if the user adds or edits notes and the index is stale.",
    tools: ["ask_rag", "index_notes", "list_notes", "get_note", "get_datetime"],
    defaultTool: "ask_rag",
  },
];

export function getAgentById(id: string): Agent {
  const agent = AGENTS.find((a) => a.id === id);
  if (!agent) throw new Error(`Unknown agent: ${id}`);
  return agent;
}

export function getAllToolNames(): { name: string; description: string }[] {
  const seen = new Set<string>();
  const result: { name: string; description: string }[] = [];
  for (const agent of AGENTS) {
    for (const tool of agent.tools) {
      if (!seen.has(tool)) {
        seen.add(tool);
        result.push({
          name: tool,
          description: tool,
        });
      }
    }
  }
  return result;
}