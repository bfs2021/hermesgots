# A call's questions answer as one form, on a host that asks them one at a time

## Goals
- **G1** Pressing the main button on the first of several questions moves to the next question instead of sending; only the last page sends.
- **G2** A question moved to by hand can be answered and sent from there: Send and Skip are never disabled on a page just because Hermes hasn't asked it yet.
- **G3** Once sent, every answer reaches Hermes in order as it asks each question, with no further tap.
- **G4** Hermes records a multi-select answer as the list of choices picked, and a skipped question as skipped.

## Non-goals
- Holding the unsent answers on the plugin, so a page closed mid-drain still delivers them.

## Change map
| Layer | Status | Goals | Tested at |
|---|---|---|---|
| Question card (`components/chat/question-card.tsx`) | changed | G1, G2, G3 | `scripts/test-question-card.tsx` |
| chat-next prompt (`chat-next/app-view.tsx` `AppPrompt`) | changed | G4 | `scripts/test-clarify-questions.mjs` (the value it sends) |
| clarify wire rule (`lib/clarify.ts`, `chat-next/api.ts` `respond`) | changed | G4 | `scripts/test-clarify-questions.mjs`, `scripts/test-chat-next-reads.mjs` |
| Mock Hermes (`scripts/mock-hermes.mjs`) | changed | G4 | `pnpm e2e question-card` |
| Hermes internals drift check (`.github/scripts/check-hermes-internals.py`) | changed | G4 | the script against a v0.23.1 checkout |

## Flows
### F1: the user answers a three-question call in one pass (happy path, changed). Test: "a host that asks one question at a time takes the whole form, sending each answer as it is asked"
```mermaid
sequenceDiagram
  actor User
  participant Card as Question card
  participant Prompt as chat-next prompt
  participant Host as Hermes run route
  Host-->>Prompt: prompt q0
  rect rgb(255, 245, 200)
  User->>Card: pick q0, Next (nothing sent)
  User->>Card: pick q1, Next; type q2, Send
  Card->>Prompt: answer q0
  Prompt->>Host: POST clarify q0
  Host-->>Prompt: prompt q1
  Card->>Prompt: held answer q1 (no tap)
  Prompt->>Host: POST clarify q1 (JSON list if multi)
  Host-->>Prompt: prompt q2
  Card->>Prompt: held answer q2
  Prompt->>Host: POST clarify q2
  end
```

### F2: the user moves ahead by hand before the host asks (edge, changed). Test: "a page ahead of the asked one can be answered and the form sent from it"
Same sequence as F1 from "Send"; the difference is that the user reaches the last page with the arrow while the host still asks q0, and Send and Skip are live there.

### F3: an answer the host refuses mid-drain (edge, new). Test: "an answer the host refuses stops the drain on the asked page, with the rest still filled"
```mermaid
sequenceDiagram
  actor User
  participant Card as Question card
  participant Host as Hermes run route
  User->>Card: Send on the last page
  Card->>Host: POST clarify q0
  Host-->>Card: refused
  Card-->>User: toast; card back on q0, every page still filled, nothing more sent
```

## Steps
1. **Regression tests for the card.** Goals: G1, G2, G3. After: none. Layers: Question card. Check: in `scripts/test-question-card.tsx`, a one-at-a-time card (askedId q0 of three) shows Next on pages 1–2 that sends nothing; a page reached by the arrow ahead of the asked one has Send/Skip live on the last page; Send sends q0 only, and moving the host's askedId to q1 then q2 sends the held answers with no click; a refused answer stops the drain. Red on main (today's card sends on page 1 and disables Send ahead), green after step 2. The two existing tests that pin the old "only the asked page sends / Send disabled ahead" behaviour are rewritten to the new rule.
2. **The card collects the whole form and drains it as the host asks.** Goals: G1, G2, G3. After: 1. Layers: Question card. On a host that asks one at a time the card behaves as the batch form already does: Next on every page but the last, Skip moves on, Send on the last page commits the answers; the card then answers the asked question and, each time the host asks the next one of this call, answers it from what was committed — never while `held`. A refusal clears the commit and the card returns to the asked page with every page still filled. Pages the host has already taken stay disabled. Check: step 1 green, `pnpm test` green, and the live probe against Hermes v0.23.1 (below) walks a three-question call in one pass. Commit message names the cause: the card bound Send and Skip to the page the host was asking.
3. **Send multi-select as a list and a skip as a skip.** Goals: G4. After: none. Layers: chat-next prompt, clarify wire rule, mock, drift check. `AppPrompt` sends a multi-select answer as a JSON array string (Hermes's `_clean_answer` splits only that; a comma join was recorded as one item `["Auth, Search"]`); `respond` sends Hermes's skip sentinel `"\u0000skipped"` for a blank answer (`SKIPPED` in `tools/clarify_gateway.py`; Hermes's run route never maps the word `skip`, so the model was told the user answered "skip"); the reader keeps reading a legacy `skip` answer as skipped for rows already written; the mock reads the sentinel; the sentinel is pinned in the drift check. Check: unit tests for the sent value red then green, `pnpm e2e question-card` green, and the live probe records `["Auth","Search"]` and `status: "skipped"`.

## Decisions
- **Confirmed cause (G1, G2).** The card treats a one-at-a-time host as a different form: its primary button on the asked page is Send and posts that one prompt (`send(oneAtATime ? {[asked]: …} : answers)`), and Send/Skip are disabled whenever `page !== askedPage`. Proven live: the app on Hermes v0.23.1 with a scripted model, a 3-question call: on page 2 after moving ahead with Auth+Search picked, the card read `2 of 3 | … Skip(off), Send(off)`; pressing Send on page 1 posted q0 at once (`after-send-100 | 2 of 3 | Postgres(off) …`). Made by the agent.
- **Confirmed cause (G4, list).** `AppPrompt` sends `given.join(", ")`; the live tool result held `"user_response": ["Auth, Search"]`. Sending `"[\"Auth\",\"Search\"]"` on the same route recorded `["Auth", "Search"]`. Made by the agent.
- **Confirmed cause (G4, skip).** The previous fix's belief that the run route reads `skip` as a skip is refuted live: it recorded `"status": "answered", "user_response": "skip"`; `"\u0000skipped"` recorded `"status": "skipped", "user_response": null` and Hermes still asked the next question. `skip` → `SKIPPED` happens only in the messaging text-reply path (`_coerce_text_response_detailed`). Made by the agent.
- **Refuted: Hermes batches a call's questions for an API-server run.** `clarify_batch_turn` applies only to local-viewer turns; the live run's `pending_controls` held one prompt, and the next appeared ~0.3 s after the answer. Made by the agent.
- **The drain lives in the card, not the plugin.** The answers are given with the app open and drain within about a second; the plugin route is a larger change. Made by the agent, pending the user's say.

## Risks
- **Plugin first.** A page closed in the second between Send and the last prompt leaves Hermes waiting on a later question with its committed answer lost; the user re-answers it on return. Nothing stalls that wasn't already a by-design wait for the user.
- The skip sentinel is a Hermes internal; the drift check is what catches a rename.
- The card is shared with rooms (`room-waiting`), which pass no `askedId` and so keep today's batch form — unaffected, verified by the existing tests.

## Not now
- Holding committed answers on the plugin so the drain survives a closed app (from the Plugin first rule).
- Letting the user change an answer Hermes has already taken (Hermes has no route for it).
