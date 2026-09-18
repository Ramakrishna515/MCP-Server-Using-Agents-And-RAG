# Build Your Own MCP Server — Step-by-Step Learning Guide

A hands-on guide to building a custom MCP (Model Context Protocol) server and
connecting it to a free model like Grok. Each step explains **what**, **why**,
the **packages used**, example code, and **expected output** so you can cross-check
your work as you learn.

---

## Table of Contents

- [How to Use This Guide](#how-to-use-this-guide)
- [Step 0: Know Your Tools (Prerequisites)](#step-0-know-your-tools-prerequisites)
- [Step 1: Understand MCP in 5 Minutes](#step-1-understand-mcp-in-5-minutes)
- [Step 2: Create the Project & Install Packages](#step-2-create-the-project--install-packages)
- [Step 3: Configure TypeScript (`tsconfig.json`)](#step-3-configure-typescript-tsconfigjson)
- [Step 4: Write a "Hello World" MCP Server](#step-4-write-a-hello-world-mcp-server)
- [Step 5: Build a Real Server (Notes App with Tools)](#step-5-build-a-real-server-notes-app-with-tools)
- [Step 6: Test the Server Without a Model](#step-6-test-the-server-without-a-model)
- [Step 7: Understand the Client & How It Talks to a Model](#step-7-understand-the-client--how-it-talks-to-a-model)
- [Step 8: Connect the Server to Grok (Free Model)](#step-8-connect-the-server-to-grok-free-model)
- [Step 9: Run Everything & Cross-Check](#step-9-run-everything--cross-check)
- [Troubleshooting](#troubleshooting)
- [Final File Reference](#final-file-reference)

---

## How to Use This Guide

1. Read each step **in order**.
2. Copy the example code into your `src/` folder.
3. Run the command shown under **Run it**.
4. Compare the **Expected output** with what you see.
5. If they match, move to the next step. If not, see **Troubleshooting**.

The final project lives in this folder. Your job is to **rebuild each file by hand**
and confirm the output at every step.

---

## Step 0: Know Your Tools (Prerequisites)

| Tool | Purpose | Check version |
|------|---------|---------------|
| **Node.js** | Runs JavaScript/TypeScript on your machine | `node --version` |
| **npm** | Installs packages | `npm --version` |
| **TypeScript** | Lets you write typed JavaScript | installed via npm |
| **MCP SDK** | Official library for building MCP servers/clients | installed via npm |

**Packages we use and why:**

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | The official SDK. Gives you `McpServer` (to build tools/resources) and `Client` (to talk to a server). |
| `zod` | Validates the inputs your tools accept. Turns schemas into the JSON format MCP needs. |
| `typescript` | Compiles `.ts` → plain `.js` the server can run. |
| `@types/node` | Type definitions so TypeScript knows about Node APIs like `fs`. |

**Run it:**
```bash
node --version
npm --version
```

**Expected output (yours may be newer):**
```
v25.9.0
11.12.1
```

If both print a version number, you're ready.

---

## Step 1: Understand MCP in 5 Minutes

MCP (**Model Context Protocol**) is a standard way for an AI app to give tools to
an AI model. It has three parts:

```
┌─────────────┐
│ AI Model    │  (e.g. Grok)
│  (claude)   │
└──────┬──────┘
       │ 3. model says which tool to call
       ▼
┌─────────────┐
│ MCP Client  │   (your app)
└──────┬──────┘
       │ 2. client asks server for tools, calls them
       ▼
┌─────────────┐
│ MCP Server  │   (your code — provides tools)
└──────┬──────┘
       │ 1. server talks to files, databases, APIs
       ▼
   real data
```

**Key ideas:**
- **Server** exposes **tools** (functions the model can call), **resources** (data),
  and **prompts** (templates).
- **Client** connects to the server over **stdio** (most common) or HTTP.
- The **model** decides which tool to call based on the user's request.
- Messages use **JSON-RPC 2.0** under the hood.

**Example tool (what a server advertises to the model):**
```json
{
  "name": "list_notes",
  "description": "List all notes",
  "inputSchema": { "type": "object", "properties": {} }
}
```

*You don't need to type this manually — the SDK builds it for you from your code.*

---

## Step 2: Create the Project & Install Packages

Create a folder and a `package.json`, then install the packages.

**Run it:**
```bash
mkdir -p src
npm init -y
npm install @modelcontextprotocol/sdk zod
npm install -D typescript @types/node
```

**What just happened:**
- `npm init -y` created a default `package.json`.
- `npm install @modelcontextprotocol/sdk zod` added the runtime libraries.
- `npm install -D typescript @types/node` added dev-only build tools.

**Expected output (summary at the end):**
```
added 97 packages, and audited 98 packages in 3s
found 0 vulnerabilities
```

Edit `package.json` so it has these scripts (we'll add more later):

```json
{
  "name": "build-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "npm run build && node dist/test.js",
    "client": "node dist/client.js"
  }
}
```

- `"type": "module"` → ES module syntax (`import`/`export`) works.
- `"build"` → compiles TypeScript to `dist/`.
- `"test"` → builds, then runs the no-model test.
- `"client"` → runs the client (which talks to Grok).

---

## Step 3: Configure TypeScript (`tsconfig.json`)

TypeScript needs a config file telling it how to compile.

**Create `tsconfig.json`:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

**What each setting means:**

| Setting | Purpose |
|---------|---------|
| `target: ES2022` | Compile to modern JavaScript (supports `await` at top level). |
| `module: NodeNext` | Uses Node's module system (works with `"type": "module"`). |
| `moduleResolution: NodeNext` | How Node finds imports — needed for `import ... from "..."`. |
| `outDir: ./dist` | Put compiled files here. |
| `rootDir: ./src` | Source files live in `src/`. |
| `strict: true` | Catch more type errors (good for learning). |
| `sourceMap: true` | Lets debuggers map `.js` back to `.ts`. |

**Run it (should do nothing / no errors yet):**
```bash
npm run build
```

**Expected output:**
```
> build-mcp-server@1.0.0 build
> tsc
```
(No errors = success. It's fine that it prints nothing after `tsc`.)

---

## Step 4: Write a "Hello World" MCP Server

This is the smallest server that works. It registers ONE tool and one resource.

**Create `src/hello.ts`:**
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Create the server (this is your app's "brain" for MCP)
const server = new McpServer({
  name: "hello-server",
  version: "1.0.0",
});

// Register a tool the model can call.
// The current SDK wants a Zod schema (not a raw JSON object) for inputs.
server.tool(
  "greet",                                  // tool name
  "Greet someone by name",                  // description (the model reads this)
  { name: z.string().describe("Name of the person") }, // input schema
  async ({ name }) => ({                    // what runs when called
    content: [{ type: "text", text: `Hello, ${name}! 👋` }],
  })
);

// Register a resource (data exposed to the app)
server.resource(
  "greeting",
  "greeting://hello",
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/plain", text: "Hi from the resource!" }],
  })
);

// Connect to stdio transport (host talks to us via stdin/stdout)
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Hello Server running on stdio");
```

**Why we use `console.error` and not `console.log`?** Because stdout is the MCP
communication channel. Any stray `console.log` would corrupt the protocol. Logs go
to stderr.

**Run it (build, then run):**
```bash
npm run build
node dist/hello.js
```

**Expected output:** The server just stays running and prints:
```
Hello Server running on stdio
```
It won't exit — it's waiting for a client to connect. Press `Ctrl+C` to stop.

*(You'll fully test it in Step 6 with a real client.)*

---

## Step 5: Build a Real Server (Notes App with Tools)

Now we build a server with **four tools** and a resource, backed by a JSON file.

**Create `src/server.ts`:**
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const NOTES_FILE = path.join(DATA_DIR, "notes.json");

type Note = { id: number; title: string; content: string; createdAt: string };

async function loadNotes(): Promise<Note[]> {
  try {
    return JSON.parse(await fs.readFile(NOTES_FILE, "utf-8"));
  } catch {
    return [];
  }
}

async function saveNotes(notes: Note[]) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(NOTES_FILE, JSON.stringify(notes, null, 2), "utf-8");
}

const server = new McpServer({ name: "notes-server", version: "1.0.0" });

// Tool 1: add a note
server.tool(
  "add_note",
  "Add a new note with a title and content",
  {
    title: z.string().describe("Title of the note"),
    content: z.string().describe("Body of the note"),
  },
  async ({ title, content }) => {
    const notes = await loadNotes();
    const note: Note = { id: Date.now(), title, content, createdAt: new Date().toISOString() };
    notes.push(note);
    await saveNotes(notes);
    return { content: [{ type: "text", text: `Note added (id: ${note.id}): ${title}` }] };
  }
);

// Tool 2: list all notes
server.tool("list_notes", "List all notes", {}, async () => {
  const notes = await loadNotes();
  const text =
    notes.length === 0
      ? "No notes found."
      : notes.map((n) => `[${n.id}] ${n.title}\n  ${n.content}`).join("\n");
  return { content: [{ type: "text", text }] };
});

// Tool 3: get one note
server.tool(
  "get_note",
  "Get a single note by its id",
  { id: z.number().describe("Note id") },
  async ({ id }) => {
    const note = (await loadNotes()).find((n) => n.id === id);
    if (!note) return { isError: true, content: [{ type: "text", text: `Note ${id} not found` }] };
    return { content: [{ type: "text", text: `[${note.id}] ${note.title}\n${note.content}` }] };
  }
);

// Tool 4: delete a note
server.tool(
  "delete_note",
  "Delete a note by its id",
  { id: z.number().describe("Note id to delete") },
  async ({ id }) => {
    let notes = await loadNotes();
    const before = notes.length;
    notes = notes.filter((n) => n.id !== id);
    if (notes.length === before)
      return { isError: true, content: [{ type: "text", text: `Note ${id} not found` }] };
    await saveNotes(notes);
    return { content: [{ type: "text", text: `Deleted note ${id}` }] };
  }
);

// Resource: expose all notes as JSON
server.resource("notes", "notes://all", async (uri) => ({
  contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await loadNotes()) }],
}));

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Notes MCP Server running on stdio");
```

**Why `zod`?** In Tool 1's schema, `z.string().describe(...)` tells the model the
type **and** a human-readable hint. The SDK converts zod schemas into the JSON schema
the model understands — and validates input automatically.

**Key pattern to memorize — a tool has 4 parts:**
```
server.tool(
  "name",                // 1. name the model uses to call it
  "description",         // 2. what it does (model reads this to decide)
  { schema },            // 3. what inputs it needs
  async (args) => ({ content: [{ type: "text", text: "result" }] }) // 4. what it does
);
```

**Run it:**
```bash
npm run build
node dist/server.js
```

**Expected output:** stays running, prints:
```
Notes MCP Server running on stdio
```
Again, it waits for a client. Stop with `Ctrl+C`.

---

## Step 6: Test the Server Without a Model

You don't need Grok to verify your server works. A plain **MCP client** connects,
lists tools, and calls them.

**Create `src/test.ts`:**
```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = new URL("./server.js", import.meta.url).pathname;

const client = new Client({ name: "test-client", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
});

await client.connect(transport);
console.log("Connected. Listing tools...");

const { tools } = await client.listTools();
console.log("Tools:", tools.map((t) => `${t.name} (${t.description})`));

await client.callTool({ name: "add_note", arguments: { title: "Shopping", content: "Milk, eggs" } });
console.log("Added a note.");

const listed = await client.callTool({ name: "list_notes", arguments: {} });
console.log("list_notes ->", (listed.content as { text: string }[])[0].text);

await client.close();
console.log("Test passed.");
```

**What it does step by step:**
1. `Client` + `StdioClientTransport` spawn your server as a subprocess.
2. `listTools()` asks the server what it can do.
3. `callTool(...)` invokes `add_note`, then `list_notes`.

**Run it:**
```bash
npm run test
```

**Expected output:**
```
Notes MCP Server running on stdio
Connected. Listing tools...
Tools: [
  'add_note (Add a new note with a title and content)',
  'list_notes (List all notes)',
  'get_note (Get a single note by its id)',
  'delete_note (Delete a note by its id)'
]
Added a note.
list_notes -> [1788932338101] Shopping
  Milk, eggs
Test passed.
```

> The id number will differ (it's the timestamp). If you see all four tools and the
> note round-trips, **your server is correct.**

---

## Step 7: Understand the Client & How It Talks to a Model

A **client** alone just makes direct calls. To get an **AI model** (like Grok) to use
your tools, the client:

1. Connects to the MCP server and discovers its tools.
2. Converts MCP tools into the model's "function calling" format.
3. Sends the user's question + the tool list to the model.
4. When the model says "call tool X with these args", the client does so and sends
   the result back.
5. Loops until the model has a final answer.

```
You: "Add a note"
  │
  ▼
Client ──tools──► Grok (model)
  ▲                  │ "call add_note(title='Shopping', ...)"
  │                  ▼
  │            Client calls MCP server tool
  │                  │
  │◄── result ───────┘  "Note added (id: 123)"
  │
Grok: "Done! I added your note."
```

This loop is what lets the whole system feel "intelligent".

---

## Step 8: Connect the Server to Grok (Free Model)

Grok's API (xAI) is **OpenAI-compatible**, so the client just calls
`https://api.x.ai/v1/chat/completions` with your tools.

**Create `src/client.ts`:**
```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};
type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
type XaiFunction = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

async function callGrok(apiKey: string, baseUrl: string, model: string,
  messages: ChatMessage[], tools: XaiFunction[]): Promise<ChatMessage> {
  const body: Record<string, unknown> = { model, messages };
  if (tools.length > 0) body.tools = tools;
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`xAI API error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: ChatMessage }[] };
  return data.choices[0].message;
}

async function main() {
  const apiKey = process.env.XAI_API_KEY;
  const model = process.env.XAI_MODEL || "grok-4.1-fast-non-reasoning";
  const baseUrl = process.env.XAI_BASE_URL || "https://api.x.ai/v1";
  if (!apiKey) {
    console.error("Missing XAI_API_KEY env var. Get a free key from console.x.ai\n  export XAI_API_KEY=xai-...");
    process.exit(1);
  }

  const client = new Client({ name: "notes-client", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL("./server.js", import.meta.url).pathname],
  });
  await client.connect(transport);

  const { tools } = await client.listTools();
  const xaiTools: XaiFunction[] = tools.map((t) => {
    const parsed = z.record(z.unknown()).safeParse(t.inputSchema);
    return {
      type: "function",
      function: { name: t.name, description: t.description || t.name, parameters: parsed.success ? parsed.data : {} },
    };
  });
  console.error(`Discovered ${xaiTools.length} tools`);

  const prompt = process.argv[2] || "List my notes";
  const messages: ChatMessage[] = [
    { role: "system", content: "You are a helpful assistant with access to a notes MCP server. Use tools when relevant." },
    { role: "user", content: prompt },
  ];

  for (let i = 0; i < 10; i++) {
    const msg = await callGrok(apiKey, baseUrl, model, messages, xaiTools);
    messages.push(msg);
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      console.log(msg.content ?? "(no response)");
      break;
    }
    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments || "{}");
      console.error(`  → tool: ${call.function.name}(${JSON.stringify(args)})`);
      const result = await client.callTool({ name: call.function.name, arguments: args });
      const content = result.content;
      const text = Array.isArray(content)
        ? content.map((c: { text?: string }) => c.text ?? "").filter(Boolean).join("\n")
        : JSON.stringify(content);
      messages.push({ role: "tool", tool_call_id: call.id, content: text || "(empty)" });
    }
  }
  await client.close();
}
main().catch((e) => { console.error("Client error:", e); process.exit(1); });
```

**The tool-calling loop** (the heart of it):
- `callGrok(...)` returns a message.
- If it has `tool_calls`, execute each one and push the result in as a `tool` message.
- Repeat until a message has **no** `tool_calls` → that's the final answer.

---

## Step 9: Run Everything & Cross-Check

**1. Test the server (no model needed):**
```bash
npm run test
```
Expected: connects, lists 4 tools, adds and lists a note. (See Step 6.)

**2. Get a free Grok API key:**
- Go to `console.x.ai`, create an account, create an API key.
- New accounts get ~$25 in promotional credits.

**3. Run the client with Grok:**
```bash
export XAI_API_KEY=xai-...
npm run build
node dist/client.js "Add a note: Title 'Groceries', content 'milk, eggs, bread'"
```

**Expected output (you'll see the tool call, then Grok's answer):**
```
Discovered 4 tools
  → tool: add_note({"title":"Groceries","content":"milk, eggs, bread"})
Done! I added your note "Groceries".
```

**4. Cross-check the note was really saved:**
```bash
node dist/client.js "List my notes"
```
Expected: Grok calls `list_notes` and prints the note back.

**5. Try a wrong-id tool to see error handling:**
```bash
node dist/client.js "Get note 999999"
```
Expected: the server returns an error the model turns into a friendly response.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Cannot find module '.../mcp.js'` | Wrong import path | Imports must end in `.js` (NodeNext). |
| `Missing XAI_API_KEY` | No key set | `export XAI_API_KEY=xai-...` |
| `xAI API error 401` | Bad/expired key | Recheck key in console.x.ai |
| `xAI API error 429` | Out of credits / rate limit | Top up or wait |
| Server prints garbage in output | Used `console.log` in server | Use `console.error` only |
| `npm run build` type errors | A type mismatch | Read the error line number; ensure `as { text: string }[]` casts on results |
| `notes.json` shows old data | Old data file | `rm -rf data` |
| Model never calls a tool | Description not clear enough | Make tool descriptions explicit about when to use them |

---

## Final File Reference

```
buildMCPserver/
├── package.json          # deps + scripts
├── tsconfig.json         # TS compile settings
├── src/
│   ├── hello.ts          # (learn) minimal server
│   ├── server.ts         # notes server: 4 tools + resource
│   ├── client.ts         # connects server to Grok
│   └── test.ts           # no-model end-to-end test
└── dist/                 # compiled output (run this)
```

**The 4-part skill to remember:**
```
server.tool(name, description, schema, async (args) => result)
```

---

*You built a working MCP server from scratch and connected it to a real AI model.
Rebuild each file by hand, run the command, and match the output before moving on.*
