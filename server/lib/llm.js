// server/lib/llm.js
import Anthropic from '@anthropic-ai/sdk';

const apiKey = process.env.ANTHROPIC_API_KEY;
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514'; // recommended pin

export const hasAnthropic = !!apiKey;

let client = null;
export function anthropicClient() {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

/**
 * Pick a working Sonnet model if DEFAULT_MODEL 404s:
 *  1) exact DEFAULT_MODEL if available
 *  2) first model that starts with 'claude-sonnet-4-'
 *  3) fallback: first model that includes 'sonnet'
 */
async function pickFallbackModel() {
  const c = anthropicClient();
  const page = await c.models.list(); // returns most-recent-first
  const data = page?.data || [];

  const exact = data.find(m => m.id === DEFAULT_MODEL);
  if (exact) return exact.id;

  const sonnet4 = data.find(m => m.id.startsWith('claude-sonnet-4-'));
  if (sonnet4) return sonnet4.id;

  const anySonnet = data.find(m => m.id.toLowerCase().includes('sonnet'));
  if (anySonnet) return anySonnet.id;

  // last resort: return whatever the API listed first
  if (data[0]?.id) return data[0].id;

  throw new Error('No suitable Anthropic model available');
}

/**
 * Ask the model to generate a Mermaid Domain Graph for a topic.
 * Returns the Mermaid body (no fences).
 */
export async function generateDomainMermaid(topic) {
  const c = anthropicClient();
  const system = `You generate a Domain Graph for a topic as a Mermaid diagram.
- Output ONLY a single Mermaid code block fenced with \`\`\`mermaid ... \`\`\`.
- Graph rules:
  * Nodes: C001..Cnn with labels in quotes (e.g., C001["Linear Regression"])
  * Edges:
      A --> B            // A is prerequisite for B (DAG)
      A --- B            // A relates_to B
      A -->|part_of| B   // A is part_of B
- Keep prerequisite edges acyclic. Use 80–200 nodes for broad topics.`;

  const user = `Topic: "${topic}"\nReturn ONLY the Mermaid code block.`;

  let model = DEFAULT_MODEL;
  try {
    // first attempt with configured default
    const msg = await c.messages.create({
      model,
      max_tokens: 4000,
      temperature: 0.2,
      system,
      messages: [{ role: 'user', content: user }]
    });

    const text = (msg.content?.[0]?.text || '').trim();
    const m = text.match(/```mermaid\s*([\s\S]*?)```/i);
    if (!m) throw new Error('No mermaid block returned');
    return m[1].trim();
  } catch (err) {
    // If it's a 404 (deprecated/missing model), pick a fallback once and retry.
    const is404 =
      (err?.status === 404) ||
      /not_found/i.test(err?.error?.type || '') ||
      /model/i.test(err?.message || '') && /not found|deprecated/i.test(err?.message || '');

    if (!is404) throw err;

    const picked = await pickFallbackModel();
    const msg = await c.messages.create({
      model: picked,
      max_tokens: 4000,
      temperature: 0.2,
      system,
      messages: [{ role: 'user', content: user }]
    });

    const text = (msg.content?.[0]?.text || '').trim();
    const m = text.match(/```mermaid\s*([\s\S]*?)```/i);
    if (!m) throw new Error('No mermaid block returned');
    return m[1].trim();
  }
}
