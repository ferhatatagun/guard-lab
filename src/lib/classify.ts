import type { FieldSpec, Schema } from './schema';

/**
 * The failure classifier.
 *
 * Design rule: a count of "failures" is close to useless, because the failures
 * are not equally dangerous and teams need to triage them. The split that
 * matters is not what went wrong — it's what your code does about it:
 *
 *   crash     the output does not parse. Your request throws. You find out
 *             immediately, in an error rate you're probably already watching.
 *
 *   recovered the payload is correct but wrapped — a markdown fence, a
 *             sentence of preamble. Strip it and you have your data. Costs
 *             you nothing if you strip, costs you everything if you don't.
 *
 *   silent    the output parses, your code accepts it, and the value is
 *             wrong. Nothing throws. Nothing is logged. A wrong category
 *             lands on someone's dashboard and stays there.
 *
 * The third one is the reason this tool exists. Crashes announce themselves
 * and get fixed in week one; silent failures are found by a customer in month
 * six, if at all. A tool that reports a single "94% compliant" number hides
 * exactly the 6% you needed to see the shape of.
 */

export type Severity = 'crash' | 'recovered' | 'silent';

export type FailureKind =
	| 'unparseable'
	| 'markdown-fence'
	| 'prose-around-json'
	| 'not-an-object'
	| 'missing-field'
	| 'null-value'
	| 'enum-case-drift'
	| 'enum-invented'
	| 'number-as-string'
	| 'wrong-type'
	| 'out-of-range'
	| 'non-integer'
	| 'extra-field';

export interface Finding {
	kind: FailureKind;
	severity: Severity;
	field?: string;
	detail: string;
}

export interface RunResult {
	raw: string;
	/** The object we managed to recover, if any. */
	parsed: Record<string, unknown> | null;
	findings: Finding[];
	/** True when nothing at all went wrong — the strict definition. */
	clean: boolean;
	/** Worst severity present, for the headline split. */
	worst: Severity | null;
}

export const SEVERITY_OF: Record<FailureKind, Severity> = {
	unparseable: 'crash',
	'not-an-object': 'crash',
	'markdown-fence': 'recovered',
	'prose-around-json': 'recovered',
	'missing-field': 'silent',
	'null-value': 'silent',
	'enum-case-drift': 'silent',
	'enum-invented': 'silent',
	'number-as-string': 'silent',
	'wrong-type': 'silent',
	'out-of-range': 'silent',
	'non-integer': 'silent',
	'extra-field': 'recovered'
};

export const KIND_LABEL: Record<FailureKind, string> = {
	unparseable: 'Not JSON at all',
	'not-an-object': 'JSON, but not an object',
	'markdown-fence': 'Wrapped in a markdown fence',
	'prose-around-json': 'Prose around the JSON',
	'missing-field': 'Required field missing',
	'null-value': 'Null where a value was required',
	'enum-case-drift': 'Enum case drift',
	'enum-invented': 'Enum value that does not exist',
	'number-as-string': 'Number sent as a string',
	'wrong-type': 'Wrong type',
	'out-of-range': 'Number outside declared range',
	'non-integer': 'Fractional value where an integer was declared',
	'extra-field': 'Field not in the schema'
};

/**
 * Why each kind is filed where it is. Shown in the UI, because a severity
 * label the reader can't interrogate is just a colour.
 */
export const KIND_RATIONALE: Record<FailureKind, string> = {
	unparseable: 'JSON.parse throws. Loud, and you already alert on it.',
	'not-an-object': 'Parses, but indexing a field on an array or scalar throws or yields undefined.',
	'markdown-fence': 'Harmless if you strip fences before parsing. Fatal if you pass it straight to JSON.parse.',
	'prose-around-json': 'Same: recoverable by extracting the JSON span, fatal if you assume the body is only JSON.',
	'missing-field': 'Reads as undefined. Templates render blank, comparisons quietly go false, nothing throws.',
	'null-value': 'Passes an existence check in most code, then fails a type check somewhere far away.',
	'enum-case-drift': 'A === comparison misses it and falls through to your default branch, which is usually the safe-looking one.',
	'enum-invented': 'Passes every check you wrote for the values you expected, then hits the default branch as if it were normal.',
	'number-as-string': 'Arithmetic gives NaN or string concatenation. "85" + 10 is "8510", and no error is raised.',
	'wrong-type': 'Accepted by JavaScript, misbehaves downstream at a distance from the cause.',
	'out-of-range': 'A valid number in an invalid position. Percentages over 100 render, chart, and mislead.',
	'non-integer': 'Survives until something indexes, paginates, or counts with it.',
	'extra-field': 'Ignored by most consumers, but it means the model is improvising and worth knowing about.'
};

/** ```json … ``` or ``` … ``` */
const FENCE = /```(?:json|JSON)?\s*([\s\S]*?)```/;

/**
 * Pull the most plausible JSON object out of a raw completion.
 *
 * Mirrors what a defensive production parser would do, so that anything this
 * function still can't recover is genuinely a crash rather than an artifact of
 * us being stricter than real code.
 */
function extract(raw: string): { text: string; wrapped: FailureKind | null } {
	const trimmed = raw.trim();

	// Straight parse first, exactly as production code would. This matters for
	// a response that is valid JSON but the wrong shape — an array of results,
	// say. Salvaging the first object out of `[{…}, {…}]` would report a
	// recovery while silently discarding every element after the first, so a
	// well-formed non-object has to reach the caller intact and be judged
	// there.
	try {
		JSON.parse(trimmed);
		return { text: trimmed, wrapped: null };
	} catch {
		// Not valid on its own — fall through to the salvage paths below.
	}

	const fenced = trimmed.match(FENCE);
	if (fenced) return { text: fenced[1].trim(), wrapped: 'markdown-fence' };

	// Widest brace span — handles a preamble sentence, a trailing note, or both.
	const first = trimmed.indexOf('{');
	const last = trimmed.lastIndexOf('}');
	if (first !== -1 && last > first) {
		return { text: trimmed.slice(first, last + 1), wrapped: 'prose-around-json' };
	}

	return { text: trimmed, wrapped: null };
}

function typeOf(v: unknown): string {
	if (v === null) return 'null';
	if (Array.isArray(v)) return 'array';
	return typeof v;
}

function checkField(name: string, spec: FieldSpec, value: unknown): Finding[] {
	const out: Finding[] = [];
	const add = (kind: FailureKind, detail: string) =>
		out.push({ kind, severity: SEVERITY_OF[kind], field: name, detail });

	if (value === undefined) {
		if (!spec.optional) add('missing-field', `"${name}" was not present`);
		return out;
	}
	if (value === null) {
		if (!spec.optional) add('null-value', `"${name}" was null`);
		return out;
	}

	switch (spec.type) {
		case 'enum': {
			if (typeof value !== 'string') {
				add('wrong-type', `"${name}" is ${typeOf(value)}, expected one of the enum strings`);
				break;
			}
			if (spec.values.includes(value)) break;
			const ci = spec.values.find((v) => v.toLowerCase() === value.toLowerCase());
			if (ci) add('enum-case-drift', `"${name}" was ${JSON.stringify(value)}, schema says ${JSON.stringify(ci)}`);
			else add('enum-invented', `"${name}" was ${JSON.stringify(value)}, not in the enum`);
			break;
		}
		case 'number': {
			if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
				add('number-as-string', `"${name}" was the string ${JSON.stringify(value)}`);
				break;
			}
			if (typeof value !== 'number' || !Number.isFinite(value)) {
				add('wrong-type', `"${name}" is ${typeOf(value)}, expected number`);
				break;
			}
			if (spec.integer && !Number.isInteger(value)) {
				add('non-integer', `"${name}" was ${value}, schema declares an integer`);
			}
			if (spec.min !== undefined && value < spec.min) {
				add('out-of-range', `"${name}" was ${value}, below the minimum of ${spec.min}`);
			}
			if (spec.max !== undefined && value > spec.max) {
				add('out-of-range', `"${name}" was ${value}, above the maximum of ${spec.max}`);
			}
			break;
		}
		case 'string':
			if (typeof value !== 'string') add('wrong-type', `"${name}" is ${typeOf(value)}, expected string`);
			break;
		case 'boolean':
			if (typeof value !== 'boolean') add('wrong-type', `"${name}" is ${typeOf(value)}, expected boolean`);
			break;
		case 'array': {
			if (!Array.isArray(value)) {
				add('wrong-type', `"${name}" is ${typeOf(value)}, expected array`);
				break;
			}
			if (spec.of) {
				const bad = value.findIndex((v) => typeOf(v) !== spec.of);
				if (bad !== -1) {
					add('wrong-type', `"${name}"[${bad}] is ${typeOf(value[bad])}, expected ${spec.of}`);
				}
			}
			break;
		}
	}
	return out;
}

export function classify(raw: string, schema: Schema): RunResult {
	const findings: Finding[] = [];
	const { text, wrapped } = extract(raw);

	if (wrapped) {
		findings.push({
			kind: wrapped,
			severity: SEVERITY_OF[wrapped],
			detail:
				wrapped === 'markdown-fence'
					? 'The object was inside a fenced code block'
					: 'There was text outside the JSON object'
		});
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		findings.push({
			kind: 'unparseable',
			severity: 'crash',
			detail: 'No JSON object could be recovered from the response'
		});
		return { raw, parsed: null, findings, clean: false, worst: 'crash' };
	}

	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		findings.push({
			kind: 'not-an-object',
			severity: 'crash',
			detail: `Top level is ${typeOf(parsed)}, expected an object`
		});
		return { raw, parsed: null, findings, clean: false, worst: 'crash' };
	}

	const obj = parsed as Record<string, unknown>;
	for (const [name, spec] of Object.entries(schema)) {
		findings.push(...checkField(name, spec, obj[name]));
	}
	for (const key of Object.keys(obj)) {
		if (!(key in schema)) {
			findings.push({
				kind: 'extra-field',
				severity: 'recovered',
				field: key,
				detail: `"${key}" is not in the schema`
			});
		}
	}

	const order: Severity[] = ['silent', 'crash', 'recovered'];
	const worst =
		order.find((s) => findings.some((f) => f.severity === s)) ?? null;

	return { raw, parsed: obj, findings, clean: findings.length === 0, worst };
}
