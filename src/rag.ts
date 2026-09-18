import * as fs from "fs/promises";
import * as path from "path";
import { embedBatch, getEmbedding, EMBEDDING_MODEL } from "./embeddings.js";

const DATA_DIR = path.join(process.cwd(), "data");
const NOTES_FILE = path.join(DATA_DIR, "notes.json");
const INDEX_FILE = path.join(DATA_DIR, "index.json");

type Note = {
  id: number;
  title: string;
  content: string;
  createdAt: string;
};

export type IndexEntry = {
  id: string;
  title: string;
  text: string;
  vector: number[];
};

type Index = { model: string; entries: IndexEntry[] };

// ─── Monitoring: 7-step pipeline console logger ────────────────────────

export function logStep(step: number, name: string, detail: string) {
  if (process.env.RAG_LOG === "0") return;
  const c = (s: string) => `\x1b[36m${s}\x1b[0m`;
  const b = (s: string) => `\x1b[1m${s}\x1b[0m`;
  console.log(`${c("[RAG]")} ${step}/7 ${b(name.padEnd(9))} ${detail}`);
}

// ─── Step 1: Ingest ─────────────────────────────────────────────────────

async function loadNotes(): Promise<Note[]> {
  try {
    const raw = await fs.readFile(NOTES_FILE, "utf-8");
    return JSON.parse(raw) as Note[];
  } catch {
    return [];
  }
}

// ─── Step 2: Chunk ──────────────────────────────────────────────────────

export function chunkText(text: string, size = 800, overlap = 100): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= size) return clean ? [clean] : [];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = start + size;
    if (end < clean.length) {
      const sliceEnd = clean.lastIndexOf(" ", end);
      if (sliceEnd > start) end = sliceEnd;
    }
    chunks.push(clean.slice(start, end));
    start = end - overlap;
  }
  return chunks;
}

// ─── Step 3 + 4: Embed & Index ─────────────────────────────────────────

export async function buildIndex(): Promise<{ count: number; model: string }> {
  const t0 = performance.now();

  // ── Step 1: Ingest ──
  const notes = await loadNotes();
  logStep(1, "Ingest", `loaded ${notes.length} note(s) from ${NOTES_FILE}`);

  // ── Step 2: Chunk ──
  const items = notes
    .filter((n) => (n.title + n.content).trim().length > 0)
    .map((n) => ({
      id: String(n.id),
      title: n.title,
      text: `[${n.id}] ${n.title}\n${n.content}`,
    }));
  logStep(2, "Chunk", `${items.length} note(s) have content, chunking (size=800, overlap=100)`);

  const chunks: { id: string; title: string; text: string }[] = [];
  for (const item of items) {
    for (const text of chunkText(item.text)) {
      chunks.push({ id: item.id, title: item.title, text });
    }
  }
  logStep(2, "Chunk", `created ${chunks.length} chunk(s) from ${items.length} note(s)`);

  // ── Step 3: Embed ──
  const tEmbed = performance.now();
  logStep(3, "Embed", `embedding ${chunks.length} chunk(s) with ${EMBEDDING_MODEL}…`);
  const vectors = await embedBatch(chunks.map((c) => c.text));
  logStep(
    3,
    "Embed",
    `got ${vectors.length} vector(s) (dim ${vectors[0]?.length ?? 0}) in ${ms(tEmbed)}`
  );

  // ── Step 4: Index ──
  const entries: IndexEntry[] = chunks.map((c, i) => ({
    ...c,
    vector: vectors[i],
  }));

  const index: Index = { model: EMBEDDING_MODEL, entries };
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2), "utf-8");
  logStep(4, "Index", `saved ${entries.length} entr(ies) to ${INDEX_FILE} (model ${index.model}) in ${ms(t0)}`);
  return { count: entries.length, model: index.model };
}

function ms(t0: number): string {
  return `${(performance.now() - t0).toFixed(0)}ms`;
}

async function loadIndex(): Promise<Index> {
  try {
    const raw = await fs.readFile(INDEX_FILE, "utf-8");
    return JSON.parse(raw) as Index;
  } catch {
    return { model: EMBEDDING_MODEL, entries: [] };
  }
}

// ─── Similarity math ────────────────────────────────────────────────────

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ─── Step 5: Retrieve ───────────────────────────────────────────────────

export async function searchIndex(
  query: string,
  k = 5
): Promise<{ id: string; title: string; text: string; score: number }[]> {
  const t0 = performance.now();
  const index = await loadIndex();
  if (index.entries.length === 0) {
    logStep(5, "Retrieve", `index is empty, nothing to search`);
    return [];
  }

  // ── Step 5: Retrieve ──
  const qv = await getEmbedding(query);
  const ranked = index.entries
    .map((e) => ({ id: e.id, title: e.title, text: e.text, score: cosine(qv, e.vector) }))
    .sort((a, b) => b.score - a.score);

  const hits = ranked.slice(0, k);
  const top = hits[0];
  logStep(
    5,
    "Retrieve",
    `query="${query}" → scored ${index.entries.length} chunk(s), top-k=${k} in ${ms(t0)}` +
      (top ? ` | best: [${top.id}] ${top.title} (${top.score.toFixed(3)})` : "")
  );
  return hits;
}