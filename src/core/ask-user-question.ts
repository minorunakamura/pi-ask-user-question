import { Type } from "typebox";

export type AnswerValue = string | string[];

export interface AskOption {
  label: string;
  description?: string;
  preview?: string;
  value?: string;
}

export interface QuestionItem {
  question: string;
  header?: string;
  options: AskOption[];
  multiSelect?: boolean;
  allowOther?: boolean;
}

export interface NormalizedQuestion {
  question: string;
  header: string;
  options: AskOption[];
  multiSelect: boolean;
  allowOther: boolean;
}

export interface AnswerDetail {
  question: string;
  header: string;
  value: AnswerValue;
  labels: string[];
  customText?: string;
  selectedIndices: number[];
}

export interface AskUserQuestionDetails {
  questions: NormalizedQuestion[];
  answers: Record<string, AnswerValue>;
  selections: AnswerDetail[];
  cancelled: boolean;
  response?: string;
}

export interface StoredAnswer {
  selectedIndices: number[];
  customText?: string;
}

export const AskOptionSchema = Type.Object({
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

export const QuestionSchema = Type.Object({
  question: Type.String({
    description: "The full question text to display to the user",
  }),
  header: Type.Optional(
    Type.String({ description: "Short tab label, e.g. 'Format' or 'Scope'" }),
  ),
  options: Type.Array(AskOptionSchema, {
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

export const AskUserQuestionParamsSchema = Type.Object({
  questions: Type.Array(QuestionSchema, {
    description: "Questions to ask. Prefer 1-4 focused questions.",
  }),
});

export interface AskUserQuestionValidationError {
  code: "invalid-request";
  message: string;
  path?: string;
}

export type AskUserQuestionValidationResult =
  | { ok: true; questions: NormalizedQuestion[] }
  | { ok: false; error: AskUserQuestionValidationError };

export type QuestionnaireStatus =
  | "answered"
  | "user-cancelled"
  | "caller-aborted"
  | "shutdown";

export interface QuestionnaireSuccess {
  status: QuestionnaireStatus;
  details: AskUserQuestionDetails;
}

export interface QuestionnaireFailure {
  status: "failed";
  error: {
    code: "invalid-request" | "tui-unavailable" | "internal-error";
    message: string;
  };
  details: AskUserQuestionDetails;
}

export type QuestionnaireExecutionResult =
  | QuestionnaireSuccess
  | QuestionnaireFailure;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function prepareOptionForSchema(raw: unknown): AskOption {
  if (typeof raw === "string") return { label: raw };

  const record = asRecord(raw);
  if (!record) return raw as unknown as AskOption;

  const prepared: Record<string, unknown> = { ...record };
  if (!("label" in prepared)) {
    const alias = prepared.value ?? prepared.title ?? prepared.name;
    if (alias !== undefined) prepared.label = alias;
  }
  if (!("description" in prepared) && "desc" in prepared) {
    prepared.description = prepared.desc;
  }
  delete prepared.desc;
  delete prepared.title;
  delete prepared.name;
  return prepared as unknown as AskOption;
}

function prepareQuestionForSchema(raw: unknown): QuestionItem {
  const record = asRecord(raw) ?? {};
  const prepared: Record<string, unknown> = { ...record };

  if (!("question" in prepared)) {
    for (const alias of ["prompt", "text"]) {
      if (alias in prepared) {
        prepared.question = prepared[alias];
        break;
      }
    }
  }
  delete prepared.prompt;
  delete prepared.text;

  if (!("header" in prepared)) {
    for (const alias of ["label", "title"]) {
      if (alias in prepared) {
        prepared.header = prepared[alias];
        break;
      }
    }
  }
  delete prepared.label;
  delete prepared.title;

  if ("options" in prepared && Array.isArray(prepared.options)) {
    prepared.options = prepared.options.map(prepareOptionForSchema);
  } else if (!("options" in prepared) && Array.isArray(prepared.choices)) {
    prepared.options = prepared.choices.map(prepareOptionForSchema);
  }
  delete prepared.choices;

  if (!("multiSelect" in prepared)) {
    for (const alias of ["multi_select", "multiple"]) {
      if (alias in prepared) {
        prepared.multiSelect = prepared[alias];
        break;
      }
    }
  }
  delete prepared.multi_select;
  delete prepared.multiple;

  if (!("allowOther" in prepared)) {
    for (const alias of ["allow_other", "other"]) {
      if (alias in prepared) {
        prepared.allowOther = prepared[alias];
        break;
      }
    }
  }
  delete prepared.allow_other;
  delete prepared.other;

  return prepared as unknown as QuestionItem;
}

export function prepareAskUserQuestionArgs(args: unknown): {
  questions: QuestionItem[];
} {
  const record = asRecord(args) ?? {};
  const rawQuestions = Array.isArray(record.questions)
    ? record.questions
    : [record];
  return { questions: rawQuestions.map(prepareQuestionForSchema) };
}

type ValidationFailure = {
  ok: false;
  error: AskUserQuestionValidationError;
};

function invalid(message: string, path?: string): ValidationFailure {
  return { ok: false, error: { code: "invalid-request", message, path } };
}

function readString(
  record: Record<string, unknown>,
  names: string[],
  path: string,
): { value: string | undefined; error?: AskUserQuestionValidationError } {
  for (const name of names) {
    if (!(name in record) || record[name] === undefined) continue;
    if (typeof record[name] !== "string") {
      return {
        value: undefined,
        error: {
          code: "invalid-request",
          message: `${path}.${name} must be a string`,
          path: `${path}.${name}`,
        },
      };
    }
    return { value: record[name] };
  }
  return { value: undefined };
}

function readBoolean(
  record: Record<string, unknown>,
  names: string[],
  path: string,
): { value: boolean | undefined; error?: AskUserQuestionValidationError } {
  for (const name of names) {
    if (!(name in record) || record[name] === undefined) continue;
    if (typeof record[name] !== "boolean") {
      return {
        value: undefined,
        error: {
          code: "invalid-request",
          message: `${path}.${name} must be a boolean`,
          path: `${path}.${name}`,
        },
      };
    }
    return { value: record[name] };
  }
  return { value: undefined };
}

function normalizeOptionStrict(
  raw: unknown,
  questionPath: string,
  optionIndex: number,
):
  | { ok: true; option: AskOption }
  | { ok: false; error: AskUserQuestionValidationError } {
  const optionPath = `${questionPath}.options[${optionIndex}]`;
  const record = typeof raw === "string" ? { label: raw } : asRecord(raw);
  if (!record) {
    return {
      ok: false,
      error: {
        code: "invalid-request",
        message: `${optionPath} must be a string or object`,
        path: optionPath,
      },
    };
  }

  const label = readString(
    record,
    ["label", "value", "title", "name"],
    optionPath,
  );
  if (label.error) return { ok: false, error: label.error };
  if (!label.value?.trim()) {
    return {
      ok: false,
      error: {
        code: "invalid-request",
        message: `${optionPath}.label must not be blank`,
        path: `${optionPath}.label`,
      },
    };
  }

  const description = readString(record, ["description", "desc"], optionPath);
  if (description.error) return { ok: false, error: description.error };
  const preview = readString(record, ["preview"], optionPath);
  if (preview.error) return { ok: false, error: preview.error };
  const value = readString(record, ["value"], optionPath);
  if (value.error) return { ok: false, error: value.error };

  if ("type" in record && record.type !== undefined) {
    return {
      ok: false,
      error: {
        code: "invalid-request",
        message: `${optionPath}.type is unsupported`,
        path: `${optionPath}.type`,
      },
    };
  }

  return {
    ok: true,
    option: {
      label: label.value.trim(),
      description: stringOrUndefined(description.value),
      preview: stringOrUndefined(preview.value),
      value: stringOrUndefined(value.value),
    },
  };
}

function normalizeQuestionStrict(
  raw: unknown,
  index: number,
):
  | { ok: true; question: NormalizedQuestion }
  | { ok: false; error: AskUserQuestionValidationError } {
  const path = `questions[${index}]`;
  const record = asRecord(raw);
  if (!record) return invalid(`${path} must be an object`, path);

  if ("type" in record && record.type !== undefined) {
    return invalid(`${path}.type is unsupported`, `${path}.type`);
  }

  const question = readString(record, ["question", "prompt", "text"], path);
  if (question.error) return { ok: false, error: question.error };
  if (!question.value?.trim()) {
    return invalid(`${path}.question must not be blank`, `${path}.question`);
  }

  const header = readString(record, ["header", "label", "title"], path);
  if (header.error) return { ok: false, error: header.error };

  let rawOptions: unknown[] | undefined;
  if ("options" in record && record.options !== undefined) {
    if (!Array.isArray(record.options)) {
      return invalid(`${path}.options must be an array`, `${path}.options`);
    }
    rawOptions = record.options;
  } else if ("choices" in record && record.choices !== undefined) {
    if (!Array.isArray(record.choices)) {
      return invalid(`${path}.choices must be an array`, `${path}.choices`);
    }
    rawOptions = record.choices;
  } else {
    return invalid(`${path}.options is required`, `${path}.options`);
  }

  const options: AskOption[] = [];
  for (let optionIndex = 0; optionIndex < rawOptions.length; optionIndex += 1) {
    const result = normalizeOptionStrict(
      rawOptions[optionIndex],
      path,
      optionIndex,
    );
    if (!result.ok) return result;
    options.push(result.option);
  }

  const multiSelect = readBoolean(
    record,
    ["multiSelect", "multi_select", "multiple"],
    path,
  );
  if (multiSelect.error) return { ok: false, error: multiSelect.error };

  const allowOther = readBoolean(
    record,
    ["allowOther", "allow_other", "other"],
    path,
  );
  if (allowOther.error) return { ok: false, error: allowOther.error };

  return {
    ok: true,
    question: {
      question: question.value.trim(),
      header: (header.value?.trim() || `Q${index + 1}`).slice(0, 24),
      options,
      multiSelect: multiSelect.value === true,
      allowOther: options.length === 0 || allowOther.value !== false,
    },
  };
}

function normalizeQuestionItems(
  rawQuestions: unknown[],
): AskUserQuestionValidationResult {
  if (rawQuestions.length === 0) {
    return invalid("At least one question is required", "questions");
  }

  const questions: NormalizedQuestion[] = [];
  const identifiers = new Set<string>();
  for (let index = 0; index < rawQuestions.length; index += 1) {
    const result = normalizeQuestionStrict(rawQuestions[index], index);
    if (!result.ok) return result;
    if (identifiers.has(result.question.question)) {
      return invalid(
        `Duplicate question identifier: ${result.question.question}`,
        `questions[${index}].question`,
      );
    }
    identifiers.add(result.question.question);
    questions.push(result.question);
  }
  return { ok: true, questions };
}

export function validateAndNormalizeQuestions(
  params: unknown,
): AskUserQuestionValidationResult {
  const record = asRecord(params);
  if (!record) return invalid("Request must be an object");
  if (!Array.isArray(record.questions)) {
    return invalid("questions must be an array", "questions");
  }
  return normalizeQuestionItems(record.questions);
}

export function normalizeQuestions(params: unknown): NormalizedQuestion[] {
  const record = asRecord(params);
  const prepared =
    record && Array.isArray(record.questions)
      ? params
      : prepareAskUserQuestionArgs(params);
  const result = validateAndNormalizeQuestions(prepared);
  return result.ok ? result.questions : [];
}

export function labelsForAnswer(
  question: NormalizedQuestion,
  answer: StoredAnswer,
): string[] {
  const labels = answer.selectedIndices
    .map((index) => question.options[index]?.label)
    .filter(
      (label): label is string => typeof label === "string" && label.length > 0,
    );

  if (answer.customText?.trim()) labels.push(answer.customText.trim());
  return labels;
}

export function isAnswered(
  question: NormalizedQuestion,
  answer: StoredAnswer | undefined,
): boolean {
  if (!answer) return false;
  return labelsForAnswer(question, answer).length > 0;
}

export function buildDetails(
  questions: NormalizedQuestion[],
  answersByIndex: Map<number, StoredAnswer>,
  cancelled: boolean,
): AskUserQuestionDetails {
  const answers: Record<string, AnswerValue> = {};
  const selections: AnswerDetail[] = [];

  questions.forEach((question, index) => {
    const stored = answersByIndex.get(index);
    if (!stored) return;

    const labels = labelsForAnswer(question, stored);
    if (labels.length === 0) return;

    const value: AnswerValue = question.multiSelect ? labels : labels[0];
    answers[question.question] = value;
    selections.push({
      question: question.question,
      header: question.header,
      value,
      labels,
      customText: stored.customText,
      selectedIndices: stored.selectedIndices.map(
        (selectedIndex) => selectedIndex + 1,
      ),
    });
  });

  return { questions, answers, selections, cancelled };
}

export function cancelledDetails(
  questions: NormalizedQuestion[],
  answersByIndex = new Map<number, StoredAnswer>(),
): AskUserQuestionDetails {
  return buildDetails(questions, answersByIndex, true);
}

export function formatAnswerLines(details: AskUserQuestionDetails): string[] {
  if (details.selections.length === 0) return ["No answers were provided."];
  return details.selections.map((selection) => {
    const value = Array.isArray(selection.value)
      ? selection.value.join(", ")
      : selection.value;
    return `- ${selection.question} → ${value}`;
  });
}

export function successContent(details: AskUserQuestionDetails): string {
  return [
    "User answered:",
    ...formatAnswerLines(details),
    "",
    "Structured answers JSON:",
    JSON.stringify({ answers: details.answers }, null, 2),
  ].join("\n");
}
