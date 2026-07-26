import type {
  CoverStoryCommentAdapter,
  CoverStoryCommentAdapterContext,
} from './rehydrateCoverStory.js';

const DEFAULT_MODEL = 'local-comment-rewriter';
const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * An opt-in adapter for a local OpenAI-compatible chat endpoint. It is kept
 * separate from the proxy's normal path so no model call happens unless a
 * loopback URL is explicitly configured.
 */
export class LocalCommentAdapter implements CoverStoryCommentAdapter {
  constructor(
    private readonly endpoint: URL,
    private readonly model: string,
    private readonly apiKey: string | undefined,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async rewriteComment(comment: string, context: CoverStoryCommentAdapterContext): Promise<string | null> {
    const glossary = [...context.plan.commentTerms.entries()]
      .map(([synthetic, original]) => `${synthetic} => ${original}`)
      .join('\n');
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        max_tokens: 160,
        messages: [
          {
            role: 'system',
            content: [
              'Rewrite one source-code comment from a synthetic cover domain into the original project vocabulary.',
              'Return exactly one comment and no markdown fence or explanation.',
              'Preserve the comment style and describe only the same structural operation.',
              `Glossary:\n${glossary}`,
              `Unresolved synthetic terms: ${context.unresolvedTerms.join(', ')}`,
            ].join('\n\n'),
          },
          { role: 'user', content: comment },
        ],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return null;
    return normalizeComment(content);
  }
}

export function createConfiguredLocalCommentAdapter(env: NodeJS.ProcessEnv = process.env): CoverStoryCommentAdapter | undefined {
  const rawEndpoint = env.WARDEN_COVER_STORY_COMMENT_MODEL_URL;
  if (!rawEndpoint) return undefined;

  let endpoint: URL;
  try {
    endpoint = new URL(rawEndpoint);
  } catch {
    return undefined;
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') return undefined;
  const isLoopback = endpoint.hostname === '127.0.0.1' || endpoint.hostname === 'localhost' || endpoint.hostname === '::1';
  if (!isLoopback && env.WARDEN_COVER_STORY_COMMENT_MODEL_ALLOW_REMOTE !== '1') return undefined;

  const timeoutMs = Number(env.WARDEN_COVER_STORY_COMMENT_MODEL_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) return undefined;
  return new LocalCommentAdapter(
    endpoint,
    env.WARDEN_COVER_STORY_COMMENT_MODEL ?? DEFAULT_MODEL,
    env.WARDEN_COVER_STORY_COMMENT_MODEL_KEY,
    timeoutMs,
  );
}

function normalizeComment(content: string): string | null {
  const trimmed = content.trim().replace(/^```(?:typescript|javascript|ts|js)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (trimmed.startsWith('//') && !trimmed.includes('\n')) return trimmed;
  if (trimmed.startsWith('/*') && trimmed.endsWith('*/')) return trimmed;
  return null;
}
