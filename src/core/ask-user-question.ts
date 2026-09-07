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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeOptionForSchema(raw: unknown): AskOption {
  if (typeof raw === "string") return { label: raw };

  const record = asRecord(raw);
  if (!record) return { label: String(raw) };

  const label =
    stringOrUndefined(record.label) ??
    stringOrUndefined(record.value) ??
    stringOrUndefined(record.title) ??
    stringOrUndefined(record.name) ??
    "Option";

  return {
    label,
    description:
      stringOrUndefined(record.description) ?? stringOrUndefined(record.desc),
    preview: stringOrUndefined(record.preview),
    value: stringOrUndefined(record.value),
  };
}

function normalizeQuestionForSchema(raw: unknown, index: number): QuestionItem {
  const record = asRecord(raw) ?? {};
  const rawOptions = Array.isArray(record.options)
    ? record.options
    : Array.isArray(record.choices)
      ? record.choices
      : [];

  const options = rawOptions.map(normalizeOptionForSchema);

  return {
    question:
      stringOrUndefined(record.question) ??
      stringOrUndefined(record.prompt) ??
      stringOrUndefined(record.text) ??
      `Question ${index + 1}`,
    header:
      stringOrUndefined(record.header) ??
      stringOrUndefined(record.label) ??
      stringOrUndefined(record.title) ??
      `Q${index + 1}`,
    options,
    multiSelect:
      booleanOrUndefined(record.multiSelect) ??
      booleanOrUndefined(record.multi_select) ??
      booleanOrUndefined(record.multiple),
    allowOther:
      booleanOrUndefined(record.allowOther) ??
      booleanOrUndefined(record.allow_other) ??
      booleanOrUndefined(record.other),
  };
}

export function prepareAskUserQuestionArgs(args: unknown): {
  questions: QuestionItem[];
} {
  const record = asRecord(args) ?? {};
  const rawQuestions = Array.isArray(record.questions)
    ? record.questions
    : [record];
  return { questions: rawQuestions.map(normalizeQuestionForSchema) };
}

export function normalizeQuestions(params: unknown): NormalizedQuestion[] {
  const prepared = prepareAskUserQuestionArgs(params);
  return prepared.questions.map((question, index) => {
    const options = question.options.map((option) => ({ ...option }));
    return {
      question: question.question.trim() || `Question ${index + 1}`,
      header: (question.header?.trim() || `Q${index + 1}`).slice(0, 24),
      options,
      multiSelect: question.multiSelect === true,
      allowOther: options.length === 0 ? true : question.allowOther !== false,
    };
  });
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
