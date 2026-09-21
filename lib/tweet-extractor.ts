export const TWEET_SELECTOR = 'article[data-testid="tweet"]';
export const TWEET_TEXT_SELECTOR = '[data-testid="tweetText"]';

export interface ExtractedTweet {
  id: string | null;
  content: string;
  fingerprint: string;
}

export function extractTweet(article: HTMLElement): ExtractedTweet | null {
  const id = extractStatusId(article);
  const textElement = Array.from(
    article.querySelectorAll<HTMLElement>(TWEET_TEXT_SELECTOR),
  ).find((candidate) => !belongsToQuotedTweet(candidate, id));
  if (!textElement) return null;

  const clone = textElement.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("br").forEach((breakElement) => breakElement.replaceWith(" "));
  const content = normalizeTweetText(clone.textContent ?? "");
  if (!content) return null;

  return {
    id,
    content,
    fingerprint: `${id ?? "text"}:${hashText(content)}`,
  };
}

function belongsToQuotedTweet(element: HTMLElement, primaryId: string | null): boolean {
  const link = element.closest<HTMLElement>('a[href*="/status/"], [role="link"]');
  if (!link) return false;

  const href =
    link.getAttribute("href") ??
    link.querySelector<HTMLAnchorElement>('a[href*="/status/"]')?.getAttribute("href");
  const linkedId = href?.match(/\/status\/(\d+)/)?.[1];
  return linkedId !== undefined && linkedId !== primaryId;
}

export function normalizeTweetText(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

export function extractStatusId(article: HTMLElement): string | null {
  for (const link of article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')) {
    const id = link.getAttribute("href")?.match(/\/status\/(\d+)/)?.[1];
    if (id) return id;
  }

  return null;
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
}
