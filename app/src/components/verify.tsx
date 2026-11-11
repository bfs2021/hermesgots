import { useState } from "react"
import { PlusIcon, XIcon } from "lucide-react"

import { Banner } from "@/components/banner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { attempt } from "@/lib/attempt"
import { MAX_PARTS, MAX_TERMS, confirmVerification, type Mission } from "@/lib/research"

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  )
}

/** A list of short lines, each edited, removed or added, between `least` and `most` of them. */
function ListEditor({
  noun,
  items,
  least,
  most,
  onChange,
}: {
  noun: string
  items: string[]
  least: number
  most: number
  onChange: (items: string[]) => void
}) {
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1)
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item, index) => (
        <li key={index} className="flex items-center gap-2">
          <Input
            value={item}
            onChange={(event) =>
              onChange(items.map((one, i) => (i === index ? event.target.value : one)))
            }
            aria-label={`${Noun} ${index + 1}`}
            className="h-11"
          />
          <Button
            variant="ghost"
            size="icon-lg"
            className="size-11 shrink-0 rounded-full text-muted-foreground"
            disabled={items.length <= least}
            onClick={() => onChange(items.filter((_, i) => i !== index))}
            aria-label={`Remove ${noun} ${index + 1}`}
          >
            <XIcon />
          </Button>
        </li>
      ))}
      <li>
        <Button
          variant="ghost"
          className="h-11 rounded-full px-2 text-muted-foreground"
          disabled={items.length >= most}
          onClick={() => onChange([...items, ""])}
        >
          <PlusIcon data-icon="inline-start" />
          Add a {noun}
        </Button>
      </li>
    </ul>
  )
}

/** The user's own words, kept beside the read-back as they were typed. */
function Original({ mission }: { mission: Mission }) {
  return (
    <Section label="You wrote">
      <blockquote className="border-l-2 pl-3 text-sm leading-6 whitespace-pre-wrap text-muted-foreground">
        {mission.input}
      </blockquote>
    </Section>
  )
}

/** A claim read back as neutral parts, editable before anything is read; one that can't be checked
 * shows its read-back and why, with nothing to confirm. */
export function VerifyBriefForm({ mission }: { mission: Mission }) {
  const brief = mission.verify ?? { restatement: "", parts: [], terms: [] }
  const [restatement, setRestatement] = useState(brief.restatement)
  const [parts, setParts] = useState(brief.parts.map((p) => p.text))
  const [terms, setTerms] = useState(brief.terms)
  const [saving, setSaving] = useState(false)
  const kept = parts.filter((p) => p.trim())
  const ready = restatement.trim() && kept.length >= 1 && kept.length <= MAX_PARTS && !saving

  if (brief.uncheckable)
    return (
      <>
        <Original mission={mission} />
        <Section label="Restated">
          <p className="leading-6">{brief.restatement}</p>
        </Section>
        <Banner tone="warning">{brief.uncheckable}</Banner>
      </>
    )

  const save = async () => {
    setSaving(true)
    await attempt("save the brief", () =>
      confirmVerification(mission, {
        restatement,
        parts: kept,
        terms: terms.filter((t) => t.trim()),
      }),
    )
    setSaving(false)
  }

  return (
    <>
      <Original mission={mission} />
      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium">Restated</span>
        <Textarea
          value={restatement}
          onChange={(event) => setRestatement(event.target.value)}
          aria-label="Restatement"
          className="min-h-20 leading-6"
        />
      </label>
      <Section label="Parts">
        <ListEditor noun="part" items={parts} least={1} most={MAX_PARTS} onChange={setParts} />
      </Section>
      <Section label="Taken literally">
        <ListEditor noun="term" items={terms} least={0} most={MAX_TERMS} onChange={setTerms} />
      </Section>
      <Button
        size="lg"
        className="h-11 rounded-full md:self-end md:px-6"
        disabled={!ready}
        onClick={() => void save()}
      >
        {saving && <Spinner data-icon="inline-start" />}
        Continue
      </Button>
    </>
  )
}
