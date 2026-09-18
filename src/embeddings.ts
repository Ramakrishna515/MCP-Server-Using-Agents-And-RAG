const GEMINI_EMBEDDING_URL =
  process.env.GEMINI_EMBEDDING_URL || "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";

export { GEMINI_EMBEDDING_MODEL as EMBEDDING_MODEL };

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing GEMINI_API_KEY env var for embeddings. Get a free key from Google AI Studio and set it in .env"
    );
  }

  const res = await fetch(
    `${GEMINI_EMBEDDING_URL}/models/${GEMINI_EMBEDDING_MODEL}:batchEmbedContents`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: texts.map((t) => ({
          model: `models/${GEMINI_EMBEDDING_MODEL}`,
          content: { parts: [{ text: t }] },
        })),
      }),
    }
  );

  if (!res.ok) {
    let detail = "";
    try {
      const json = (await res.json()) as { error?: { message?: string } };
      detail = json.error?.message || "";
    } catch {}
    throw new Error(`Gemini embeddings error ${res.status}: ${detail || (await res.text())}`);
  }

  const data = (await res.json()) as {
    embeddings?: { values?: (number | string)[] }[];
  };

  const embeddings = data.embeddings || [];
  if (embeddings.length !== texts.length) {
    throw new Error(
      `Gemini embeddings returned ${embeddings.length} vectors for ${texts.length} texts`
    );
  }

  return embeddings.map((e) => (e.values || []).map((v) => Number(v)));
}

export async function getEmbedding(text: string): Promise<number[]> {
  const [vector] = await embedBatch([text]);
  return vector;
}