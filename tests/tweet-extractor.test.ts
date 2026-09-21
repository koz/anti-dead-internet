import { beforeEach, describe, expect, it } from "vitest";
import {
  extractStatusId,
  extractTweet,
  normalizeTweetText,
} from "../lib/tweet-extractor";

describe("tweet extraction", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("extracts normalized text and the first status id", () => {
    const article = document.createElement("article");
    article.dataset.testid = "tweet";
    article.innerHTML = `
      <a href="/author/status/123456789"><time>now</time></a>
      <div data-testid="tweetText">Hello\n  from   X</div>
      <a href="/quoted/status/999"><div data-testid="tweetText">Quoted text</div></a>
    `;

    expect(extractTweet(article)).toEqual({
      id: "123456789",
      content: "Hello from X",
      fingerprint: expect.stringMatching(/^123456789:/),
    });
  });

  it("returns null for posts without substantive text", () => {
    const article = document.createElement("article");
    article.innerHTML = '<div data-testid="tweetText">  \n </div>';
    expect(extractTweet(article)).toBeNull();
  });

  it("does not treat a quote-only post as the outer tweet's wording", () => {
    const article = document.createElement("article");
    article.innerHTML = `
      <a href="/author/status/123"><time>now</time></a>
      <a href="/quoted/status/999"><div data-testid="tweetText">Quoted text</div></a>
    `;
    expect(extractTweet(article)).toBeNull();
  });

  it("preserves a word boundary at HTML line breaks", () => {
    const article = document.createElement("article");
    article.innerHTML = '<div data-testid="tweetText">one<br>two</div>';
    expect(extractTweet(article)?.content).toBe("one two");
  });

  it("uses a content fingerprint when no status link exists", () => {
    const article = document.createElement("article");
    article.innerHTML = '<div data-testid="tweetText">Draft tweet</div>';
    expect(extractTweet(article)?.fingerprint).toMatch(/^text:/);
    expect(extractStatusId(article)).toBeNull();
  });

  it("normalizes all whitespace", () => {
    expect(normalizeTweetText("  one\n\ttwo  ")).toBe("one two");
  });
});
