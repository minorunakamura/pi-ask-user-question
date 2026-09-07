import type {
  AgentToolResult,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import {
  cancelledDetails,
  type AskUserQuestionDetails,
  type NormalizedQuestion,
  successContent,
} from "../core/ask-user-question";
import { createQuestionnaireComponent } from "../ui/ask-user-question";

export async function runQuestionnaire(
  questions: NormalizedQuestion[],
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
): Promise<AgentToolResult<AskUserQuestionDetails>> {
  if (ctx.mode !== "tui") {
    const details = cancelledDetails(questions);
    return {
      content: [
        {
          type: "text",
          text: "Error: ask_user_question requires pi interactive TUI mode; no user input was collected.",
        },
      ],
      details,
    };
  }

  if (questions.length === 0) {
    const details = cancelledDetails([]);
    return {
      content: [{ type: "text", text: "Error: no questions were provided." }],
      details,
    };
  }

  const result = await ctx.ui.custom<AskUserQuestionDetails>(
    (tui, theme, _keybindings, done) =>
      createQuestionnaireComponent(tui, theme, questions, signal, done),
  );

  if (result.cancelled) {
    return {
      content: [{ type: "text", text: "User cancelled the question prompt." }],
      details: result,
    };
  }

  return {
    content: [{ type: "text", text: successContent(result) }],
    details: result,
  };
}
