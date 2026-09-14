import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  AskUserQuestionParamsSchema,
  cancelledDetails,
  prepareAskUserQuestionArgs,
  type QuestionnaireFailure,
  validateAndNormalizeQuestions,
} from "../core/ask-user-question";
import { QuestionnaireService } from "../runtime/questionnaire-service";
import { toToolResult } from "../runtime/run-questionnaire";
import { renderToolCall, renderToolResult } from "../ui/ask-user-question";

export function registerAskUserQuestionTool(
  pi: ExtensionAPI,
  service = new QuestionnaireService(),
) {
  pi.registerTool({
    name: "ask_user_question",
    label: "Ask User Question",
    description:
      "Claude AskUserQuestion / Codex ask_user_question equivalent. Ask one or more structured clarifying questions, collect the user's selections, and return an answers object keyed by question text.",
    promptSnippet:
      "Ask the user structured clarifying questions and return selected answers",
    promptGuidelines: [
      "Use ask_user_question when user requirements are ambiguous and you need structured input before proceeding.",
      "Use ask_user_question only after checking files/context that can answer the question; do not ask questions you can resolve yourself.",
      "When using ask_user_question, ask 1-4 focused questions with concise options; set multiSelect for questions where multiple choices may apply.",
      "For a single question, pass one item in the ask_user_question questions array.",
    ],
    parameters: AskUserQuestionParamsSchema,
    executionMode: "sequential",
    prepareArguments: prepareAskUserQuestionArgs,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const validation = validateAndNormalizeQuestions(params);
      if (!validation.ok) {
        const failure: QuestionnaireFailure = {
          status: "failed",
          error: validation.error,
          details: cancelledDetails([]),
        };
        return toToolResult(failure);
      }

      const execution = service.enqueue({
        questions: validation.questions,
        signal,
        ctx,
      });
      return toToolResult(await execution.promise);
    },
    renderCall: renderToolCall,
    renderResult: renderToolResult,
  });

  return service;
}
