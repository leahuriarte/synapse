import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY;
const modelId = process.env.GEMINI_EMBED_MODEL || 'text-embedding-004';

let client, model;
export function geminiEmbedModel() {
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  if (!client) client = new GoogleGenerativeAI(apiKey);
  if (!model) model = client.getGenerativeModel({ model: modelId });
  return { modelId, model };
}

/** Embed an array of strings -> { vectors: float[][], dim, modelId } */
export async function embedBatch(texts) {
  if (!texts?.length) return { vectors: [], dim: 0, modelId };
  const { model } = geminiEmbedModel();

  // Single item: use embedContent({ content: { parts:[{text}] } })
  if (texts.length === 1) {
    const r = await model.embedContent({
      content: { parts: [{ text: String(texts[0]) }] }
      // Optional: taskType: 'RETRIEVAL_DOCUMENT'
    });
    const v = r?.embedding?.values || [];
    return { vectors: [v], dim: v.length, modelId };
  }

  // Batch: use batchEmbedContents({ requests:[{ content:{ parts:[{text}] } }, ...] })
  const requests = texts.map(t => ({
    content: { parts: [{ text: String(t) }] }
    // Optional per-item fields: taskType/title
  }));
  const r = await model.batchEmbedContents({ requests });
  const vals = (r?.embeddings || []).map(e => e.values);
  if (!vals.length) throw new Error('Gemini batch embedding returned no vectors');
  return { vectors: vals, dim: vals[0].length, modelId };
}
