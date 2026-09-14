# pi-ask-user-question

構造化された確認質問を `ask_user_question` tool として提供し、同じ Pi process 内の別 Extension からも TUI questionnaire を開始できます。

## 開発

```bash
pnpm install
pnpm test
pnpm check
```

## Pi で読み込む

```bash
pi -e ./src/index.ts
```

## Tool usage

既存の `ask_user_question` Tool は、1つ以上の質問を受け取り、質問文をkeyにした structured answers を返します。

```json
{
  "questions": [
    {
      "question": "どの形式で出力しますか？",
      "header": "Format",
      "options": [
        { "label": "Summary", "description": "短い要約" },
        { "label": "JSON" }
      ],
      "multiSelect": false,
      "allowOther": true
    }
  ]
}
```

既存どおり、`options` が空の場合は free-text answer が使えます。Toolの回答 details は `questions`、`answers`、`selections`、`cancelled` を含みます。TUIでEscを押した場合は従来どおり `cancelled: true` です。

## Extension-to-Extension usage

別 Extension は、同じ Root Pi process の公開 `pi.events` event bus を request/reply transport として利用できます。event名と型は `pi-ask-user-question/api` から参照できます。これは便利な contract import であり、runtime通信は `pi.events` だけで完結します。

```ts
import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AskUserQuestionResponse } from "pi-ask-user-question/api";

// Contract import is optional at runtime; these values may also be kept as local constants.
const REQUEST_EVENT = "pi-ask-user-question:request:v1";
const CANCEL_EVENT = "pi-ask-user-question:cancel:v1";
const replyEvent = (requestId: string) => `pi-ask-user-question:reply:${requestId}`;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("ask-from-extension", {
    description: "Start a questionnaire without an LLM tool call",
    handler: async (_args, ctx) => {
      const requestId = randomUUID();
      const response = await new Promise<AskUserQuestionResponse>((resolve) => {
        const unsubscribe = pi.events.on(replyEvent(requestId), (data) => {
          unsubscribe();
          resolve(data as AskUserQuestionResponse);
        });

        pi.events.emit(REQUEST_EVENT, {
          version: 1,
          requestId,
          title: "Output format",
          questions: [
            {
              question: "どの形式で出力しますか？",
              header: "Format",
              options: [{ label: "Summary" }, { label: "JSON" }],
            },
          ],
        });
      });

      if (!response.success) {
        ctx.ui.notify(`${response.error.code}: ${response.error.message}`, "error");
        return;
      }
      if (response.result.status === "answered") {
        ctx.ui.notify(JSON.stringify(response.result.answers), "info");
      }
    },
  });
}
```

callerが中断する場合は、同じ `requestId` で cancel event を発行します。

```ts
pi.events.emit(CANCEL_EVENT, {
  version: 1,
  requestId,
});
```

`success: true` の `result.status` は `answered`、`user-cancelled`、`caller-aborted`、`shutdown` のいずれかです。失敗は `success: false` で、`error.code` を機械的に判定できます。

## Public contract

- Request event: `pi-ask-user-question:request:v1`
- Cancel event: `pi-ask-user-question:cancel:v1`
- Reply event: `pi-ask-user-question:reply:<requestId>`
- Request: `{ version: 1, requestId, title?, questions }`
- Success response: `{ version: 1, requestId, success: true, result }`
- Error response: `{ version: 1, requestId, success: false, error: { code, message } }`

`questions` は Tool と同じ question model です。正規化済み question text が answer key であるため、同じ questionnaire 内で重複する question text は `invalid-request` になります。対応しない `version`、blank question/option、必須フィールド不足、unsupported `type` も fail closed します。

## Runtime constraints

- programmatic APIは同一Pi process内で利用します。
- questionnaire表示にはTUI-capable context（`ctx.mode === "tui"`）が必要です。
- headless/print contextから直接UIを表示するためのAPIではありません。
- RPC/print/json contextでは `ctx.ui.custom()` を呼び出さず、programmatic requestには `tui-unavailable` を返します。

## Concurrent behavior

interactive UIを競合させないため、Tool requestとprogrammatic requestを共有FIFOで serialize します。active requestが終わるまで後続requestはqueueされ、request自体は失われません。caller cancelまたはsession shutdownでqueue中のrequestもterminal responseになります。

`requestId` はsession内のidempotency keyとして扱われます。同じrequestの再送ではquestionnaireを再実行せず、activeまたはqueuedならoriginal requestの結果を共有し、completedならterminal responseを再送します。terminal responseのcacheはsession内でboundedに保持されます。同じ `requestId` でpayload（`version`、`title`、`questions`）が異なるrequestはconflictとして無視され、original requestを妨げません。

## Cancellation

- HumanがEscで閉じる: `success: true`, `result.status: "user-cancelled"`, `cancelled: true`
- callerがcancel eventを発行する: `success: true`, `result.status: "caller-aborted"`, `cancelled: true`。`cancel:<requestId>` は同じlogical requestを共有する全callerに対してそのlogical request全体をcancelします。
- session shutdown/reload: pending requestへ `success: true`, `result.status: "shutdown"`, `cancelled: true`
- TUI unavailable、invalid request、unsupported version、内部失敗: `success: false` の structured error

Extension reload時は Pi の event-bus cleanup に加えて、この Extensionも pending request、completed response cache、request identity state、listenerを明示的にcleanupします。
