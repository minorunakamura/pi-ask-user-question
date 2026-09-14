import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerAskUserQuestionEvents } from "./runtime/event-adapter";
import { QuestionnaireService } from "./runtime/questionnaire-service";
import { registerTools } from "./tools";

export * from "./api";

export default function extension(pi: ExtensionAPI) {
  const service = new QuestionnaireService();
  registerTools(pi, service);
  registerAskUserQuestionEvents(pi, service);
}
