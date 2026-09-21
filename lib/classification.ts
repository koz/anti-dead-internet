import {
  CONFIDENCE_THRESHOLDS,
  type ExtensionSettings,
} from "./settings";

export type TweetAction = "none" | "score" | "badge" | "hide";

export function actionForScore(
  score: number,
  settings: ExtensionSettings,
): TweetAction {
  if (!settings.enabled) return "none";

  if (score < CONFIDENCE_THRESHOLDS[settings.confidence]) {
    return settings.showScores ? "score" : "none";
  }

  return settings.autoHide ? "hide" : "badge";
}
