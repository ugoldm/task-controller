import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';

/** Whether the Claude-powered parsing is available (key present). */
export const aiEnabled = !!process.env.ANTHROPIC_API_KEY;

// Single client, reused across requests (keeps the prompt cache warm).
const client = aiEnabled ? new Anthropic() : null;

const SYSTEM_PROMPT = `Ты — ассистент продакт-менеджера. Тебе дают свободный текст на русском
(описание дел, кусок переписки, заметка). Разбей его на отдельные, атомарные задачи.

Правила:
- Каждая задача — короткая повелительная формулировка ("Согласовать макет", "Ответить Артёму").
- Не выдумывай задачи, которых нет в тексте. Если задача одна — верни одну.
- Для каждой задачи выбери наиболее подходящий стрим из переданного списка по смыслу.
  Если ничего не подходит — используй первый стрим из списка.
- Верни только структурированный JSON, без пояснений.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          streamId: { type: 'string' },
        },
        required: ['title', 'streamId'],
      },
    },
  },
  required: ['tasks'],
};

/**
 * Ask Claude to split free-form text into discrete tasks, each mapped to a stream.
 * @param {string} text
 * @param {Array<{id:string,name:string,type:string}>} streams
 * @returns {Promise<Array<{title:string, streamId:string}>>}
 * @throws on any API/parse failure (caller should fall back to a heuristic).
 */
export async function parseTasksFromText(text, streams) {
  if (!aiEnabled) throw new Error('AI disabled: ANTHROPIC_API_KEY is not set');
  if (!streams.length) throw new Error('No streams to assign tasks to');

  const validIds = new Set(streams.map((s) => s.id));
  const fallbackId = streams[0].id;
  const streamList = streams.map((s) => `- ${s.id}: ${s.name} (${s.type})`).join('\n');

  // Stable instructions + (semi-stable) stream list go in system with a cache
  // breakpoint; only the volatile user text varies per request.
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: SCHEMA },
    },
    system: [
      {
        type: 'text',
        text: `${SYSTEM_PROMPT}\n\nДоступные стримы:\n${streamList}`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: text }],
  });

  const block = response.content.find((b) => b.type === 'text');
  if (!block) throw new Error('Empty AI response');

  const parsed = JSON.parse(block.text);
  const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];

  return tasks
    .filter((t) => t && typeof t.title === 'string' && t.title.trim())
    .map((t) => ({
      title: t.title.trim(),
      streamId: validIds.has(t.streamId) ? t.streamId : fallbackId,
    }));
}
