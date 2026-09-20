/**
 * Telegram Bot API client (PRD §8.8, RESEARCH_FOUNDATION §8).
 *
 * ── MARKDOWNV2 ESCAPING, THE SILENT KILLER ───────────────────────────────────
 * Telegram rejects a MarkdownV2 message with an unescaped reserved character
 * with `400: can't parse entities`. The message simply never arrives. There is
 * no retry, no visible error — the 06:30 brief just does not show up.
 *
 * The reserved set in ordinary text is exactly these 18 characters:
 *
 *     _ * [ ] ( ) ~ ` > # + - = | { } . !
 *
 * Every one must be prefixed with a backslash. The ones that bite in this app:
 *   `.`  — every decimal ("32.5 lb", "3.1 mi") and every sentence-ending period
 *   `-`  — every range ("60-70% HRmax") and every bullet
 *   `!`  — every bit of encouragement
 *   `(`  `)` — every parenthetical
 *   `+`  `=` — every delta ("+5 lb", "ACWR = 1.2")
 *
 * The context rules differ, and getting them wrong is the second failure mode:
 *   - inside `code` / `pre`: escape ONLY `` ` `` and `\`
 *   - inside a `[text](url)` target or a custom emoji id: escape ONLY `)` and `\`
 *   - everywhere else: escape all 18
 *
 * `escapeMarkdownV2` handles ordinary text; `escapeCodeV2` and `escapeLinkUrl`
 * handle the other two. `md` composes safe messages from untrusted values.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Degradation: every method returns an `IntegrationResult`. A failed Telegram
 * send is logged and dropped — the app itself is the source of truth, the bot
 * is a convenience (CLAUDE.md invariant 2).
 */

import {
  type IntegrationResult,
  requestBytes,
  requestJson,
  succeed,
  fail,
} from '../http.js';

export const TELEGRAM_API_BASE = 'https://api.telegram.org';

/** The 18 characters MarkdownV2 reserves in ordinary text. */
export const MARKDOWN_V2_RESERVED = '_*[]()~`>#+-=|{}.!';

/**
 * Escape a string for MarkdownV2 body text. Escapes all 18 reserved characters.
 * Use this on EVERY interpolated value; never hand-build a MarkdownV2 string.
 */
export function escapeMarkdownV2(text: string): string {
  let out = '';
  for (const ch of String(text)) {
    if (MARKDOWN_V2_RESERVED.includes(ch)) out += '\\';
    out += ch;
  }
  return out;
}

/**
 * Escape a string that will sit inside a MarkdownV2 `code` or `pre` block.
 * Only the backtick and the backslash are special there; escaping the rest
 * would print literal backslashes to Seth.
 */
export function escapeCodeV2(text: string): string {
  return String(text).replace(/([`\\])/g, '\\$1');
}

/**
 * Escape a URL used as a MarkdownV2 inline-link target or custom-emoji id.
 * Only `)` and `\` are special inside the parentheses.
 */
export function escapeLinkUrl(url: string): string {
  return String(url).replace(/([)\\])/g, '\\$1');
}

/**
 * Tagged template that escapes every interpolated value for MarkdownV2 while
 * leaving the literal parts alone — so the literals can carry real formatting.
 *
 * ```ts
 * md`*Readiness ${score}* — ${reason}`   // score and reason are escaped
 * ```
 * Wrap a value in `raw()` to opt out when you have already escaped it.
 */
export function md(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) {
      const v = values[i];
      out += isRaw(v) ? v.value : escapeMarkdownV2(String(v));
    }
  });
  return out;
}

const RAW = Symbol('telegram.raw');
interface Raw {
  [RAW]: true;
  value: string;
}
/** Mark an already-escaped fragment so `md` passes it through untouched. */
export function raw(value: string): Raw {
  return { [RAW]: true, value };
}
function isRaw(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && (v as Raw)[RAW] === true;
}

/** Bold, italic, code and link helpers that escape their content correctly. */
export const fmt = {
  /** `*bold*` with the content escaped. */
  bold: (t: string): string => `*${escapeMarkdownV2(t)}*`,
  /** `_italic_` with the content escaped. */
  italic: (t: string): string => `_${escapeMarkdownV2(t)}_`,
  /** `` `code` `` with code-context escaping. */
  code: (t: string): string => `\`${escapeCodeV2(t)}\``,
  /** A fenced block with an optional language tag. */
  pre: (t: string, lang = ''): string => `\`\`\`${lang}\n${escapeCodeV2(t)}\n\`\`\``,
  /** `[label](url)` with both halves escaped by their own rules. */
  link: (label: string, url: string): string =>
    `[${escapeMarkdownV2(label)}](${escapeLinkUrl(url)})`,
  /** `>` block quote, escaped line by line. */
  quote: (t: string): string =>
    t.split('\n').map((line) => `>${escapeMarkdownV2(line)}`).join('\n'),
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ParseMode = 'MarkdownV2' | 'HTML' | undefined;

export interface InlineKeyboardButton {
  text: string;
  /** ≤64 BYTES. See `keyboards.ts` for the compact scheme. */
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface SendMessageOptions {
  chat_id: string | number;
  text: string;
  /** Defaults to MarkdownV2. Pass `undefined` explicitly for plain text. */
  parse_mode?: ParseMode;
  reply_markup?: InlineKeyboardMarkup;
  disable_notification?: boolean;
  reply_to_message_id?: number;
  /** Telegram's modern flag for suppressing URL previews. */
  link_preview_options?: { is_disabled?: boolean };
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: string };
  text?: string;
  [k: string]: unknown;
}

interface TelegramEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

export interface TelegramClientOptions {
  /** BotFather token. */
  token: string;
  /** Default chat, so callers can omit `chat_id`. */
  defaultChatId?: string | number;
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

// ─────────────────────────────────────────────────────────────────────────────
// Client
// ─────────────────────────────────────────────────────────────────────────────

export class TelegramClient {
  private readonly token: string;
  private readonly base: string;
  private readonly defaultChatId: string | number | undefined;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly fetchImpl: typeof fetch | undefined;

  constructor(opts: TelegramClientOptions) {
    this.token = opts.token;
    this.base = (opts.baseUrl ?? TELEGRAM_API_BASE).replace(/\/$/, '');
    this.defaultChatId = opts.defaultChatId;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.retries = opts.retries ?? 1;
    this.fetchImpl = opts.fetchImpl;
  }

  /** Call any Bot API method. Unwraps the `{ ok, result }` envelope. */
  async call<T>(method: string, body?: Record<string, unknown>): Promise<IntegrationResult<T>> {
    const res = await requestJson<TelegramEnvelope<T>>(
      `${this.base}/bot${this.token}/${method}`,
      {
        method: 'POST',
        ...(body ? { body } : {}),
        timeoutMs: this.timeoutMs,
        retries: this.retries,
        ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
      },
    );
    if (!res.ok) return res;
    const env = res.value;
    if (!env || env.ok !== true) {
      // Telegram returns HTTP 200 with `ok: false` for parse errors — the
      // MarkdownV2 failure mode. Surface the description; it names the offset.
      return fail(
        env?.error_code === 429 ? 'rate_limited' : 'client',
        `Telegram ${method} failed: ${env?.description ?? 'unknown error'}`,
        {
          ...(env?.error_code !== undefined ? { status: env.error_code } : {}),
          ...(env?.parameters?.retry_after !== undefined
            ? { retryAfterSec: env.parameters.retry_after }
            : {}),
          detail: env,
        },
      );
    }
    return succeed(env.result as T);
  }

  /**
   * Send a message. Defaults to MarkdownV2 — pass text built with `md` / `fmt`,
   * never a raw interpolated string.
   *
   * On a MarkdownV2 parse failure the message is retried ONCE as plain text, so
   * an escaping slip degrades to an ugly message rather than to silence. That
   * fallback is a safety net, not a licence to skip escaping.
   */
  async sendMessage(
    opts: Omit<SendMessageOptions, 'chat_id'> & { chat_id?: string | number },
  ): Promise<IntegrationResult<TelegramMessage>> {
    const chatId = opts.chat_id ?? this.defaultChatId;
    if (chatId === undefined) return fail('client', 'sendMessage: no chat_id and no default');

    const parseMode = 'parse_mode' in opts ? opts.parse_mode : 'MarkdownV2';
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: opts.text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
      ...(opts.reply_markup ? { reply_markup: opts.reply_markup } : {}),
      ...(opts.disable_notification ? { disable_notification: true } : {}),
      ...(opts.reply_to_message_id ? { reply_to_message_id: opts.reply_to_message_id } : {}),
      ...(opts.link_preview_options ? { link_preview_options: opts.link_preview_options } : {}),
    };

    const res = await this.call<TelegramMessage>('sendMessage', payload);
    if (res.ok) return res;
    if (parseMode === 'MarkdownV2' && /can't parse entities/i.test(res.error.message)) {
      const { parse_mode: _drop, ...plain } = payload;
      void _drop;
      return this.call<TelegramMessage>('sendMessage', {
        ...plain,
        text: stripMarkdownV2Escapes(opts.text),
      });
    }
    return res;
  }

  /**
   * Send a photo by URL or `file_id`. Captions follow the same MarkdownV2 rules
   * and are capped at 1024 characters by Telegram.
   */
  sendPhoto(opts: {
    chat_id?: string | number;
    photo: string;
    caption?: string;
    parse_mode?: ParseMode;
    reply_markup?: InlineKeyboardMarkup;
  }): Promise<IntegrationResult<TelegramMessage>> {
    const chatId = opts.chat_id ?? this.defaultChatId;
    if (chatId === undefined) return Promise.resolve(fail('client', 'sendPhoto: no chat_id'));
    return this.call<TelegramMessage>('sendPhoto', {
      chat_id: chatId,
      photo: opts.photo,
      ...(opts.caption ? { caption: opts.caption.slice(0, 1024) } : {}),
      ...(opts.caption ? { parse_mode: opts.parse_mode ?? 'MarkdownV2' } : {}),
      ...(opts.reply_markup ? { reply_markup: opts.reply_markup } : {}),
    });
  }

  /**
   * Edit a message in place. This is how a button tap becomes a state change
   * without spamming the chat — the daily brief edits itself to "Started ✓".
   *
   * Telegram errors with `message is not modified` when the new text is
   * identical; that is treated as success, because it is.
   */
  async editMessageText(opts: {
    chat_id?: string | number;
    message_id: number;
    text: string;
    parse_mode?: ParseMode;
    reply_markup?: InlineKeyboardMarkup;
  }): Promise<IntegrationResult<TelegramMessage | true>> {
    const chatId = opts.chat_id ?? this.defaultChatId;
    if (chatId === undefined) return fail('client', 'editMessageText: no chat_id');
    const res = await this.call<TelegramMessage>('editMessageText', {
      chat_id: chatId,
      message_id: opts.message_id,
      text: opts.text,
      parse_mode: 'parse_mode' in opts ? opts.parse_mode : 'MarkdownV2',
      ...(opts.reply_markup ? { reply_markup: opts.reply_markup } : {}),
    });
    if (!res.ok && /message is not modified/i.test(res.error.message)) return succeed(true);
    return res;
  }

  /**
   * Acknowledge a button tap. **Telegram shows a spinner on the button until
   * this is called**, so call it FIRST — before any engine work — or the tap
   * feels broken. The callback query id expires after ~1 minute.
   */
  answerCallbackQuery(opts: {
    callback_query_id: string;
    /** ≤200 characters. Plain text; no parse mode here. */
    text?: string;
    /** Show as a modal instead of a toast. */
    show_alert?: boolean;
  }): Promise<IntegrationResult<true>> {
    return this.call<true>('answerCallbackQuery', {
      callback_query_id: opts.callback_query_id,
      ...(opts.text ? { text: opts.text.slice(0, 200) } : {}),
      ...(opts.show_alert ? { show_alert: true } : {}),
    });
  }

  /** Resolve a `file_id` to a `file_path`. Paths expire after ~1 hour. */
  getFile(fileId: string): Promise<IntegrationResult<{ file_id: string; file_path?: string; file_size?: number }>> {
    return this.call('getFile', { file_id: fileId });
  }

  /**
   * `getFile` then download the bytes — the whiteboard-photo path (PRD §8.7).
   * Bot API caps downloads at 20 MB; Telegram already compresses photos well
   * below that. Returns the bytes plus the resolved path for storage.
   */
  async downloadFile(
    fileId: string,
  ): Promise<IntegrationResult<{ bytes: Uint8Array; path: string; mime?: string }>> {
    const meta = await this.getFile(fileId);
    if (!meta.ok) return meta;
    const path = meta.value?.file_path;
    if (!path) return fail('not_found', `Telegram getFile returned no file_path for ${fileId}`);
    const bytes = await requestBytes(`${this.base}/file/bot${this.token}/${path}`, {
      timeoutMs: 30_000,
      ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
    });
    if (!bytes.ok) return bytes;
    return succeed({ bytes: bytes.value, path, ...(guessMime(path) ? { mime: guessMime(path) } : {}) });
  }

  /**
   * Point the bot at our Vercel route.
   *
   * `secret_token` makes Telegram send `X-Telegram-Bot-Api-Secret-Token` on
   * every delivery; the route MUST compare it (see `verifyWebhookSecret`) or
   * anyone who guesses the URL can post fake button taps. Alphanumeric plus
   * `_` and `-`, 1–256 characters.
   */
  setWebhook(opts: {
    url: string;
    secret_token: string;
    /** Defaults to messages, edits and button taps — everything the bot uses. */
    allowed_updates?: string[];
    drop_pending_updates?: boolean;
    max_connections?: number;
  }): Promise<IntegrationResult<true>> {
    return this.call<true>('setWebhook', {
      url: opts.url,
      secret_token: opts.secret_token,
      allowed_updates: opts.allowed_updates ?? ['message', 'edited_message', 'callback_query'],
      ...(opts.drop_pending_updates ? { drop_pending_updates: true } : {}),
      ...(opts.max_connections ? { max_connections: opts.max_connections } : {}),
    });
  }

  /** Remove the webhook (local development, or switching to long polling). */
  deleteWebhook(dropPendingUpdates = false): Promise<IntegrationResult<true>> {
    return this.call<true>('deleteWebhook', {
      ...(dropPendingUpdates ? { drop_pending_updates: true } : {}),
    });
  }

  /** Current webhook state — the first thing to check when the bot goes quiet. */
  getWebhookInfo(): Promise<IntegrationResult<Record<string, unknown>>> {
    return this.call('getWebhookInfo');
  }

  /** Bot identity. A cheap liveness check for the setup script. */
  getMe(): Promise<IntegrationResult<Record<string, unknown>>> {
    return this.call('getMe');
  }
}

/**
 * Constant-time-ish comparison of the incoming secret header against ours.
 * Reject the update with 401 when this returns false.
 */
export function verifyWebhookSecret(headerValue: string | null | undefined, expected: string): boolean {
  if (!headerValue || !expected) return false;
  if (headerValue.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= headerValue.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** Undo MarkdownV2 escaping, for the plain-text retry path. */
export function stripMarkdownV2Escapes(text: string): string {
  return text.replace(/\\([_*[\]()~`>#+\-=|{}.!\\])/g, '$1');
}

/** Cheap extension → MIME guess for downloaded Telegram files. */
function guessMime(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'heic':
      return 'image/heic';
    case 'pdf':
      return 'application/pdf';
    default:
      return undefined;
  }
}
