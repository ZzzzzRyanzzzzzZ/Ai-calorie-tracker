import {
  type ChatMessage,
  DEFAULT_MODEL,
  GeminiError,
  MODELS,
  getApiKey,
  getModel,
  looksLikeKey,
  sendMessage,
  setApiKey,
  setModel,
} from '../ai/gemini.ts';
import type { ToolContext } from '../ai/tools.ts';
import { el } from './dom.ts';
import { type PreparedImage, prepareImage } from './image.ts';

/**
 * The assistant tab.
 *
 * Conversation text is kept in localStorage so a reload does not lose the
 * thread. Photos are deliberately *not* kept: a few phone pictures would
 * exhaust the storage quota and evict the food log, which is the thing that
 * actually matters. They are sent, shown for the session, and forgotten.
 */

const HISTORY_KEY = 'ai-calorie-tracker/chat';
const MAX_STORED = 40;

export interface ChatState {
  messages: ChatMessage[];
  draft: string;
  pending: boolean;
  error: string | null;
  attachment: PreparedImage | null;
  showSettings: boolean;
}

export function emptyChat(): ChatState {
  return { messages: loadHistory(), draft: '', pending: false, error: null, attachment: null, showSettings: false };
}

function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(messages: ChatMessage[]): void {
  try {
    // Strip attachments before storing: base64 photos would fill the quota.
    const slim = messages.slice(-MAX_STORED).map(({ attachment: _drop, ...rest }) => rest);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(slim));
  } catch {
    // A full or blocked store just means the thread is not remembered.
  }
}

export function clearHistory(chat: ChatState): void {
  chat.messages = [];
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // Nothing to do.
  }
}

const SUGGESTIONS = [
  'I had 2 rotis, a katori of rajma and some rice for lunch',
  'what should I train today?',
  'how am I doing this week?',
  'I weighed 74.2 this morning',
  'how much protein do I still need today?',
];

/* -------------------------------------------------------------- the setup */

function setupPanel(rerender: () => void): HTMLElement {
  const input = el('input', {
    type: 'password',
    placeholder: 'AIza...',
    'aria-label': 'Gemini API key',
    autocomplete: 'off',
  });
  const status = el('p', { class: 'note' }, 'The key is stored in this browser only. It is never committed, uploaded or sent anywhere except to Google when you send a message.');

  const save = (): void => {
    const value = input.value.trim();
    if (!value) return;
    if (!looksLikeKey(value)) {
      status.textContent = 'That does not look like a Gemini key. They start with AIza and are about 39 characters.';
      status.className = 'note warn';
      return;
    }
    setApiKey(value);
    rerender();
  };

  return el('section', { class: 'card' },
    el('h2', {}, 'Assistant'),
    el('h3', {}, 'Talk to your tracker'),
    el('p', { class: 'note' },
      'Everything else in this app works offline with no account. This one feature does not: it sends your '
      + 'message, and any photo, to Google\'s Gemini API using a key you supply. Nothing else in the app changes, '
      + 'and the calorie numbers still come from the local database rather than from the model.'),
    el('p', { class: 'note' },
      'Get a free key at ',
      el('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noreferrer noopener' }, 'aistudio.google.com/apikey'),
      ', then paste it here.'),
    el('div', { class: 'row', style: 'margin-top:12px' },
      el('div', { class: 'grow' }, input),
      el('button', { class: 'primary', onclick: save }, 'Save key')),
    status,
    el('p', { class: 'note' },
      'If you publish this app anywhere public, do not put a key in the code: each person should paste their own, '
      + 'or anyone visiting could spend your quota.'));
}

function settingsPanel(rerender: () => void): HTMLElement {
  const select = el('select', {
    'aria-label': 'Model',
    onchange: (event: Event) => {
      setModel((event.target as HTMLSelectElement).value);
      rerender();
    },
  }, MODELS.map((model) => el('option', { value: model.id, selected: getModel() === model.id }, model.label)));

  return el('section', { class: 'card' },
    el('h2', {}, 'Assistant settings'),
    el('div', { class: 'fields' },
      el('div', { class: 'field' }, el('label', {}, 'Model'), select)),
    el('div', { class: 'row', style: 'margin-top:14px' },
      el('button', {
        class: 'ghost',
        onclick: () => {
          setApiKey(null);
          rerender();
        },
      }, 'Remove key from this browser')),
    el('p', { class: 'note' }, `Default is ${DEFAULT_MODEL}. Flash is fast and free-tier friendly; Pro thinks harder about a question like "why has my weight stalled".`));
}

/* ------------------------------------------------------------ the messages */

function messageBubble(message: ChatMessage): HTMLElement {
  return el('div', { class: `bubble ${message.role}` },
    message.attachment
      ? el('img', {
        class: 'bubble-photo',
        src: `data:${message.attachment.mimeType};base64,${message.attachment.data}`,
        alt: 'Photo you sent',
      })
      : null,
    message.text ? el('div', { class: 'bubble-text' }, message.text) : null,
    message.toolRuns && message.toolRuns.length > 0
      ? el('div', { class: 'tool-runs' }, message.toolRuns.map((run) => el('div', {
        class: `tool-run${run.ok ? '' : ' failed'}`,
      }, el('code', {}, run.name), ' ', run.summary)))
      : null);
}

/* --------------------------------------------------------------- the tab */

export function chatTab(
  chat: ChatState,
  ctx: () => ToolContext,
  rerender: () => void,
  onMutate: () => void,
): (HTMLElement | null)[] {
  const key = getApiKey();
  if (!key) return [setupPanel(rerender)];
  if (chat.showSettings) {
    return [
      el('div', { class: 'row', style: 'margin-bottom:12px' },
        el('button', { class: 'ghost', onclick: () => { chat.showSettings = false; rerender(); } }, '← Back to chat')),
      settingsPanel(rerender),
    ];
  }

  const send = async (): Promise<void> => {
    const text = chat.draft.trim();
    if ((!text && !chat.attachment) || chat.pending) return;

    const outgoing: ChatMessage = {
      role: 'user',
      text: text || 'What is on this plate? Log it for me.',
      at: new Date().toISOString(),
      ...(chat.attachment
        ? { attachment: { mimeType: chat.attachment.mimeType, data: chat.attachment.data } }
        : {}),
    };
    chat.messages.push(outgoing);
    chat.draft = '';
    chat.attachment = null;
    chat.pending = true;
    chat.error = null;
    rerender();

    try {
      const result = await sendMessage(chat.messages, ctx(), { key, model: getModel() });
      chat.messages.push({
        role: 'model',
        text: result.reply,
        at: new Date().toISOString(),
        ...(result.toolRuns.length > 0 ? { toolRuns: result.toolRuns } : {}),
      });
      if (result.mutated) onMutate();
    } catch (error) {
      chat.error = error instanceof GeminiError ? error.message : (error as Error).message;
      // Drop the failed turn so retrying does not send it twice.
      chat.messages.pop();
    } finally {
      chat.pending = false;
      saveHistory(chat.messages);
      rerender();
    }
  };

  const input = el('textarea', {
    placeholder: 'Tell it what you ate, or ask it anything about your log',
    'aria-label': 'Message',
    value: chat.draft,
    oninput: (event: Event) => { chat.draft = (event.target as HTMLTextAreaElement).value; },
    onkeydown: (event: Event) => {
      const keyboard = event as KeyboardEvent;
      if (keyboard.key === 'Enter' && !keyboard.shiftKey) {
        keyboard.preventDefault();
        void send();
      }
    },
  });

  const photoInput = el('input', {
    type: 'file',
    accept: 'image/*',
    capture: 'environment',
    style: 'display:none',
    onchange: (event: Event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      void prepareImage(file)
        .then((prepared) => {
          chat.attachment = prepared;
          chat.error = null;
          rerender();
        })
        .catch((error: Error) => {
          chat.error = error.message;
          rerender();
        });
    },
  });

  const thread = el('div', { class: 'thread' },
    chat.messages.length === 0
      ? el('div', { class: 'empty-state' },
        'Say what you ate and it will log it. Take a photo of your plate and it will work out what is on it. '
        + 'Ask what to train and it will read your own plan back to you.')
      : chat.messages.map(messageBubble),
    chat.pending ? el('div', { class: 'bubble model pending' }, 'Thinking…') : null);

  // Once render has put the thread in the document, show its newest message.
  queueMicrotask(() => { thread.scrollTop = thread.scrollHeight; });

  return [
    el('div', { class: 'row spread', style: 'margin-bottom:12px' },
      el('span', { class: 'badge' }, getModel()),
      el('div', { class: 'row' },
        chat.messages.length > 0
          ? el('button', { class: 'ghost', onclick: () => { clearHistory(chat); rerender(); } }, 'Clear chat')
          : null,
        el('button', { class: 'ghost', onclick: () => { chat.showSettings = true; rerender(); } }, 'Settings'))),

    el('section', { class: 'card' }, thread),

    chat.error ? el('div', { class: 'card' }, el('p', { class: 'note warn' }, chat.error)) : null,

    el('section', { class: 'card' },
      chat.attachment
        ? el('div', { class: 'row', style: 'margin-bottom:10px' },
          el('img', { class: 'attachment-preview', src: chat.attachment.dataUrl, alt: 'Photo to send' }),
          el('span', { class: 'note grow' }, `${chat.attachment.width}x${chat.attachment.height}, ${Math.round(chat.attachment.bytes / 1024)} kB`),
          el('button', { class: 'ghost', onclick: () => { chat.attachment = null; rerender(); } }, 'Remove'))
        : null,
      el('div', { class: 'entry' },
        input,
        el('div', { class: 'row spread' },
          el('div', { class: 'row' },
            photoInput,
            el('button', {
              class: 'ghost',
              onclick: () => photoInput.click(),
            }, '📷 Photo')),
          el('button', { class: 'primary', disabled: chat.pending, onclick: () => void send() },
            chat.pending ? 'Sending…' : 'Send'))),
      chat.messages.length === 0
        ? el('div', { class: 'examples', style: 'margin-top:10px' },
          'Try: ',
          SUGGESTIONS.slice(0, 3).map((suggestion) => el('button', {
            class: 'link',
            onclick: () => { chat.draft = suggestion; input.value = suggestion; input.focus(); },
          }, suggestion)))
        : null),
  ];
}
