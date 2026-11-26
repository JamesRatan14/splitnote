import { ParsedExpense } from '../ml/types';
import { AiMeta, readMeta, validateAiExpense } from './validate';

/** Where the SplitNote AI proxy lives and the passphrase it expects. Stored on-device only. */
export interface AiSettings {
  url: string;
  passphrase: string;
}

export type AiErrorCode =
  | 'not_set_up'
  | 'unauthorized'
  | 'not_configured'
  | 'network'
  | 'timeout'
  | 'refused'
  | 'rate_limited'
  | 'invalid_response'
  | 'server';

export class AiError extends Error {
  constructor(public code: AiErrorCode, message: string) {
    super(message);
  }
}

export function isAiReady(s: AiSettings | null | undefined): s is AiSettings {
  return !!s && /^https?:\/\/\S+$/.test(s.url.trim()) && s.passphrase.length > 0;
}

function base(s: AiSettings): string {
  return s.url.trim().replace(/\/+$/, '');
}

async function request(s: AiSettings, path: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(base(s) + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'X-SplitNote-Key': s.passphrase, ...(init.headers ?? {}) },
      signal: controller.signal,
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    throw new AiError(aborted ? 'timeout' : 'network', aborted ? 'The AI server took too long' : "Couldn't reach the AI server");
  } finally {
    clearTimeout(timer);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const code = typeof body === 'object' && body && 'error' in body ? String((body as { error: unknown }).error) : '';
    if (res.status === 401) throw new AiError('unauthorized', 'Wrong passphrase for the AI server');
    if (res.status === 503 && code === 'not_configured') throw new AiError('not_configured', 'The AI server is not configured yet');
    if (res.status === 503) throw new AiError('rate_limited', 'Claude is busy, try again shortly');
    if (res.status === 422 && code === 'refused') throw new AiError('refused', 'Claude declined this one');
    if (res.status === 504) throw new AiError('timeout', 'Claude took too long');
    throw new AiError('server', `AI server error (${res.status}${code ? `: ${code}` : ''})`);
  }
  return body;
}

export interface AiResult {
  parsed: ParsedExpense;
  meta: AiMeta | null;
}

function toResult(body: unknown): AiResult {
  const parsed = validateAiExpense(body);
  if (!parsed) throw new AiError('invalid_response', 'The AI server sent an unexpected response');
  return { parsed, meta: readMeta(body) };
}

/** What is already in the form; lets a voice command edit it ("make it 50", "add <name>"). */
export interface DraftForAi {
  title?: string;
  amount?: number;
  tax?: number;
  mode?: string;
  date?: string;
  participants: string[];
  includeMe: boolean;
  note?: string;
}

export async function aiParseExpense(
  s: AiSettings,
  text: string,
  today: string,
  knownFriends: string[],
  current?: DraftForAi
): Promise<AiResult> {
  const body = await request(
    s,
    '/parse',
    {
      method: 'POST',
      body: JSON.stringify({
        text: text.slice(0, 600),
        today,
        knownFriends: knownFriends.slice(0, 200),
        ...(current ? { current } : {}),
      }),
    },
    20_000
  );
  return toResult(body);
}

export async function aiReadReceipt(s: AiSettings, imageBase64: string, mediaType: 'image/jpeg', today: string): Promise<AiResult> {
  const body = await request(s, '/receipt', { method: 'POST', body: JSON.stringify({ imageBase64, mediaType, today }) }, 45_000);
  return toResult(body);
}

/** Checks reachability + passphrase without spending any Claude tokens. */
export async function aiCheck(s: AiSettings): Promise<{ model: string }> {
  const body = await request(s, '/auth', { method: 'POST', body: '{}' }, 10_000);
  const model = typeof body === 'object' && body && 'model' in body ? String((body as { model: unknown }).model) : 'unknown';
  return { model };
}
