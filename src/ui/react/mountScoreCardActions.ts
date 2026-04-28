// @ts-nocheck
import { createElement } from "react";
/*
 * Mount helper for the score-card action row. Same pattern as the
 * shop and achievements helpers: ui.ts holds the state (reviveCost,
 * reviveKey, shareLabel, handlers), calls refreshScoreCardActions on
 * every mutation, and the component renders from the passed props.
 */
import { createRoot, type Root } from "react-dom/client";
import { ScoreCardActions, type ScoreCardActionsProps } from "./ScoreCardActions";

let root: Root | null = null;

export function refreshScoreCardActions(props: ScoreCardActionsProps): void {
  const host = document.getElementById("score-card-actions-root");
  if (!host) return;
  if (!root) root = createRoot(host);
  root.render(createElement(ScoreCardActions, props));
}
