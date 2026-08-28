import { TOOL_DECLARATIONS, type ToolContext, type ToolResult, runTool } from './tools.ts';

/**
 * The optional assistant.
 *
 * Everything else in this app runs offline. This one file does not: it talks to
 * Google's Gemini API with a key the person supplies and which is stored only
 * in their browser. That trade is deliberate and it is the only one — the
 * assistant is a way of talking to the tracker, not a replacement for it.
 *
 * The design rule that makes it trustworthy: the model chooses *which* tool to
 * call and with what words, and the local database supplies every number. Ask
 * it to log two rotis and it calls log_food("2 rotis"); the calories come from
 * the same table the typed interface uses. A language model asked to estimate
 * calories directly will confidently invent them, so it is never asked to.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export const MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — fast, free tier' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro — slower, better reasoning' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash — older, very fast' },
];

export const DEFAULT_MODEL = 'gemini-2.5-flash';

const KEY_STORAGE = 'ai-calorie-tracker/gemini-key';
const MODEL_STORAGE = 'ai-calorie-tracker/gemini-model';

/* ------------------------------------------------------------ key handling */

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function getApiKey(): string | null {
  return safeStorage()?.getItem(KEY_STORAGE) ?? null;
}

export function setApiKey(key: string | null): void {
  const store = safeStorage();
  if (!store) return;
  if (key && key.trim()) store.setItem(KEY_STORAGE, key.trim());
  else store.removeItem(KEY_STORAGE);
}

export function getModel(): string {
  return safeStorage()?.getItem(MODEL_STORAGE) ?? DEFAULT_MODEL;
}

export function setModel(model: string): void {
  safeStorage()?.setItem(MODEL_STORAGE, model);
}

/** A Gemini key looks like AIza followed by 35 URL-safe characters. */
export function looksLikeKey(key: string): boolean {
  return /^AIza[\w-]{30,50}$/.test(key.trim());
}

/* -------------------------------------------------------------- the shapes */

export interface ChatAttachment {
  mimeType: string;
  /** Base64 without the data: prefix. */
  data: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  attachment?: ChatAttachment;
  /** Tools that ran while producing this reply, for showing the working. */
  toolRuns?: { name: string; summary: string; ok: boolean }[];
  at: string;
}

interface Part {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface Content {
  role: 'user' | 'model';
  parts: Part[];
}

export function systemInstruction(ctx: ToolContext): string {
  const profile = ctx.state.profile;
  return [
    'You are the assistant inside an offline-first calorie and fitness tracker built around Indian food.',
    'You help one person log what they eat and how they train, and answer questions about their own data.',
    '',
    'The single most important rule: you never estimate nutrition or energy yourself. The app has a food',
    'database and a parser. When they tell you what they ate, call log_food and pass their own words,',
    'amounts included, exactly as they said them - "2 rotis and a katori of dal", not "180g wheat flatbread".',
    'The tool returns the real numbers from the database. Report those numbers, never numbers of your own.',
    'The same goes for training: pass their words to log_training and let it compute METs and calories.',
    '',
    'When they send a photo of food, identify the dishes and estimate the portions in ordinary words',
    '("two rotis, a katori of rajma, about a cup of rice"), then call log_food with that description so the',
    'database prices it. Say what you think you see and how confident you are, and let them correct you.',
    '',
    'Before answering a question about their day, their targets or their training, call the relevant read',
    'tool rather than guessing from the conversation. Their log changes outside this chat.',
    '',
    'Ask before changing a goal, a rate or profile settings. Log food and training without asking - that is',
    'what they came for - but say clearly what you logged so a mistake is obvious and can be undone with',
    'remove_last_food.',
    '',
    `Context: they are ${profile.age}, ${profile.sex}, ${profile.heightCm} cm, ${profile.weightKg} kg,`,
    `${profile.diet}, aiming to ${profile.goal} at ${profile.rateKgPerWeek} kg a week, training`,
    `${profile.trainingDays} days a week with ${profile.equipment.join(', ')}. They train as a`,
    `${profile.level}, with ${profile.emphasis} emphasis. Today is ${ctx.today}.`,
    '',
    'If they say the training is too easy or too hard, change their level with update_profile rather than',
    'arguing about it. If they say they want a body part to grow, set the emphasis. Be straight that where',
    'fat sits is not something training chooses: abs show up when body fat drops, and that is the calorie',
    'target doing the work, not the crunches.',
    '',
    'Be brief and plain. Use metric and Indian portion words (katori, bowl, plate, roti) because that is how',
    'they think. Never moralise about food, never call anything a cheat meal, and do not comment on their',
    'body. You are not a doctor: if something sounds like a medical question, say so in one sentence and',
    'suggest they ask one.',
  ].join('\n');
}

/* --------------------------------------------------------------- the calls */

export class GeminiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'GeminiError';
  }
}

function describeFailure(status: number, body: string): string {
  if (status === 400 && /API key not valid/i.test(body)) {
    return 'That API key was rejected. Check it was copied whole from Google AI Studio.';
  }
  if (status === 400) return `Gemini rejected the request: ${body.slice(0, 200)}`;
  if (status === 403) return 'That key is not allowed to use this model. Check the key is enabled for the Gemini API.';
  if (status === 429) return 'You have hit the rate limit for the free tier. Wait a minute and try again.';
  if (status >= 500) return 'Gemini is having trouble at the moment. Try again shortly.';
  return `Gemini returned ${status}: ${body.slice(0, 200)}`;
}

async function callModel(model: string, key: string, body: unknown): Promise<Content> {
  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
  } catch {
    throw new GeminiError('Could not reach Gemini. Everything else in the app still works offline.');
  }

  if (!response.ok) {
    throw new GeminiError(describeFailure(response.status, await response.text()), response.status);
  }

  const json = await response.json() as {
    candidates?: { content?: Content; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };

  if (json.promptFeedback?.blockReason) {
    throw new GeminiError(`Gemini declined to answer that (${json.promptFeedback.blockReason}).`);
  }
  const content = json.candidates?.[0]?.content;
  if (!content) throw new GeminiError('Gemini sent an empty reply.');
  return content;
}

/** Turn stored chat history into the wire format. */
export function toContents(history: ChatMessage[]): Content[] {
  return history.map((message) => {
    const parts: Part[] = [];
    if (message.attachment) {
      parts.push({ inlineData: { mimeType: message.attachment.mimeType, data: message.attachment.data } });
    }
    if (message.text) parts.push({ text: message.text });
    if (parts.length === 0) parts.push({ text: '' });
    return { role: message.role, parts };
  });
}

export interface SendResult {
  reply: string;
  toolRuns: { name: string; summary: string; ok: boolean }[];
  /** True when any tool changed the log, so the caller should save and re-render. */
  mutated: boolean;
}

/**
 * Send a turn and run whatever tools the model asks for, until it has an answer.
 *
 * The loop is bounded: a model that keeps calling tools without concluding gets
 * cut off rather than spending someone's quota in a circle.
 */
export async function sendMessage(
  history: ChatMessage[],
  ctx: ToolContext,
  options: { key: string; model?: string; maxRounds?: number } = { key: '' },
): Promise<SendResult> {
  const model = options.model ?? getModel();
  const maxRounds = options.maxRounds ?? 5;
  const contents = toContents(history);
  const toolRuns: { name: string; summary: string; ok: boolean }[] = [];
  let mutated = false;

  for (let round = 0; round < maxRounds; round += 1) {
    const content = await callModel(model, options.key, {
      contents,
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      systemInstruction: { parts: [{ text: systemInstruction(ctx) }] },
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
    });

    const calls = (content.parts ?? []).filter((part) => part.functionCall);
    if (calls.length === 0) {
      const reply = (content.parts ?? []).map((part) => part.text ?? '').join('').trim();
      return { reply: reply || 'No reply came back.', toolRuns, mutated };
    }

    contents.push({ role: 'model', parts: content.parts });

    const responses: Part[] = [];
    for (const part of calls) {
      const call = part.functionCall as { name: string; args?: Record<string, unknown> };
      const result: ToolResult = runTool(call.name, call.args ?? {}, ctx);
      if (result.mutated) mutated = true;
      toolRuns.push({ name: call.name, summary: result.summary, ok: result.ok });
      responses.push({
        functionResponse: {
          name: call.name,
          response: { ok: result.ok, summary: result.summary, ...(result.data ?? {}) },
        },
      });
    }
    contents.push({ role: 'user', parts: responses });
  }

  return {
    reply: 'That took too many steps, so I stopped. The actions that did run are listed above.',
    toolRuns,
    mutated,
  };
}
