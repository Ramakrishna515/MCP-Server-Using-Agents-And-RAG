import express from "express";
import * as path from "path";
import { fileURLToPath } from "url";
import { PROVIDERS } from "./providers.js";
import { AGENTS, getAgentById } from "./agents.js";
import { ChatMessage, callLLM, streamLLM } from "./providers.js";
import { buildIndex, searchIndex, logStep } from "./rag.js";
import { runAgent } from "./gateway.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

const app = express();
app.use(express.json());

const hasRealKey = (envName: string): boolean => {
  const v = process.env[envName];
  return typeof v === "string" && !/(\.\.\.|your|example|sk-ant-\.\.\.)/i.test(v);
};

app.get("/api/meta", (_req, res) => {
  res.json({
    providers: Object.values(PROVIDERS).map((p) => ({
      name: p.name,
      displayName: p.displayName,
      hasKey: hasRealKey(p.apiKeyEnv),
      models: p.models,
    })),
    agents: AGENTS.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      tools: a.tools,
      defaultTool: a.defaultTool,

    })),
  });
});

type Session = {
  conversation: ChatMessage[];
};

const sessions = new Map<string, Session>();

app.post("/api/chat/session", (_req, res) => {
  const id = crypto.randomUUID();
  sessions.set(id, { conversation: [] });
  res.json({ sessionId: id });
});

app.post("/api/chat", (req, res) => {
  const { sessionId, agentId, provider, model, text, tools } = req.body as {
    sessionId?: string;
    agentId?: string;
    provider?: string;
    model?: string;
    text?: string;
    tools?: string[];
  };

  if (!text) {
    res.status(400).json({ error: "text is required" });
    return;
  }

  const resolvedAgentId = agentId || "test";
  const agent = getAgentById(resolvedAgentId);
  const resolvedProvider = provider || "grok";
  const resolvedSessionId = sessionId || crypto.randomUUID();

  if (!sessions.has(resolvedSessionId)) {
    sessions.set(resolvedSessionId, { conversation: [] });
  }

  const session = sessions.get(resolvedSessionId)!;
  session.conversation.push({ role: "user", content: text });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let fullText = "";

  runAgent({
    agent,
    provider: resolvedProvider,
    model,
    toolSelection: tools || agent.tools,
    conversation: session.conversation,
    userMessage: text,
    events: {
      status: (msg) => res.write(`data: ${JSON.stringify({ type: "status", message: msg })}\n\n`),
      delta: (t) => {
        fullText += t;
        res.write(`data: ${JSON.stringify({ type: "delta", text: t })}\n\n`);
      },
      toolCall: (name, args) =>
        res.write(`data: ${JSON.stringify({ type: "tool_call", name, args })}\n\n`),
      toolResult: (name, result) =>
        res.write(`data: ${JSON.stringify({ type: "tool_result", name, result })}\n\n`),
      done: (finalMessage) => {
        session.conversation.push({ role: "assistant", content: fullText });
        res.write(
          `data: ${JSON.stringify({ type: "done", text: fullText, sessionId: resolvedSessionId })}\n\n`
        );
        res.end();
      },
      error: (err) => {
        res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
        res.end();
      },
    },
  });
});

app.get("/api/chat/session/:id", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({ conversation: session.conversation });
});

app.post("/api/rag/index", async (_req, res) => {
  try {
    const { count, model } = await buildIndex();
    res.json({ ok: true, indexed: count, model });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/rag", async (req, res) => {
  const { query, k, provider, model } = req.body as {
    query?: string;
    k?: number;
    provider?: string;
    model?: string;
  };

  if (!query) {
    res.status(400).json({ error: "query is required" });
    return;
  }

  try {
    const hits = await searchIndex(query, k || 5);
    if (hits.length === 0) {
      res.json({ answer: "No indexed notes found. Run POST /api/rag/index first.", sources: [] });
      return;
    }

    const context = hits.map((h) => h.text).join("\n\n---\n\n");
    logStep(6, "Augment", `built context from ${hits.length} hit(s) (${context.length} chars)`);
    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          "You are a RAG assistant. Answer the user's question using ONLY the context below. " +
          "If the context does not contain the answer, say so clearly. Cite note ids in [brackets].\n\n" +
          "=== CONTEXT ===\n" +
          context,
      },
      { role: "user", content: query },
    ];

    const result = await callLLM(provider || "gemini", model, messages, []);
    logStep(7, "Generate", `answer received (${result.content.length} chars)`);
    res.json({
      answer: result.content,
      sources: hits.map((h) => ({ id: h.id, title: h.title, score: h.score, text: h.text })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function writeSse(res: express.Response, payload: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// RAG answer streamed character-by-character to the frontend bot (SSE)
app.post("/api/rag/HowTo", async (req, res) => {
  const { query, k, provider, model } = req.body as {
    query?: string;
    k?: number;
    provider?: string;
    model?: string;
  };

  if (!query) {
    res.status(400).json({ error: "query is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const resolvedProvider = provider || "gemini";

  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    writeSse(res, { type: "status", message: "🔎 Searching your notes…" });
    const hits = await searchIndex(query, k || 5);

    if (hits.length === 0) {
      writeSse(res, {
        type: "error",
        error: "No indexed notes found. Run POST /api/rag/index first.",
      });
      res.end();
      return;
    }

    writeSse(res, { type: "status", message: `📄 Retrieved ${hits.length} matching note(s)` });
    writeSse(res, { type: "status", message: `💬 ${resolvedProvider} is answering…` });

    const context = hits.map((h) => h.text).join("\n\n---\n\n");
    logStep(6, "Augment", `built context from ${hits.length} hit(s) (${context.length} chars)`);
    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          "You are a RAG assistant. Answer the user's question using ONLY the context below. " +
          "If the context does not contain the answer, say so clearly. Cite note ids in [brackets].\n\n" +
          "=== CONTEXT ===\n" +
          context,
      },
      { role: "user", content: query },
    ];

    logStep(7, "Generate", `streaming ${resolvedProvider} answer character-by-character…`);
    let firstChar = true;
    for await (const chunk of streamLLM(resolvedProvider, model, messages, abort.signal)) {
      for (const ch of chunk) {
        if (firstChar) {
          writeSse(res, { type: "status", message: "✨ Answer:" });
          firstChar = false;
        }
        writeSse(res, { type: "delta", text: ch });
        await sleep(10);
      }
    }

    writeSse(res, {
      type: "status",
      message: "✅ Sources: " + hits.map((h) => `[${h.id}] ${h.title}`).join(", "),
    });
    writeSse(res, { type: "done", text: "", sessionId: "" });
    res.end();
  } catch (err) {
    writeSse(res, { type: "error", error: err instanceof Error ? err.message : String(err) });
    res.end();
  }
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(PORT, () => {
  console.log(`Chat portal running at http://localhost:${PORT}`);
});