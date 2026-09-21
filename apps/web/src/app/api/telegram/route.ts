import { NextResponse, after } from 'next/server';
import { notWired, telegramClient } from '@/lib/integrations-bridge';
import { serviceSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Telegram webhook.
 *
 * Every request must carry the secret token Telegram was configured with
 * (`setWebhook?secret_token=…`). Anything else is dropped with a 401 — this
 * endpoint is public and the bot can start sessions.
 *
 * Routing is rules-first: the quick-reply buttons (Start · 20 min instead ·
 * Home instead · Skip) are handled deterministically; only free text is handed
 * to the LLM, and even then the engine owns any prescription it produces.
 */
type TelegramUpdate = {
  update_id?: number;
  message?: { chat?: { id?: number }; text?: string; photo?: unknown[] };
  callback_query?: { id?: string; data?: string; message?: { chat?: { id?: number } } };
};

const QUICK_ACTIONS = new Set(['start', 'budget:20', 'location:home', 'skip']);

export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
  const provided = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!secret || provided !== secret) {
    return NextResponse.json({ ok: false, reason: 'bad_secret' }, { status: 401 });
  }

  let update: TelegramUpdate = {};
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true, ignored: 'unparseable' });
  }

  after(async () => {
    const client = telegramClient();
    const supabase = serviceSupabase();
    if (supabase) {
      // TODO(db): append to `bot_messages` for the audit trail.
    }
    if (!client) return;

    const data = update.callback_query?.data ?? '';
    if (QUICK_ACTIONS.has(data)) {
      // TODO(integrations): client.answerCallbackQuery + client.sendMessage with
      // the re-planned session. Rules-first — no LLM on this path.
      return;
    }

    if (update.message?.photo) {
      // TODO(integrations): enqueue an llm_jobs vision row (whiteboard or scale photo).
      return;
    }

    // TODO(integrations): free text → llm_jobs row, engine tools only.
  });

  return NextResponse.json({ ok: true });
}

export async function GET() {
  // A health probe, never the webhook itself.
  return NextResponse.json({
    ok: true,
    configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET),
    client: telegramClient() ? 'wired' : notWired('telegram').reason,
  });
}
