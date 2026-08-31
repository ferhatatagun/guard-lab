import type { Schema } from './schema';

/**
 * A sample run, so the tool is legible without a key.
 *
 * These are not invented to be dramatic. The mix is what a competent prompt
 * against a good model looks like at n = 50: mostly clean, a couple of
 * markdown fences, and a thin tail of the quiet ones. That thin tail is the
 * whole argument — it is small enough to miss in five manual runs and large
 * enough to matter at production volume.
 */

export const DEMO_SCHEMA = `{
  "risk":     { "type": "enum", "values": ["high", "medium", "low"] },
  "score":    { "type": "number", "min": 0, "max": 100, "integer": true },
  "route":    { "type": "enum", "values": ["auto", "manual-review"] },
  "rationale":{ "type": "string" }
}`;

export const DEMO_PROMPT = `You are triaging insurance claims. Return the risk band, a 0-100 score, a routing decision and a one-sentence rationale.

Claim: Vehicle rear-ended at low speed in a car park. Driver reports neck pain two days later. No police report. Policy active 14 months. Third prior claim in 24 months.`;

/** 50 responses. Indexes are stable so the demo reads the same every time. */
export const DEMO_RESPONSES: string[] = (() => {
	const clean = (risk: string, score: number, route: string, why: string) =>
		JSON.stringify({ risk, score, route, rationale: why });

	const out: string[] = [];

	// 41 clean responses with ordinary variation in the values.
	const variants: Array<[string, number, string, string]> = [
		['high', 78, 'manual-review', 'Late-reported injury with a prior claim pattern.'],
		['high', 81, 'manual-review', 'Delayed symptom onset and three claims in two years.'],
		['high', 74, 'manual-review', 'No police report and a repeat claimant.'],
		['medium', 62, 'manual-review', 'Low-speed impact but the claim history is notable.'],
		['high', 80, 'manual-review', 'Soft-tissue claim with no contemporaneous record.']
	];
	for (let i = 0; i < 41; i++) {
		const v = variants[i % variants.length];
		out.push(clean(v[0], v[1] + (i % 3), v[2], v[3]));
	}

	// 4 wrapped in a fence — recoverable, and the most common thing you see.
	for (let i = 0; i < 4; i++) {
		out.push('```json\n' + clean('high', 76 + i, 'manual-review', 'Prior claims and delayed reporting.') + '\n```');
	}

	// 1 with a preamble sentence.
	out.push(
		"Here's my assessment:\n\n" +
			clean('high', 79, 'manual-review', 'Repeat claimant, late injury report.')
	);

	// The quiet tail — four responses that parse and are wrong.
	out.push(JSON.stringify({ risk: 'HIGH', score: 82, route: 'manual-review', rationale: 'Repeat claimant.' }));
	out.push(JSON.stringify({ risk: 'very high', score: 88, route: 'manual-review', rationale: 'Strong indicators of exaggeration.' }));
	out.push(JSON.stringify({ risk: 'high', score: '77', route: 'manual-review', rationale: 'Late report, prior history.' }));
	out.push(JSON.stringify({ risk: 'high', score: 75, rationale: 'Prior claims within 24 months.' }));

	return out;
})();

export function demoSchemaText(): string {
	return DEMO_SCHEMA;
}

export function isDemoSchema(schema: Schema): boolean {
	return 'risk' in schema && 'score' in schema && 'route' in schema;
}
