import type {
  AgentToolResult,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  Text,
  type Component,
  type TUI,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import {
  buildDetails,
  isAnswered,
  labelsForAnswer,
  normalizeQuestions,
  type AskUserQuestionDetails,
  type NormalizedQuestion,
  type StoredAnswer,
} from "../core/ask-user-question";

type RenderOption =
  | {
      kind: "option";
      option: NormalizedQuestion["options"][number];
      optionIndex: number;
    }
  | { kind: "other"; option: NormalizedQuestion["options"][number] };

export function createQuestionnaireComponent(
  tui: TUI,
  theme: Theme,
  questions: NormalizedQuestion[],
  signal: AbortSignal | undefined,
  done: (result: AskUserQuestionDetails) => void,
): Component & { dispose(): void } {
  const hasMultiSelect = questions.some((question) => question.multiSelect);
  const showTabs = questions.length > 1 || hasMultiSelect;
  const submitTabIndex = questions.length;
  const totalTabs = questions.length + (showTabs ? 1 : 0);
  const answersByIndex = new Map<number, StoredAnswer>();
  let abortHandler: (() => void) | undefined;

  let currentTab = 0;
  let optionIndex = 0;
  let inputMode = false;
  let inputQuestionIndex: number | null = null;
  let cachedLines: string[] | undefined;

  const editorTheme: EditorTheme = {
    borderColor: (text) => theme.fg("accent", text),
    selectList: {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    },
  };
  const editor = new Editor(tui, editorTheme);

  function currentQuestion(): NormalizedQuestion | undefined {
    return questions[currentTab];
  }

  function currentAnswer(): StoredAnswer | undefined {
    return answersByIndex.get(currentTab);
  }

  function allAnswered(): boolean {
    return questions.every((question, index) =>
      isAnswered(question, answersByIndex.get(index)),
    );
  }

  function refresh() {
    cachedLines = undefined;
    tui.requestRender();
  }

  function submit(cancelled: boolean) {
    done(buildDetails(questions, answersByIndex, cancelled));
  }

  function advanceAfterAnswer() {
    if (!showTabs) {
      submit(false);
      return;
    }

    if (currentTab < questions.length - 1) {
      currentTab += 1;
    } else {
      currentTab = submitTabIndex;
    }
    optionIndex = 0;
    refresh();
  }

  function setSingleAnswer(questionIndex: number, answer: StoredAnswer) {
    answersByIndex.set(questionIndex, answer);
    advanceAfterAnswer();
  }

  function getRenderOptions(question: NormalizedQuestion): RenderOption[] {
    const options: RenderOption[] = question.options.map((option, index) => ({
      kind: "option",
      option,
      optionIndex: index,
    }));

    if (question.allowOther) {
      options.push({
        kind: "other",
        option: { label: "Other / type a custom answer" },
      });
    }

    return options;
  }

  function toggleMultiAnswer(questionIndex: number, option: RenderOption) {
    const existing = answersByIndex.get(questionIndex) ?? {
      selectedIndices: [],
    };
    if (option.kind === "other") {
      inputMode = true;
      inputQuestionIndex = questionIndex;
      editor.setText(existing.customText ?? "");
      refresh();
      return;
    }

    const selected = new Set(existing.selectedIndices);
    if (selected.has(option.optionIndex)) {
      selected.delete(option.optionIndex);
    } else {
      selected.add(option.optionIndex);
    }

    answersByIndex.set(questionIndex, {
      ...existing,
      selectedIndices: Array.from(selected).toSorted((a, b) => a - b),
    });
    refresh();
  }

  editor.onSubmit = (value) => {
    if (inputQuestionIndex === null) return;
    const trimmed = value.trim();
    const question = questions[inputQuestionIndex];

    if (!trimmed) {
      inputMode = false;
      inputQuestionIndex = null;
      editor.setText("");
      refresh();
      return;
    }

    const existing = answersByIndex.get(inputQuestionIndex) ?? {
      selectedIndices: [],
    };
    answersByIndex.set(inputQuestionIndex, {
      selectedIndices: question.multiSelect ? existing.selectedIndices : [],
      customText: trimmed,
    });

    inputMode = false;
    inputQuestionIndex = null;
    editor.setText("");
    advanceAfterAnswer();
  };

  function handleInput(data: string) {
    if (inputMode) {
      if (matchesKey(data, Key.escape)) {
        inputMode = false;
        inputQuestionIndex = null;
        editor.setText("");
        refresh();
        return;
      }
      editor.handleInput(data);
      refresh();
      return;
    }

    if (showTabs) {
      if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
        currentTab = (currentTab + 1) % totalTabs;
        optionIndex = 0;
        refresh();
        return;
      }
      if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
        currentTab = (currentTab - 1 + totalTabs) % totalTabs;
        optionIndex = 0;
        refresh();
        return;
      }
    }

    if (showTabs && currentTab === submitTabIndex) {
      if (matchesKey(data, Key.enter) && allAnswered()) {
        submit(false);
        return;
      }
      if (matchesKey(data, Key.escape)) {
        submit(true);
      }
      return;
    }

    const question = currentQuestion();
    if (!question) return;
    const options = getRenderOptions(question);

    if (matchesKey(data, Key.up)) {
      optionIndex = Math.max(0, optionIndex - 1);
      refresh();
      return;
    }
    if (matchesKey(data, Key.down)) {
      optionIndex = Math.min(options.length - 1, optionIndex + 1);
      refresh();
      return;
    }

    if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
      const option = options[optionIndex];
      if (!option) return;

      if (question.multiSelect) {
        toggleMultiAnswer(currentTab, option);
        return;
      }

      if (option.kind === "other") {
        inputMode = true;
        inputQuestionIndex = currentTab;
        editor.setText(currentAnswer()?.customText ?? "");
        refresh();
        return;
      }

      setSingleAnswer(currentTab, { selectedIndices: [option.optionIndex] });
      return;
    }

    if (matchesKey(data, Key.escape)) {
      submit(true);
    }
  }

  function render(width: number): string[] {
    if (cachedLines) return cachedLines;

    const lines: string[] = [];
    const renderWidth = Math.max(1, width);
    const question = currentQuestion();
    const answer = currentAnswer();

    function addWrapped(text: string) {
      lines.push(...wrapTextWithAnsi(text, renderWidth));
    }

    function addWrappedWithPrefix(prefix: string, text: string) {
      const prefixWidth = visibleWidth(prefix);
      if (prefixWidth >= renderWidth) {
        addWrapped(prefix + text);
        return;
      }
      const wrapped = wrapTextWithAnsi(text, renderWidth - prefixWidth);
      const continuationPrefix = " ".repeat(prefixWidth);
      for (let index = 0; index < wrapped.length; index += 1) {
        lines.push(
          `${index === 0 ? prefix : continuationPrefix}${wrapped[index]}`,
        );
      }
    }

    lines.push(theme.fg("accent", "─".repeat(renderWidth)));

    if (showTabs) {
      const tabs: string[] = ["← "];
      questions.forEach((item, index) => {
        const active = index === currentTab;
        const answered = isAnswered(item, answersByIndex.get(index));
        const marker = answered ? "■" : "□";
        const color = answered ? "success" : "muted";
        const label = ` ${marker} ${item.header} `;
        tabs.push(
          active
            ? theme.bg("selectedBg", theme.fg("text", label))
            : theme.fg(color, label),
        );
        tabs.push(" ");
      });
      const submitLabel = " ✓ Submit ";
      const submitStyled =
        currentTab === submitTabIndex
          ? theme.bg("selectedBg", theme.fg("text", submitLabel))
          : theme.fg(allAnswered() ? "success" : "dim", submitLabel);
      tabs.push(submitStyled, " →");
      addWrappedWithPrefix(" ", tabs.join(""));
      lines.push("");
    }

    function renderOptions(
      item: NormalizedQuestion,
      selectedAnswer: StoredAnswer | undefined,
    ) {
      const options = getRenderOptions(item);
      for (let index = 0; index < options.length; index += 1) {
        const option = options[index];
        const active = index === optionIndex;
        const isOther = option.kind === "other";
        const selected =
          option.kind === "option"
            ? selectedAnswer?.selectedIndices.includes(option.optionIndex) ===
              true
            : Boolean(selectedAnswer?.customText);
        const marker = item.multiSelect
          ? selected
            ? "[x]"
            : "[ ]"
          : selected
            ? "●"
            : "○";
        const prefix = active ? theme.fg("accent", "> ") : "  ";
        const suffix =
          isOther && selectedAnswer?.customText
            ? `: ${selectedAnswer.customText}`
            : "";
        const label = `${marker} ${index + 1}. ${option.option.label}${suffix}${isOther && inputMode ? " ✎" : ""}`;
        const color = active || selected ? "accent" : "text";

        addWrappedWithPrefix(prefix, theme.fg(color, label));
        if (option.option.description) {
          addWrappedWithPrefix(
            "     ",
            theme.fg("muted", option.option.description),
          );
        }
        if (option.option.preview) {
          addWrappedWithPrefix("     ", theme.fg("dim", option.option.preview));
        }
      }
    }

    if (inputMode && inputQuestionIndex !== null) {
      const inputQuestion = questions[inputQuestionIndex];
      addWrappedWithPrefix(" ", theme.fg("text", inputQuestion.question));
      lines.push("");
      renderOptions(inputQuestion, answersByIndex.get(inputQuestionIndex));
      lines.push("");
      addWrappedWithPrefix(" ", theme.fg("muted", "Your custom answer:"));
      for (const line of editor.render(Math.max(1, renderWidth - 2))) {
        lines.push(` ${line}`);
      }
      lines.push("");
      addWrappedWithPrefix(
        " ",
        theme.fg("dim", "Enter to submit custom answer • Esc to go back"),
      );
    } else if (showTabs && currentTab === submitTabIndex) {
      addWrappedWithPrefix(
        " ",
        theme.fg("accent", theme.bold("Ready to submit")),
      );
      lines.push("");
      questions.forEach((item, index) => {
        const stored = answersByIndex.get(index);
        const labels = stored ? labelsForAnswer(item, stored) : [];
        const value =
          labels.length > 0
            ? labels.join(", ")
            : theme.fg("warning", "unanswered");
        addWrappedWithPrefix(
          " ",
          `${theme.fg("muted", `${item.header}: `)}${value}`,
        );
      });
      lines.push("");
      if (allAnswered()) {
        addWrappedWithPrefix(
          " ",
          theme.fg("success", "Press Enter to submit."),
        );
      } else {
        const missing = questions
          .filter((item, index) => !isAnswered(item, answersByIndex.get(index)))
          .map((item) => item.header);
        addWrappedWithPrefix(
          " ",
          theme.fg("warning", `Unanswered: ${missing.join(", ")}`),
        );
      }
    } else if (question) {
      addWrappedWithPrefix(" ", theme.fg("text", question.question));
      lines.push("");
      renderOptions(question, answer);
    }

    lines.push("");
    if (!inputMode) {
      const help = showTabs
        ? "Tab/←→ tabs • ↑↓ options • Enter/Space select • Esc cancel"
        : "↑↓ options • Enter select • Esc cancel";
      addWrappedWithPrefix(" ", theme.fg("dim", help));
    }
    lines.push(theme.fg("accent", "─".repeat(renderWidth)));

    cachedLines = lines;
    return cachedLines;
  }

  abortHandler = () => submit(true);
  if (signal?.aborted) {
    abortHandler();
  } else {
    signal?.addEventListener("abort", abortHandler, { once: true });
  }

  return {
    render,
    invalidate: () => {
      cachedLines = undefined;
    },
    handleInput,
    dispose: () => {
      if (abortHandler) signal?.removeEventListener("abort", abortHandler);
    },
  };
}

export function renderToolCall(args: unknown, theme: Theme): Text {
  const questions = normalizeQuestions(args);
  const label =
    questions.length === 1 ? "1 question" : `${questions.length} questions`;
  let text =
    theme.fg("toolTitle", theme.bold("ask_user_question ")) +
    theme.fg("muted", label);
  if (questions.length > 0) {
    text +=
      "\n" +
      questions
        .map((question, index) =>
          theme.fg("dim", `  ${index + 1}. ${question.question}`),
        )
        .join("\n");
  }
  return new Text(text, 0, 0);
}

export function renderToolResult(
  result: AgentToolResult<AskUserQuestionDetails>,
  _options: ToolRenderResultOptions,
  theme: Theme,
): Text {
  const details = result.details as AskUserQuestionDetails | undefined;
  if (!details) {
    const first = result.content?.[0];
    return new Text(first?.type === "text" ? first.text : "", 0, 0);
  }

  if (details.cancelled) {
    return new Text(theme.fg("warning", "Cancelled"), 0, 0);
  }

  const lines = details.selections.map((selection) => {
    const value = Array.isArray(selection.value)
      ? selection.value.join(", ")
      : selection.value;
    return `${theme.fg("success", "✓ ")}${theme.fg("accent", selection.header)}: ${value}`;
  });
  return new Text(lines.join("\n"), 0, 0);
}
