import type {
  AgentToolResult,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import {
  cancelledDetails,
  type AskUserQuestionDetails,
  type NormalizedQuestion,
  type QuestionnaireExecutionResult,
  type QuestionnaireFailure,
  type QuestionnaireStatus,
  successContent,
} from "../core/ask-user-question";
import { createQuestionnaireComponent } from "../ui/ask-user-question";

function abortStatus(signal: AbortSignal | undefined): QuestionnaireStatus {
  return signal?.reason === "shutdown" ? "shutdown" : "caller-aborted";
}

function failure(
  questions: NormalizedQuestion[],
  code: QuestionnaireFailure["error"]["code"],
  message: string,
): QuestionnaireFailure {
  return {
    status: "failed",
    error: { code, message },
    details: cancelledDetails(questions),
  };
}

export async function executeQuestionnaire(
  questions: NormalizedQuestion[],
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
  title?: string,
): Promise<QuestionnaireExecutionResult> {
  try {
    if (ctx.mode !== "tui") {
      return failure(
        questions,
        "tui-unavailable",
        "ask_user_question requires pi interactive TUI mode; no user input was collected.",
      );
    }

    if (questions.length === 0) {
      return failure([], "invalid-request", "no questions were provided.");
    }

    if (signal?.aborted) {
      return {
        status: abortStatus(signal),
        details: cancelledDetails(questions),
      };
    }

    const result = await ctx.ui.custom<AskUserQuestionDetails>(
      (tui, theme, _keybindings, done) =>
        createQuestionnaireComponent(
          tui,
          theme,
          questions,
          signal,
          done,
          title,
        ),
    );

    if (!result || typeof result !== "object") {
      return failure(
        questions,
        "internal-error",
        "questionnaire UI did not return a result.",
      );
    }

    if (result.cancelled) {
      return {
        status: signal?.aborted ? abortStatus(signal) : "user-cancelled",
        details: result,
      };
    }

    return { status: "answered", details: result };
  } catch (error) {
    return failure(
      questions,
      "internal-error",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function toToolResult(
  execution: QuestionnaireExecutionResult,
): AgentToolResult<AskUserQuestionDetails> {
  if (execution.status === "failed") {
    const text =
      execution.error.code === "tui-unavailable"
        ? "Error: ask_user_question requires pi interactive TUI mode; no user input was collected."
        : execution.error.code === "invalid-request" &&
            execution.error.message === "no questions were provided."
          ? "Error: no questions were provided."
          : `Error: ${execution.error.message}`;
    return {
      content: [{ type: "text", text }],
      details: execution.details,
    };
  }

  if (execution.status !== "answered") {
    return {
      content: [{ type: "text", text: "User cancelled the question prompt." }],
      details: execution.details,
    };
  }

  return {
    content: [{ type: "text", text: successContent(execution.details) }],
    details: execution.details,
  };
}

export async function runQuestionnaire(
  questions: NormalizedQuestion[],
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
  title?: string,
): Promise<AgentToolResult<AskUserQuestionDetails>> {
  return toToolResult(
    await executeQuestionnaire(questions, signal, ctx, title),
  );
}
