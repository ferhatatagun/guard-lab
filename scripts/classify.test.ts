/**
 * Cases for the classifier, one per failure mode named in the post that
 * prompted this tool, plus the ones that turned up while writing it.
 *
 *   npx tsx scripts/classify.test.ts
 */
import { classify } from '../src/lib/classify';
import { parseSchema } from '../src/lib/schema';

const schema = parseSchema(JSON.stringify({
  risk:  { type: 'enum', values: ['high', 'medium', 'low'] },
  score: { type: 'number', min: 0, max: 100, integer: true }
}));

type Case = [name: string, raw: string, expectKinds: string[], expectWorst: string | null];

const cases: Case[] = [
  ['clean',              '{"risk":"high","score":85}', [], null],
  ['markdown fence',     '```json\n{"risk":"high","score":85}\n```', ['markdown-fence'], 'recovered'],
  ['prose before',       'Here is the result:\n{"risk":"high","score":85}', ['prose-around-json'], 'recovered'],
  ['prose both sides',   'Sure!\n{"risk":"low","score":5}\nLet me know.', ['prose-around-json'], 'recovered'],
  ['enum case drift',    '{"risk":"HIGH","score":85}', ['enum-case-drift'], 'silent'],
  ['enum invented',      '{"risk":"very high","score":85}', ['enum-invented'], 'silent'],
  ['number as string',   '{"risk":"high","score":"85"}', ['number-as-string'], 'silent'],
  ['missing field',      '{"risk":"high"}', ['missing-field'], 'silent'],
  ['null value',         '{"risk":null,"score":85}', ['null-value'], 'silent'],
  ['out of range',       '{"risk":"high","score":150}', ['out-of-range'], 'silent'],
  ['non-integer',        '{"risk":"high","score":85.5}', ['non-integer'], 'silent'],
  ['wrong type',         '{"risk":true,"score":85}', ['wrong-type'], 'silent'],
  ['extra field',        '{"risk":"high","score":85,"why":"x"}', ['extra-field'], 'recovered'],
  ['unparseable',        'I cannot help with that.', ['unparseable'], 'crash'],
  ['array top level',    '[{"risk":"high","score":85}]', ['not-an-object'], 'crash'],
  ['truncated',          '{"risk":"high","score":', ['unparseable'], 'crash'],
  ['fence + drift',      '```\n{"risk":"Low","score":10}\n```', ['markdown-fence','enum-case-drift'], 'silent'],
];

let pass = 0, fail = 0;
for (const [name, raw, expectKinds, expectWorst] of cases) {
  const r = classify(raw, schema);
  const kinds = r.findings.map(f => f.kind).sort();
  const ok = JSON.stringify(kinds) === JSON.stringify([...expectKinds].sort())
          && r.worst === expectWorst;
  if (ok) { pass++; console.log(`  ✓ ${name.padEnd(18)} ${r.worst ?? 'clean'}`); }
  else {
    fail++;
    console.log(`  ✗ ${name.padEnd(18)} got [${kinds}] worst=${r.worst} — expected [${expectKinds}] worst=${expectWorst}`);
  }
}
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
