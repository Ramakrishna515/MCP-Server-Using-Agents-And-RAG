# Retrieval-Augmented Generation (RAG) — Complete Guide with Examples

A hands-on guide to the RAG system already built into this project. Each section
explains **what**, **why**, **how**, and shows a **concrete example** with expected
output so you can cross-check as you learn.

---

## Table of Contents

- [What is RAG?](#what-is-rag)
- [Why RAG? The Problem It Solves](#why-rag-the-problem-it-solves)
- [The 7-Step RAG Pipeline](#the-7-step-rag-pipeline)
- [The Vector Store Explained](#the-vector-store-explained)
- [File-by-File Tour of the Code](#file-by-file-tour-of-the-code)
- [Worked Example: End to End](#worked-example-end-to-end)
- [Run It Yourself](#run-it-yourself)
- [Troubleshooting](#troubleshooting)
- [Next Steps & Upgrades](#next-steps--upgrades)

---

## What is RAG?

**RAG = Retrieval-Augmented Generation.** It means:

1. You have a collection of documents (your **knowledge base**).
2. When someone asks a question, you **retrieve** the most relevant pieces.
3. You stuff those pieces into the prompt as **context**.
4. The LLM **generates** an answer based on that context.

The LLM never saw your documents during training — RAG gives it "just-in-time memory."

```
        ┌──────────────┐
        │ Your notes   │  (data/notes.json)
        └──────┬───────┘
               │ 1. chunk + embed  (buildIndex)
               ▼
        ┌──────────────┐
        │ Vector store │  (data/index.json)
        └──────┬───────┘
               │ 2. search top-k   (searchIndex)
               ▼
        ┌──────────────┐
        │  User query  │
        └──────┬───────┘
               │ 3. context = found chunks
               ▼
        ┌──────────────┐
        │ LLM (Gemini) │  4. answer using context
        └──────┬───────┘
               ▼
             Answer + sources
```

---

## Why RAG? The Problem It Solves

### The problem: LLMs don't know your data

A model like Gemini or Grok was trained on public internet data. It has **no idea** about:
- Your private notes ("Team standup at 10am")
- Your company documents
- Recent files that didn't exist at training time

### The naive (bad) fix: dump everything into the prompt

```
Prompt: "Here are 50,000 notes. Answer: When is the standup?"
```

**Fails because:**
- Context windows are limited (you can't fit everything)
- More text = worse attention = worse answers
- Costs money for every token

### The RAG fix: retrieve a little, generate well

```
Prompt: "Here are the 3 most relevant notes. Answer: When is the standup?"
```

**Succeeds because:**
- Only the useful bits are in the prompt
- The answer is grounded in your actual data (fewer hallucinations)
- Sources can be cited back to the user

---

## The 7-Step RAG Pipeline

| # | Step | What it does | Where in this project |
|---|------|--------------|-----------------------|
| 1 | **Ingest** | Load documents into memory | `rag.ts` → `loadNotes()` |
| 2 | **Chunk** | Split long text into pieces | `rag.ts` → `chunkText()` |
| 3 | **Embed** | Turn each chunk into a vector | `embeddings.ts` → `embedBatch()` |
| 4 | **Index** | Save vectors for later retrieval | `rag.ts` → `buildIndex()` → `data/index.json` |
| 5 | **Retrieve** | Find top-k chunks similar to the query | `rag.ts` → `searchIndex()` + `cosine()` |
| 6 | **Augment** | Paste chunks into the system prompt | `tools.ts` → `askRag()` |
| 7 | **Generate** | LLM answers using that context | `tools.ts` → `callLLM()` |

> Steps **1–4 run once** (indexing). Steps **5–7 run on every question**.

**Example flow with real text:**

```
Your notes:
  [1] Meeting   — "Team standup at 10am every day"
  [2] RAG Design— "Chunk notes, embed with OpenAI, rank with cosine similarity"
  [3] Shopping  — "Milk, eggs, bread"

User asks: "What time is the standup?"

Step 3 (embed):
  "Team standup at 10am every day"  →  [0.12, -0.55, 0.87, ...]   (vector)
  "Milk, eggs, bread"               →  [-0.41, 0.02, 0.33, ...]   (vector)
  "What time is the standup?"       →  [0.11, -0.50, 0.90, ...]   (query vector)

Step 5 (compare, top-k = 2):
  note 1  score 0.91  ← most similar to the question
  note 3  score 0.44

Step 6 (augmented prompt):
  system: "Answer using ONLY this context: [1] Meeting — Team standup at 10am every day"
  user:   "What time is the standup?"

Step 7 (answer):
  "The daily standup is at 10am. (from note 1)"
```

---

## The Vector Store Explained

A vector store is **not** a special database. It's three ingredients:

### 1. Embeddings — text becomes numbers

An **embedding model** (we use Google's `gemini-embedding-001`, 768 dimensions)
converts text into a list of numbers. The trick: **similar meaning → similar numbers.**

```
"I love pizza"      →  [0.31, -0.12,  0.98, ...]
"I love pasta"      →  [0.30, -0.11,  0.95, ...]   <- close (same meaning)
"The stock market"  →  [-0.77, 0.42,  0.10, ...]   <- far away (different meaning)
```

Here is a real example: these two statements score high similarity, while unrelated
text scores near zero or negative, which is exactly what retrieval relies on.

### 2. Cosine similarity — the math that compares

To find "which stored text is closest to the question?", compute **cosine similarity**
between the query vector and every stored vector.

```
similarity(A, B) = (A · B) / (|A| × |B|)
                  result: -1 to 1, higher = more similar
```

**Worked example with 2-dimension vectors:**

```
A = [2, 3]        B = [4, 0]

A · B  = (2×4) + (3×0) = 8
|A|    = √(2² + 3²)    = √13   ≈ 3.606
|B|    = √(4² + 0²)    = √16   = 4

cosine = 8 / (3.606 × 4) = 8 / 14.42 ≈ 0.555
```

**Intuition:** imagine each text as an **arrow pointing from the origin**. Cosine
similarity measures the **angle** between the arrows — same direction = similar,
perpendicular = unrelated, opposite = meaning opposite.

The implementation (`rag.ts`):

```typescript
export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
```

### 3. The index file — where vectors live

The "store" is just a JSON file, `data/index.json`:

```json
{
  "model": "gemini-embedding-001",
  "entries": [
    {
      "id": "1",
      "title": "Meeting",
      "text": "[1] Meeting\nTeam standup at 10am every day",
      "vector": [0.12, -0.55, 0.87]
    }
  ]
}
```

Search = embed the question, loop through all entries, sort by similarity, take top-k.

---

## File-by-File Tour of the Code

### `src/embeddings.ts` — Step 3 (embed)

```typescript
const GEMINI_EMBEDDING_URL =
  process.env.GEMINI_EMBEDDING_URL || "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";

// batch-embeds many texts in ONE request (faster + cheaper)
export async function embedBatch(texts: string[]): Promise<number[][]> {
  // POST /models/gemini-embedding-001:batchEmbedContents
  // returns: [[0.31, -0.12, ...], [0.30, -0.11, ...]]
}

// convenience wrapper for single queries
export async function getEmbedding(text: string): Promise<number[]> {
  const [vector] = await embedBatch([text]);
  return vector;
}
```

- Requires `GEMINI_API_KEY` in `.env` (same key as the answer model).
- Sends many texts per request → returns one vector per text.
- `getEmbedding` is used for single queries (e.g. embedding the user's question).

### `src/rag.ts` — Steps 1, 2, 4, 5 (ingest, chunk, index, retrieve)

| Function | RAG step | Purpose |
|----------|----------|---------|
| `loadNotes()` | 1 Ingest | Reads `data/notes.json` |
| `chunkText(text, 800, 100)` | 2 Chunk | Splits long text; 800-char chunks, 100-char overlap |
| `buildIndex()` | 3+4 | Chunks all notes, embeds them, writes `data/index.json` |
| `cosine(a, b)` | 5 | Similarity math |
| `searchIndex(query, k)` | 5 | Embeds query, scores all chunks, returns top-k |

**Why overlap in chunking?** When a sentence is split across a boundary, the overlap
keeps each half searchable, so you don't lose context:

```
text:   "The meeting is at 10am. The deadline is Friday. Bring your laptop."
chunk1: "The meeting is at 10am. The deadline is F"
chunk2: "e deadline is Friday. Bring your laptop."   <- overlap = "e deadline is"
```

### `src/tools.ts` — Steps 6, 7 + the tool definitions

`askRag()` builds the **augmented prompt**, then calls the LLM:

```typescript
async function askRag(query: string, k = 5, provider = "gemini", model?: string) {
  const hits = await searchIndex(query, k);                  // Step 5: retrieve
  const context = hits.map((h) => h.text).join("\n\n---\n\n");
  const messages = [
    {
      role: "system",
      content:
        "Answer using ONLY the context below. Cite the note id in [brackets].\n\n" +
        "=== CONTEXT ===\n" + context,                        // Step 6: augment
    },
    { role: "user", content: query },
  ];
  const result = await callLLM(provider, model, messages, []); // Step 7: generate
  return `# Answer\n\n${result.content}\n\n**Sources:**\n...`;
}
```

The two new tools registered in `ALL_TOOLS`:

| Tool | Params | Does |
|------|--------|------|
| `index_notes` | (none) | Rebuild the vector store from notes. Run after adding/editing notes. |
| `ask_rag` | `query`, `k?`, `provider?`, `model?` | Retrieve top-k + answer with LLM |

### `src/agents.ts` — the RAG Agent

```typescript
{
  id: "rag",
  name: "RAG Agent",
  tools: ["ask_rag", "index_notes", "list_notes", "get_note", "get_datetime"],
  defaultTool: "ask_rag",
}
```

### `src/gateway.ts` — routing

- Phrases like *"search/find/remember/tell me about … notes"* → routed to `ask_rag`.
- *"reindex notes"* → routed to `index_notes`.

### `src/http.ts` — browser endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/rag/index` | Builds the vector index. Returns `{ ok, indexed, model }` |
| `POST /api/rag` | `{ query, k? }` → `{ answer, sources[] }` (non-streaming) |
| `POST /api/rag/HowTo` | `{ query, k?, provider?, model? }` → SSE answer streamed **one character per event**, used by the frontend bot for a typing effect |

### `src/providers.ts` — the Gemini provider (generation)

The RAG answer model defaults to **Gemini** (free key from Google AI Studio). The
Gemini path (`callGemini`) posts to
`https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
and parses the reply down to **only the text answer** — thinking traces
(`thought` parts) and the big `thoughtSignature` / `usageMetadata` blobs in the
raw response are dropped:

```typescript
const parts = data.candidates?.[0]?.content?.parts ?? [];
const text = parts
  .filter((p) => p.text && !p.thought)   // text-only, no thinking traces
  .map((p) => p.text!)
  .join("\n");

return { role: "assistant", content: text };
```

Config: `GEMINI_API_KEY` in `.env` (default model `gemini-3.6-flash`, others
like `gemini-2.5-flash` selectable). You can switch the answer model per request
with the `provider` arg of `ask_rag` / the `provider` field of `/api/rag`.

### Streaming the answer to the frontend bot

`/api/rag/stream` uses Gemini's `:streamGenerateContent` (SSE) and re-emits each
token as **one character** per SSE event so the chat bubble appears to type:

```
data: {"type":"status","message":"🔎 Searching your notes…"}
data: {"type":"status","message":"📄 Retrieved 2 matching note(s)"}
data: {"type":"status","message":"💬 gemini is answering…"}
data: {"type":"delta","text":"E"}
data: {"type":"delta","text":"m"}
data: {"type":"delta","text":"p"}
… one delta per character …
data: {"type":"status","message":"✅ Sources: [1790000000001] HRMS - Leave Policy"}
data: {"type":"done","text":"","sessionId":""}
```

The frontend (`public/index.html`) detects the **RAG Agent** in the chat UI,
posts to `/api/rag/stream` instead of `/api/chat`, and appends the `delta`
characters to the same message bubble.

### Console monitoring — 7-step logs

Every RAG run prints a step-by-step trace to the **server console** so you can
watch each stage live (`RAG_LOG=0` turns it off):

```
===== INDEX PHASE (Steps 1-4) =====
[RAG] 1/7 Ingest   loaded 9 note(s) from data/notes.json
[RAG] 2/7 Chunk    created 9 chunk(s) from 9 note(s)
[RAG] 3/7 Embed    got 9 vector(s) (dim 3072) in 1603ms
[RAG] 4/7 Index    saved 9 entr(ies) to data/index.json (model gemini-embedding-001) in 1607ms

===== QUERY PHASE (Steps 5-7) =====
[RAG] 5/7 Retrieve query="What is the sick leave policy?" → scored 9 chunk(s), top-k=3 | best: [1790000000001] HRMS - Leave Policy (0.729)
[RAG] 6/7 Augment  built context from 3 hit(s) (1180 chars)
[RAG] 7/7 Generate calling gemini/default with 2 message(s)…
[RAG] 7/7 Generate answer received (279 chars) in 3987ms
```

Logs come from `logStep()` in `src/rag.ts` and appear automatically in
`buildIndex`, `searchIndex`, `askRag` (tools) and both `/api/rag` endpoints.

---

## Worked Example: End to End

### Setup

```bash
# 1. Put a REAL GEMINI_API_KEY in .env (Google AI Studio, free)
# 2. Start the web server
npm run web
```

### 1) Check the index is empty (first run)

```bash
curl -s -X POST http://localhost:3000/api/rag -H 'Content-Type: application/json' \
  -d '{"query":"When is the standup?"}'
```

**Expected output:**
```json
{ "answer": "No indexed notes found. Run POST /api/rag/index first.", "sources": [] }
```

### 2) Build the vector store

```bash
curl -s -X POST http://localhost:3000/api/rag/index
```

**Expected output:**
```json
{ "ok": true, "indexed": 3, "model": "gemini-embedding-001" }
```

> `indexed: 3` = your 3 populated notes became 3 indexed chunks. Empty notes are skipped.

### 3) Ask a question

```bash
curl -s -X POST http://localhost:3000/api/rag -H 'Content-Type: application/json' \
  -d '{"query":"What time is the morning standup?","k":2}'
```

**Expected output (answer text varies by model):**
```json
{
  "answer": "The daily standup is at 10am. [1]",
  "sources": [
    { "id": "1", "title": "Meeting", "score": 0.91, "text": "[1] Meeting\nTeam standup at 10am every day" },
    { "id": "2", "title": "RAG Design", "score": 0.44, "text": "[2] RAG Design\nChunk notes, embed with OpenAI, ..." }
  ]
}
```

### 4) Add a note, reindex, ask again

```bash
# add the note via the notes agent / chat
curl -s -X POST http://localhost:3000/api/rag/index   # reindex so RAG sees it
```

**Leaving the index stale is the #1 RAG bug** — the retrieve step can only find
what was embedded.

---

## Run It Yourself

Quick self-test of the math and pipeline (no API key needed for the pure functions):

```typescript
// node --input-type=module -e "..."
import { chunkText, cosine } from "./dist/rag.js";

console.log(cosine([1, 0, 0], [1, 0, 0]));  // 1     (identical)
console.log(cosine([1, 0, 0], [0, 1, 0]));  // 0     (unrelated)
console.log(cosine([1, 1], [2, 0]));
// A·B=2, |A|=√2, |B|=2  →  2/(√2 × 2) = 0.7071

console.log(chunkText("a".repeat(1700)).length);  // 3-4 chunks (800 size, 100 overlap)
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `No indexed notes found` | Index was never built, or notes are empty | Run `index_notes` / `POST /api/rag/index` |
| Answers don't mention a newly added note | Stale index | Rebuild the index after add/delete |
| `Missing GEMINI_API_KEY` | No key in `.env` | Add a real key, restart server |
| `Gemini embeddings error 401` | Bad/expired key, or browser-IP-restricted key | Create a new unrestricted key in Google AI Studio; set it in `.env` |
| Retrieval returns wrong notes | Few notes, or very different topics | Add more real content; adjust `k` |
| Chunks missing for long notes | Overlap cuts sentences | Increase `size`/`overlap` in `chunkText()` |

---

## Next Steps & Upgrades

Gradually replace parts as your data grows:

| Upgrade | What it gives you | How |
|---------|-------------------|-----|
| **Real vector DB** | Fast search with millions of vectors | sqlite-vec, pgvector, LanceDB, ChromaDB |
| **Hybrid search** | Keyword + vector = better recall | Combine `search_web`-style keyword scoring with cosine |
| **Re-ranking** | Better top-k ordering | A small cross-encoder / second model re-orders candidates |
| **More document types** | Index PDFs, MD, HTML | Add ingestors that read files, then hand text to `buildIndex()` |
| **Metadata filters** | "Only notes from this week" | Store date/category with each entry and filter before scoring |
| **Chunk by sentence/paragraph** | Cleaner chunks | Use NLP tokenizers instead of fixed char counts |

Each upgrade leaves Steps 6–7 (augment + generate) unchanged — that's the beauty of RAG:
swap the retriever, keep the prompt.