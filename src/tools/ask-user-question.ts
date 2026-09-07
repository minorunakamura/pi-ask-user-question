import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  normalizeQuestions,
  prepareAskUserQuestionArgs,
} from "../core/ask-user-question";
import { runQuestionnaire } from "../runtime/run-questionnaire";
import { renderToolCall, renderToolResult } from "../ui/ask-user-question";

const OptionSchema = Type.Object({
  label: Type.String({ description: "Display label for this option" }),
  description: Type.Optional(
    Type.String({ description: "Short explanation shown under the label" }),
  ),
  preview: Type.Optional(
    Type.String({
      description:
        "Optional markdown/html/text preview. Rendered as plain text in pi.",
    }),
  ),
  value: Type.Optional(
    Type.String({
      description:
        "Optional machine value. The returned answer still uses label text.",
    }),
  ),
});

const QuestionSchema = Type.Object({
  question: Type.String({
    description: "The full question text to display to the user",
  }),
  header: Type.Optional(
    Type.String({ description: "Short tab label, e.g. 'Format' or 'Scope'" }),
  ),
  options: Type.Array(OptionSchema, {
    description:
      "Answer choices. Use 2-4 concise options when possible. Leave empty only when free-form input is required.",
  }),
  multiSelect: Type.Optional(
    Type.Boolean({ description: "Allow the user to select multiple options" }),
  ),
  allowOther: Type.Optional(
    Type.Boolean({
      description: "Add a free-text 'Other' option (default: true)",
    }),
  ),
});

const AskUserQuestionParams = Type.Object({
  questions: Type.Array(QuestionSchema, {
    description: "Questions to ask. Prefer 1-4 focused questions.",
  }),
});

export function registerAskUserQuestionTool(pi: ExtensionAPI) {
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
    parameters: AskUserQuestionParams,
    executionMode: "sequential",
    prepareArguments: prepareAskUserQuestionArgs,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return runQuestionnaire(normalizeQuestions(params), signal, ctx);
    },
    renderCall: renderToolCall,
    renderResult: renderToolResult,
  });
}
