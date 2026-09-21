import { describe, expect, it } from "vitest";
import { actionForScore } from "../lib/classification";
import { DEFAULT_SETTINGS, type ExtensionSettings } from "../lib/settings";

function settings(
  confidence: ExtensionSettings["confidence"],
  overrides: Partial<ExtensionSettings> = {},
): ExtensionSettings {
  return {
    enabled: true,
    confidence,
    autoHide: false,
    showScores: false,
    customQuestion: DEFAULT_SETTINGS.customQuestion,
    customYesCriteria: DEFAULT_SETTINGS.customYesCriteria,
    customNoCriteria: DEFAULT_SETTINGS.customNoCriteria,
    ...overrides,
  };
}

describe("actionForScore", () => {
  it.each([
    ["low", 0.29, "none"],
    ["low", 0.3, "badge"],
    ["medium", 0.49, "none"],
    ["medium", 0.5, "badge"],
    ["high", 0.79, "none"],
    ["high", 0.8, "badge"],
  ] as const)("uses the %s threshold", (confidence, score, expected) => {
    expect(actionForScore(score, settings(confidence))).toBe(expected);
  });

  it("hides qualifying tweets when auto-hide is enabled", () => {
    expect(actionForScore(0.9, settings("high", { autoHide: true }))).toBe("hide");
  });

  it("shows a neutral score badge below the threshold when enabled", () => {
    expect(actionForScore(0.2, settings("low", { showScores: true }))).toBe("score");
  });

  it("still hides qualifying tweets when all scores are shown", () => {
    expect(
      actionForScore(0.9, settings("high", { autoHide: true, showScores: true })),
    ).toBe("hide");
  });

  it("does nothing while paused", () => {
    expect(actionForScore(1, settings("low", { enabled: false }))).toBe("none");
  });
});
