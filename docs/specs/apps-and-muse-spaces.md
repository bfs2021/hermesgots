# Apps and Muse Spaces: where we stand and how to close the gap

Status: research, 2026-11-07. Not settled. This is the input to a planning pass, not a build handoff.
Every claim about Gots is read off the code at `405dd92`; every claim about Muse Spaces is from public
coverage of its launch on 2026-11-06 and is marked where Meta has not said.

## Problem Statement

Meta launched **Spaces** for its Muse agent: describe an idea in chat and Muse builds a small app you
keep — a tracker, a planner, a project board — that you edit in place, place where you want, and that
keeps itself up to date from connected services. That is close to what Apps was meant to be, and Apps
does it less well.

The obvious diagnosis is the renderer: an app is drawn from nine OpenUI components with no styling, so
it cannot look like anything the user has in mind. The proposal on the table is to let the agent write
plain HTML instead, have the plugin inspect it for secrets and basic standards, and draw it as the app,
with a default design guide the user's own preferences and skills override.

This document checks that diagnosis against what Spaces can do and what Apps can do, and argues that the
renderer is one gap of several, and not the one that makes a Space feel alive.

## What Muse Spaces is

**Stated by Meta or consistent across the launch coverage:**

- Built from a description in chat; Muse builds a small, self-contained app (tracker, planner,
  dashboard, game) without the user writing code or leaving the app.
- Iterated by asking: add what is missing, change the look, change the behaviour.
- Used directly: the user checks items off, adds notes and edits inside the space.
- Placed by the user: in the sidebar, as a main tab, hidden, or on a schedule.
- Connected to third-party apps, and "keeps itself up to date in the background" — new concert dates,
  price changes, savings progress — without being asked.
- Available wherever Muse is (one outlet reports Europe is still waiting).

**Not stated anywhere I found:**

- What a space is made of — generated HTML, components, templates or anything else — and how it runs.
  "Spaces are HTML" is not established; the comparison below is by capability, not by implementation.
- Which third-party apps connect, how they authenticate, and what permissions a space holds.
- Any sandboxing claim specific to Spaces. Muse as a whole runs in what Meta calls a Secure VM and
  lets users scope which apps the agent reaches.
- Sharing: Meta says it is exploring it; it is not a launch feature. (A separate report says Muse's
  share links leaked through passive DNS in October 2026; single secondary source, unverified.)
- Usage numbers.

## Where Apps stands against it

| Capability | Spaces | Gots Apps | Where in the code |
|---|---|---|---|
| Build from a description | Yes | Yes | `buildPages` in `app/src/lib/apps.ts` |
| Iterate by asking | Yes | Yes, one page replaced whole | `changePage`, ADR 0099 |
| Change the look | Yes | **No** — nine components, no style input | `plugin/openui/app-prompt.txt` |
| Check off, add notes, edit in place | Yes | **No** — no inputs, and an app has no storage of its own; a `Mutation` can only call an MCP tool | `plugin/apps.py`, `query_app` in `plugin/__init__.py` |
| Updates in the background | Yes | **No** — a `Query` runs only while the page is open | — |
| Third-party integrations | Yes, mostly cloud services | **Local stdio MCP servers only**; a remote server is refused | `plugin/mcp_call.py` (`_remote`) |
| Placement | Sidebar, tab, hidden, scheduled | Hidden only | `set_hidden` in `plugin/apps.py` |
| Build survives closing the app | Presumably | **No** — the app follows the run and parses its output itself | `runForApp`, `pagesOf` in `app/src/lib/app-build.ts` |
| Consent to what an app calls | Not stated | Yes, read off the source and enforced on the host | ADR 0102, `plugin/app_tools.py`, `apps.may_call` |
| Works with the host away | Not stated | Yes, from the device's copy | ADR 0100 |

The last two rows are ours and worth keeping. The rest are the gaps.

**The build dying with the app is a bug, not a missing feature.** AGENTS.md's Plugin first rule says a
user should be able to ask, close the app and come back to it done. `runForApp` starts a run, follows it
from the device, and only the device turns the answer into pages and saves them, so a closed app is a
lost build. That gets worse as builds get longer, which HTML would make them.

**Switching the renderer to HTML closes one row** — the look — and makes in-place editing possible once
there is somewhere to keep the data. It does nothing for background updates, integrations, placement or
the build dying. A beautifully styled tracker that cannot remember a ticked box is still a picture of a
tracker.

## The HTML question

### For

- Nine fixed components cannot produce "whatever style they want", and no prompt work gets there.
- A build is an ordinary Hermes run, so the user's own design skills and preferences apply with no work
  of ours.
- The industry has converged on it. **MCP Apps** (SEP-1865, `ui://` resources, the
  `modelcontextprotocol/ext-apps` repository) is HTML in a sandboxed iframe that talks to its host in
  MCP's JSON-RPC over `postMessage`. A secondary source says its 2026-01-26 spec is marked stable; not
  confirmed from the spec itself. Aligning with it would let an MCP server's own UI draw in Gots later.

### Against, and what has to change in the proposal

1. **Inspecting the HTML cannot be the security boundary.** A static scan of model-written JavaScript
   loses to `eval`, `Function`, `atob` or a URL assembled from pieces. Every serious host does what
   MCP Apps does instead: the page may do anything inside a box that can reach nothing.
   - `<iframe sandbox="allow-scripts" srcdoc="…">`, never `allow-same-origin`, so the page runs in an
     opaque origin and cannot read the app's IndexedDB, a bot's key or a cookie.
   - A CSP injected into the page that forbids outbound requests:
     `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'`.
     Without it the page can send anything it was shown anywhere. The app sets no CSP of its own today
     (none in `netlify.toml` or `app/index.html`), so the policy has to travel in the page.
   - One way out: `postMessage` to the parent, which calls the existing `apps/query`, where the host
     already enforces consent.

   The scan stays, as hygiene rather than defence.
2. **Secrets are kept out by design, then checked.** If the page reaches data only through the bridge,
   the agent never needs a key in it. A secret-pattern check on save is a backstop for the agent
   pasting in something it read.
3. **Consent can no longer be derived from the source.** ADR 0102's guarantee — an app cannot call
   something it never wrote — rests on the parser reporting every call. JavaScript has no such parse.
   Consent becomes a list the page declares and the host enforces at call time: an unlisted call is
   refused and the user is asked. That reverses an option ADR 0102 rejected by name, so it needs a new
   ADR rather than a quiet change.
4. **Cost and drift go up.** ADR 0099 keeps a page small enough to rewrite whole. A styled HTML page is
   likely several times an openui-lang page's size (an estimate, not measured), so a build is slower and
   dearer, a whole-page rewrite drifts more, and `PAGE_MAX_CHARS` (20,000) has to rise.
5. **What we lose:** light and dark mode for free (the theme tokens must be injected as CSS variables and
   the model told to use them), drawing while the answer streams, and the guarantee that a page which
   cannot draw falls back to its source.

### Recommendation

**HTML as a second page kind, not a replacement.** OpenUI stays the cheap default for interfaces in a
chat reply; HTML becomes what an app is built as. A page records its kind, and both kinds share the
record, the device's copy, the host's consent and the call route.

## Plan

Ordered by value per effort. Steps 1, 2 and 5 are independent of the HTML question and probably close
more of the gap than the renderer does.

### 1. The build runs on the host

- The plugin starts the build's run, parses the finished output into pages, checks them and saves the
  app in one transaction; the app follows the run for the live view and reads the app when it lands.
- The same for a change: the host writes the page only once the answer is whole and draws.
- A push when a build finishes or fails, as Research does.
- **Done when:** a build asked for and the app closed at once is in the list when the app is opened
  again.

### 2. An app keeps its own data

- A host store per app — collections of rows — reachable from a page as reads and writes that need no
  consent (they are the app's own data on the user's host, the same reasoning ADR 0102 gives the bot's
  own reads).
- Inputs in the app's OpenUI library (a checkbox, a text field) so the current kind can use it too.
- Rows survive a page rewrite: the data belongs to the app, not to a page's source.
- **Done when:** a built checklist keeps its ticks across a reload and on a second device.

### 3. HTML pages, behind a Developer switch

- **Record:** a page's `kind` (`openui` or `html`), a migration with the store's version bump.
- **Drawing:** the sandboxed iframe and injected CSP above, the app's theme tokens injected as CSS
  variables, and a small bridge — `gots.query`, `gots.act`, `gots.data.get` / `gots.data.set`,
  `gots.navigate(page)`, `gots.theme` — each a `postMessage` the parent turns into the routes that exist.
- **Consent:** a declared list in the page (a `<script type="application/gots+json">` block), shown at
  save as today, enforced by `apps.may_call` at call time; an undeclared call is refused as a value the
  page can draw.
- **Checks on save, in the plugin:** the size cap, secret patterns, no remote `src` or `href`, no
  `<base>`, no meta refresh; and standards as warnings — a viewport meta, a `lang`, the theme variables
  used.
- **Prompt:** an HTML section with a default design guide that the user's preferences and skills
  override.
- **Open:** whether the CSP allows a fixed CDN (cdnjs) for a chart library, or every library is inlined.
  Inlining keeps `connect-src 'none'` honest but costs size.
- **Done when:** a built app draws in its own style in light and dark mode on the web and in the Android
  WebView, reads through the bridge, and a page that tries `fetch` to any host gets nothing.

### 4. Background updates through Routines

- A routine refreshes an app's data on a schedule by writing to the store from step 2, so the app opens
  current with the device closed in the meantime.
- **Done when:** an app built as "watch this price" shows a change that happened while the app was
  closed.

### 5. Pin an app to the sidebar

- A pinned app stands with Projects, Code and the rest; the setting syncs with the account.

### 6. Remote MCP servers

- The question ADR 0102 left open: a remote server's tokens are Hermes's, and Hermes's own call path
  asks a person before a call, which an app opening on a phone cannot satisfy.
- This is what Spaces' integrations mostly are, so it has to be answered, but not first.

## Decisions to record

- **An app's build runs on the host** — likely needs no ADR, since it is the Plugin first rule applied.
- **An app keeps data of its own, apart from its pages** — an ADR: it extends ADR 0099's record.
- **An app's page may be HTML, drawn in an opaque-origin frame with no network** — an ADR, amending
  ADR 0101.
- **An HTML page's consent is declared and enforced at call time** — an ADR superseding part of
  ADR 0102.

## Open questions

- Does Meta publish anything about how a space is built or sandboxed? Worth checking again before an
  ADR cites Spaces as precedent.
- Do we adopt MCP Apps' message shapes for the bridge, so an MCP server's own UI could draw later, or a
  smaller bridge of our own?
- How large does a typical built HTML page get, and what does a build cost against an OpenUI one?
  Measure on a few real prompts before raising the cap.
- Does a page that can only reach its own data and consented tools need the user to see its source, or
  is the consent sheet enough?

## Sources

- [TechCrunch: Meta introduces Spaces, a new way to collaborate with your Muse agent](https://techcrunch.com/2026/11/06/meta-introduces-spaces-a-new-way-to-collaborate-with-your-muse-agent/)
- [Digital Trends: Meta now lets you build your own mini-app experiences called spaces](https://www.digitaltrends.com/phones/metas-now-lets-you-build-custom-mini-app-experiences-in-the-muse-app/)
- [Techgenyz: Meta Muse Spaces features explained](https://techgenyz.com/meta-muse-spaces-ai-features-explained/)
- [FourWeekMBA: Meta's Muse now builds custom mini apps called Spaces](https://fourweekmba.com/ai-metas-muse-now-builds-custom-mini-apps-called-spaces/)
- [AI Weekly: Meta adds Spaces to Muse agent](https://aiweekly.co/alerts/meta-adds-spaces-to-muse-agent-topic-tabs-with-app-hooks)
- [i-scoop: Meta Spaces turns Muse into a builder of personal apps](https://www.i-scoop.eu/meta-spaces-muse/)
- [NordVPN: What is the Meta Muse AI agent?](https://nordvpn.com/blog/meta-muse-ai-agent/)
- [MCP blog: MCP Apps](https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/)
- [morphllm: MCP Apps, the spec that turns MCP servers into UI platforms](https://www.morphllm.com/mcp-apps)
