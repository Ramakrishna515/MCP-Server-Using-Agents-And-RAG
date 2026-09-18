import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const NOTES_FILE = path.join(DATA_DIR, "notes.json");

type Note = {
  id: number;
  title: string;
  content: string;
  createdAt: string;
};

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

const server = new McpServer({
  name: "notes-server",
  version: "1.0.0",
});

server.tool(
  "add_note",
  "Add a new note with a title and content",
  {
    title: z.string().describe("Title of the note"),
    content: z.string().describe("Body of the note"),
  },
  async ({ title, content }) => {
    const notes = await loadNotes();
    const note: Note = {
      id: Date.now(),
      title,
      content,
      createdAt: new Date().toISOString(),
    };
    notes.push(note);
    await saveNotes(notes);
    return {
      content: [
        {
          type: "text" as const,
          text: `Note added (id: ${note.id}): ${title}`,
        },
      ],
    };
  }
);

server.tool(
  "list_notes",
  "List all notes",
  {},
  async () => {
    const notes = await loadNotes();
    const text =
      notes.length === 0
        ? "No notes found."
        : notes
            .map((n) => `[${n.id}] ${n.title}\n  ${n.content}`)
            .join("\n");
    return { content: [{ type: "text" as const, text }] };
  }
);

server.tool(
  "get_note",
  "Get a single note by its id",
  { id: z.number().describe("Note id") },
  async ({ id }) => {
    const notes = await loadNotes();
    const note = notes.find((n) => n.id === id);
    if (!note) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Note ${id} not found` }],
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: `[${note.id}] ${note.title}\n${note.content}\n(created ${note.createdAt})`,
        },
      ],
    };
  }
);

server.tool(
  "delete_note",
  "Delete a note by its id",
  { id: z.number().describe("Note id to delete") },
  async ({ id }) => {
    let notes = await loadNotes();
    const before = notes.length;
    notes = notes.filter((n) => n.id !== id);
    if (notes.length === before) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Note ${id} not found` }],
      };
    }
    await saveNotes(notes);
    return {
      content: [{ type: "text" as const, text: `Deleted note ${id}` }],
    };
  }
);

server.resource("notes", "notes://all", async (uri) => {
  const notes = await loadNotes();
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(notes, null, 2),
      },
    ],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Notes MCP Server running on stdio");
