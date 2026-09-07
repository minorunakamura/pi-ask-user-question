import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerAskUserQuestionTool } from "./ask-user-question";

export function registerTools(pi: ExtensionAPI) {
  registerAskUserQuestionTool(pi);
}
