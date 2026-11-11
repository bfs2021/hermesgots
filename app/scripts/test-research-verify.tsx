/**
 * A verification's brief. The form keeps the user's own words beside the plugin's neutral
 * restatement, lets the restatement and its parts be edited (one to four of them) and sends what was
 * edited; a claim the plugin read back as not checkable shows its read-back and nothing to confirm.
 * A bot whose plugin can't verify is refused before anything is posted. What a claim is read back as
 * is the plugin's (`plugin/tests/test_research.py`); this never works one out.
 */
import assert from "node:assert/strict"
import test from "node:test"

import { VerifyBriefForm } from "@/components/verify"
import { db } from "@/lib/db"
import { createMission, type Mission } from "@/lib/research"
import {
  absent,
  absentText,
  botProfile,
  click,
  find,
  findAll,
  findText,
  json,
  mount,
  text,
  type,
} from "./component-kit.tsx"

const loaded = "Coffee KILLS you: every daily cup is a heart attack waiting to happen!!"

function mission(patch: Partial<Mission> = {}): Mission {
  return {
    id: "r_1",
    profileId: "bot-1",
    type: "verify",
    input: loaded,
    title: "Coffee and heart attacks",
    goal: "",
    format: "guide",
    audience: "",
    depth: "overview",
    outline: [],
    sources: ["papers"],
    stage: "brief",
    createdAt: 1,
    found: 0,
    claimCount: 0,
    written: 0,
    formats: [],
    suggestions: [],
    options: [],
    criteria: [],
    verify: {
      restatement: "Drinking coffee daily raises the risk of a heart attack.",
      parts: [
        { id: "p1", text: "Coffee is drunk daily" },
        { id: "p2", text: "The risk of a heart attack rises" },
      ],
      terms: ["daily", "heart attack"],
    },
    ...patch,
  }
}

/** Answers `info` with the features given and records every other request it is sent. */
function host(features: string[]) {
  const posts: { path: string; body: unknown }[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith("/info")) return json({ object: "gots.info", features })
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    posts.push({ path: url.pathname, body })
    return json({ mission: { id: "r_1", type: "verify", stage: "scope" } })
  }) as unknown as typeof fetch
  return posts
}

test("the verify brief keeps the original beside the restatement and confirms the edited parts", async () => {
  const bot = botProfile("verify-brief")
  await db.profiles.put(bot)
  const posts = host(["research", "research_verify"])
  await mount(<VerifyBriefForm mission={mission()} />, async () => {
    assert.match(text(), new RegExp(loaded.replace(/[!?]/g, "\\$&")), "the user's own words stay")
    const restatement = find('textarea[aria-label="Restatement"]') as HTMLTextAreaElement
    assert.equal(restatement.value, "Drinking coffee daily raises the risk of a heart attack.")
    assert.deepEqual(
      findAll('input[aria-label^="Term "]').map((term) => (term as HTMLInputElement).value),
      ["daily", "heart attack"],
    )
    assert.equal(findAll('input[aria-label^="Part "]').length, 2)

    await type(restatement, "Drinking coffee every day raises heart attack risk.")
    await type(find('input[aria-label="Part 2"]'), "Heart attack risk rises")
    await click(findText("button", "Add a part"))
    await click(findText("button", "Add a part"))
    assert.ok(
      (findText("button", "Add a part") as HTMLButtonElement).disabled,
      "four parts at most",
    )
    await click(find('button[aria-label="Remove part 1"]'))
    await type(find('input[aria-label="Term 1"]'), "every day")
    await click(find('button[aria-label="Remove term 2"]'))
    await click(findText("button", "Add a term"))
    await type(find('input[aria-label="Term 2"]'), "risk")
    await click(findText("button", "Continue"))
  })
  assert.deepEqual(posts, [
    {
      path: "/api/plugins/gots/research/r_1/brief",
      body: {
        restatement: "Drinking coffee every day raises heart attack risk.",
        parts: ["Heart attack risk rises"],
        terms: ["every day", "risk"],
      },
    },
  ])
  await db.profiles.delete(bot.id)
})

test("a claim read back as not checkable shows why and offers nothing to confirm", async () => {
  const uncheckable = mission({
    input: "Vim is the best editor",
    verify: {
      restatement: "Vim is the best editor.",
      parts: [{ id: "p1", text: "Vim is the best editor" }],
      terms: [],
      uncheckable: "It is a matter of taste.",
    },
  })
  await mount(<VerifyBriefForm mission={uncheckable} />, async () => {
    assert.match(text(), /Vim is the best editor\./)
    assert.match(text(), /It is a matter of taste\./)
    absentText("button", "Continue")
    absent("textarea", "nothing to edit")
  })
})

test("a verify mission is refused where the plugin lacks research_verify", async () => {
  const posts = host(["research", "research_compare"])
  await assert.rejects(
    createMission(botProfile("verify-old"), "Coffee raises heart attack risk", "verify"),
    /needs an update for Verify a claim/,
  )
  assert.deepEqual(posts, [], "nothing is posted")
})
