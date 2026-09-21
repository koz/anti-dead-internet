import { defineContentScript } from "#imports";
import { browser } from "wxt/browser";
import { actionForScore } from "../../lib/classification";
import type {
  ExtensionMessage,
  ExtensionResponse,
  ExtensionState,
} from "../../lib/messages";
import {
  CONFIG_REVISION_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
} from "../../lib/settings";
import {
  extractTweet,
  TWEET_SELECTOR,
  TWEET_TEXT_SELECTOR,
} from "../../lib/tweet-extractor";
import "./style.css";

const MAX_CONCURRENT_REQUESTS = 3;
const MAX_CACHE_ENTRIES = 500;
const MAX_FAILURE_CACHE_ENTRIES = 500;
const BADGE_CLASS = "jev-filter-badge";
const HIDDEN_CLASS = "jev-filter-hidden";

interface ArticleRecord {
  fingerprint: string;
  score?: number;
  pending: boolean;
}

interface QueueJob {
  article: HTMLElement;
  fingerprint: string;
  content: string;
  requestId: string;
  generation: number;
}

export default defineContentScript({
  matches: [
    "https://x.com/*",
    "https://*.x.com/*",
    "https://twitter.com/*",
    "https://*.twitter.com/*",
  ],
  runAt: "document_idle",

  async main(ctx) {
    let extensionState = await fetchState();
    let generation = 0;
    let activeRequests = 0;
    let scanTimer: number | undefined;
    let requestSequence = 0;
    let stateRefreshSequence = 0;
    let stateRetryTimer: number | undefined;
    let queue: QueueJob[] = [];

    const records = new Map<HTMLElement, ArticleRecord>();
    const scoreCache = new Map<string, number>();
    const failureCache = new Set<string>();
    const pendingFingerprints = new Map<string, number>();

    const applyRecord = (article: HTMLElement, record: ArticleRecord): void => {
      if (record.score === undefined || !extensionState) return;

      const action = actionForScore(record.score, extensionState.settings);
      if (action === "hide") {
        removeBadge(article);
        article.classList.add(HIDDEN_CLASS);
        return;
      }

      if (action === "badge" || action === "score") {
        article.classList.remove(HIDDEN_CLASS);
        const existing = article.querySelector<HTMLElement>(`.${BADGE_CLASS}`);
        if (
          existing?.dataset.score === String(record.score) &&
          existing.dataset.variant === action
        ) {
          return;
        }
        removeBadge(article);
        addBadge(article, record.score, action);
        return;
      }

      clearArticleUi(article);
    };

    const drainQueue = (): void => {
      while (
        extensionState?.hasApiKey &&
        extensionState.settings.enabled &&
        activeRequests < MAX_CONCURRENT_REQUESTS &&
        queue.length > 0
      ) {
        const job = queue.shift();
        if (!job) break;

        const record = records.get(job.article);
        if (
          job.generation !== generation ||
          !record ||
          record.fingerprint !== job.fingerprint ||
          !job.article.isConnected
        ) {
          if (pendingFingerprints.get(job.fingerprint) === job.generation) {
            pendingFingerprints.delete(job.fingerprint);
          }
          for (const candidate of records.values()) {
            if (candidate.fingerprint === job.fingerprint) candidate.pending = false;
          }
          scheduleScan();
          continue;
        }

        activeRequests += 1;
        void classify(job)
          .then((result) => {
            if (job.generation !== generation) return;
            if (result.retryDelay !== undefined) {
              for (const record of records.values()) {
                if (record.fingerprint === job.fingerprint) record.pending = false;
              }
              ctx.setTimeout(scheduleScan, result.retryDelay);
              return;
            }

            if (result.ignored) return;

            if (result.score === null) {
              rememberFailure(failureCache, job.fingerprint);
              for (const record of records.values()) {
                if (record.fingerprint === job.fingerprint) record.pending = false;
              }
              return;
            }

            failureCache.delete(job.fingerprint);
            setCachedScore(scoreCache, job.fingerprint, result.score);
            for (const [article, current] of records) {
              if (current.fingerprint !== job.fingerprint) continue;
              current.pending = false;
              current.score = result.score;
              applyRecord(article, current);
            }
          })
          .finally(() => {
            const current = records.get(job.article);
            if (
              job.generation === generation &&
              current?.fingerprint === job.fingerprint
            ) {
              current.pending = false;
            }
            if (pendingFingerprints.get(job.fingerprint) === job.generation) {
              pendingFingerprints.delete(job.fingerprint);
            }
            activeRequests -= 1;
            drainQueue();
          });
      }
    };

    const processArticle = (article: HTMLElement): void => {
      if (!extensionState?.hasApiKey || !extensionState.settings.enabled) return;

      const tweet = extractTweet(article);
      if (!tweet) {
        if (records.has(article)) {
          clearArticleUi(article);
          records.delete(article);
        }
        return;
      }

      const existing = records.get(article);
      if (existing && existing.fingerprint !== tweet.fingerprint) {
        clearArticleUi(article);
        records.delete(article);
      } else if (existing) {
        applyRecord(article, existing);
        if (existing.score !== undefined || existing.pending) return;
      }

      const cachedScore = scoreCache.get(tweet.fingerprint);
      const record: ArticleRecord = {
        fingerprint: tweet.fingerprint,
        score: cachedScore,
        pending: false,
      };
      records.set(article, record);

      if (cachedScore !== undefined) {
        applyRecord(article, record);
        return;
      }

      if (failureCache.has(tweet.fingerprint)) return;

      record.pending = true;
      if (pendingFingerprints.get(tweet.fingerprint) === generation) return;
      pendingFingerprints.set(tweet.fingerprint, generation);
      queue.push({
        article,
        fingerprint: tweet.fingerprint,
        content: tweet.content,
        requestId: `${Date.now().toString(36)}-${++requestSequence}`,
        generation,
      });
      drainQueue();
    };

    const scan = (): void => {
      scanTimer = undefined;
      for (const [article] of records) {
        if (!article.isConnected) records.delete(article);
      }
      document.querySelectorAll<HTMLElement>(TWEET_SELECTOR).forEach(processArticle);
    };

    const scheduleScan = (): void => {
      if (scanTimer !== undefined) return;
      scanTimer = ctx.setTimeout(scan, 50);
    };

    const deactivate = (): void => {
      generation += 1;
      queue = [];
      pendingFingerprints.clear();
      for (const [article, record] of records) {
        record.pending = false;
        clearArticleUi(article);
      }
      void sendMessage({ type: "CANCEL_CLASSIFICATIONS" });
    };

    const scheduleStateRefresh = (): void => {
      if (stateRetryTimer !== undefined) return;
      stateRetryTimer = ctx.setTimeout(() => {
        stateRetryTimer = undefined;
        void refreshState();
      }, 1_000);
    };

    const refreshState = async (): Promise<void> => {
      const refreshSequence = ++stateRefreshSequence;
      const previous = extensionState;
      const refreshedState = await fetchState();
      if (refreshSequence !== stateRefreshSequence) return;
      if (!refreshedState) {
        scheduleStateRefresh();
        return;
      }
      extensionState = refreshedState;

      if (!extensionState?.hasApiKey || !extensionState.settings.enabled) {
        deactivate();
        return;
      }

      const classificationChanged =
        previous !== null &&
        (previous.settings.customQuestion !== extensionState.settings.customQuestion ||
          previous.settings.customYesCriteria !== extensionState.settings.customYesCriteria ||
          previous.settings.customNoCriteria !== extensionState.settings.customNoCriteria);

      if (classificationChanged) {
        generation += 1;
        queue = [];
        scoreCache.clear();
        failureCache.clear();
        pendingFingerprints.clear();
        for (const [article, record] of records) {
          record.pending = false;
          record.score = undefined;
          clearArticleUi(article);
        }
        void sendMessage({ type: "CANCEL_CLASSIFICATIONS" });
      } else if (!previous?.hasApiKey || !previous.settings.enabled) {
        generation += 1;
      }
      for (const [article, record] of records) applyRecord(article, record);
      scheduleScan();
    };

    const observer = new MutationObserver((mutations) => {
      if (!extensionState?.hasApiKey || !extensionState.settings.enabled) return;
      for (const mutation of mutations) {
        scheduleScan();
        break;
      }
    });

    const observeTimeline = (): void => {
      observer.observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    };

    observeTimeline();

    const handleStorageChange = (
      changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
      areaName: string,
    ): void => {
      if (
        areaName === "sync" &&
        (SETTINGS_STORAGE_KEY in changes || CONFIG_REVISION_STORAGE_KEY in changes)
      ) {
        void refreshState();
      }
    };

    const handlePageHide = (event: PageTransitionEvent): void => {
      observer.disconnect();
      deactivate();
      if (!event.persisted) browser.storage.onChanged.removeListener(handleStorageChange);
    };

    const handlePageShow = (event: PageTransitionEvent): void => {
      if (!event.persisted) return;
      observeTimeline();
      void refreshState();
    };

    browser.storage.onChanged.addListener(handleStorageChange);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);

    if (extensionState?.hasApiKey && extensionState.settings.enabled) scan();
    else if (!extensionState) scheduleStateRefresh();
  },
});

async function fetchState(): Promise<ExtensionState | null> {
  const response = await sendMessage({ type: "GET_EXTENSION_STATE" });
  if (!response.ok || !response.state) return null;
  return response.state;
}

async function classify(
  job: QueueJob,
): Promise<{ score: number | null; ignored: boolean; retryDelay?: number }> {
  const response = await sendMessage({
    type: "CLASSIFY_TWEET",
    requestId: job.requestId,
    content: job.content,
  });
  if (response.ok && typeof response.score === "number") {
    return { score: response.score, ignored: false };
  }
  if (!response.ok && response.code === "BUSY") {
    return { score: null, ignored: false, retryDelay: 500 };
  }
  return {
    score: null,
    ignored:
      !response.ok &&
      (response.code === "CANCELLED" || response.code === "INACTIVE"),
  };
}

async function sendMessage(message: ExtensionMessage): Promise<ExtensionResponse> {
  try {
    return (await browser.runtime.sendMessage(message)) as ExtensionResponse;
  } catch {
    return { ok: false, error: "The extension background service is unavailable." };
  }
}

function addBadge(article: HTMLElement, score: number, variant: "badge" | "score"): void {
  const textElement = article.querySelector<HTMLElement>(TWEET_TEXT_SELECTOR);
  if (!textElement) return;

  const badge = document.createElement("span");
  const percentage = Math.round(score * 100);
  const label = document.createElement("span");
  const divider = document.createElement("span");
  const scoreValue = document.createElement("span");

  badge.className = BADGE_CLASS;
  badge.classList.toggle("jev-filter-badge-score", variant === "score");
  badge.dataset.score = String(score);
  badge.dataset.variant = variant;

  label.className = "jev-filter-badge-label";
  label.textContent = variant === "badge" ? "AI Generated" : "AI Score";

  divider.className = "jev-filter-badge-divider";
  divider.textContent = "·";
  divider.setAttribute("aria-hidden", "true");

  scoreValue.className = "jev-filter-badge-value";
  scoreValue.textContent = `${percentage}%`;

  badge.append(label, divider, scoreValue);
  badge.title = `JEV estimated a ${percentage}% probability that the substantive wording was AI-generated.`;
  badge.setAttribute("aria-label", badge.title);
  textElement.insertAdjacentElement("beforebegin", badge);
}

function clearArticleUi(article: HTMLElement): void {
  article.classList.remove(HIDDEN_CLASS);
  removeBadge(article);
}

function removeBadge(article: HTMLElement): void {
  article.querySelectorAll(`.${BADGE_CLASS}`).forEach((badge) => badge.remove());
}

function setCachedScore(
  cache: Map<string, number>,
  fingerprint: string,
  score: number,
): void {
  cache.delete(fingerprint);
  cache.set(fingerprint, score);
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

function rememberFailure(cache: Set<string>, fingerprint: string): void {
  cache.delete(fingerprint);
  cache.add(fingerprint);

  if (cache.size > MAX_FAILURE_CACHE_ENTRIES) {
    const oldest = cache.values().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}
