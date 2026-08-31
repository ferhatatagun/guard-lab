# guard-lab

**One run proves nothing.**

**[guard-lab.vercel.app](https://guard-lab.vercel.app)**

You ask a model for `{"risk": "high"|"medium"|"low", "score": 0-100}`. You run
it once, get exactly that, and ship.

Then one call in forty comes back with `"HIGH"`, or `"very high"`, or
`"score": "85"` as a string. You never see it, because you looked at one sample
— and none of those throw. They parse, your code accepts them, and a wrong
category lands on someone's dashboard and stays there.

guard-lab defines a schema, runs a prompt against it N times, and shows the
distribution of ways it breaks.

## The split that matters

Counting failures is close to useless, because they are not equally dangerous.
What matters is what your code does about each one:

| | | |
|---|---|---|
| **Crash** | The output doesn't parse | Loud. Already in the error rate you watch. |
| **Recoverable** | Right payload, wrapped in a fence or prose | Free if you strip it, fatal if you don't. |
| **Silent** | Parses, is accepted, and is wrong | Nothing throws. Nothing is logged. |

The third one is why this exists. Crashes get fixed in week one; silent
failures are found by a customer in month six, if at all. A tool that reports
"94% compliant" hides exactly the 6% you needed to see the shape of.

## Zero failures is not a zero failure rate

The other half of the argument. Fifty clean runs feels like proof. It isn't:
at n = 50 the data is still consistent with a true failure rate near 7%, and
at production volume 7% is not a rounding error.

So every result carries a Wilson interval, and a clean sweep says so
explicitly rather than showing you a reassuring zero. Ruling out a 1% failure
rate takes 381 clean runs.

That number inverts the same interval the UI displays, rather than the usual
rule-of-three shortcut. 3/n would promise that 300 clean runs rule out 1% and
then the tool would turn around and report 1.26% — arguing with itself in
front of the user.

## What it checks

Missing fields, nulls, enum case drift (`"HIGH"` for `"high"`), invented enum
values, numbers sent as strings, wrong types, out-of-range values, fractional
values where an integer was declared, markdown fences, prose around the JSON,
unparseable output, valid JSON of the wrong shape, and fields that aren't in
the schema at all.

Recovery mirrors what defensive production code does — straight `JSON.parse`
first, then a fenced block, then the widest brace span — so anything still
unparseable is a real crash rather than this tool being stricter than your
code. Valid JSON of the wrong shape is never salvaged into its first element,
because that would report a recovery while discarding data.

## What it does not tell you

Anything about whether the answers are *good*. A response can satisfy every
field in the schema and still be wrong about the claim. This measures contract
compliance, which is the floor and not the ceiling.

## Running it

```
npm install
npm run dev
```

Tests for the parts that carry the weight:

```
npx tsx scripts/classify.test.ts   # one case per failure mode
npx tsx scripts/stats.test.ts      # Wilson against published reference values
```

BYOK — the key stays in the tab, is never persisted, and goes nowhere except
Anthropic. There is no backend here to send it to.

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind v4. Static export, no backend,
no analytics.

---

Built by [Ferhat Atagün](https://ferhatatagun.com) ·
[more tools](https://ferhatatagun.com/tools)
