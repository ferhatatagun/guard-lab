import { describeField, exampleFor, type Schema } from './schema';

/**
 * The API layer.
 *
 * BYOK, called straight from the tab with `anthropic-dangerous-direct-browser-access`.
 * The key stays in the page — it is never persisted, never sent anywhere except
 * to Anthropic, and there is no backend here to send it to. That is the same
 * constraint the rest of these tools are built under: usable in a room where
 * nothing can be installed and the data can't leave.
 */

/**
 * `sampling: false` means the model rejects temperature / top_p / top_k with a
 * 400, so the request leaves them out and runs at the model's fixed default.
 * The two older models stay in the list because they are the ones where
 * temperature can still be varied.
 */
export const MODELS = [
	{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', sampling: false },
	{ id: 'claude-opus-5-5', label: 'Opus 5.5', sampling: false },
	{ id: 'claude-haiku-5-5', label: 'Haiku 5.5', sampling: false },
	{ id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', sampling: true },
	{ id: 'claude-haiku-4-5', label: 'Haiku 4.5', sampling: true }
] as const;

export type ModelId = (typeof MODELS)[number]['id'];

export const DEFAULT_MODEL: ModelId = MODELS[0].id;

export function supportsSampling(id: ModelId): boolean {
	return MODELS.find((m) => m.id === id)?.sampling ?? false;
}

/**
 * Room for models that think by default: thinking tokens count against
 * max_tokens, and a reply cut off mid-JSON would be reported as a model
 * failure when it is really this tool's budget.
 */
const MAX_TOKENS = 4096;

export class ApiError extends Error {}

/**
 * The instruction appended to the user's prompt.
 *
 * Kept deliberately plain. A heavily engineered "YOU MUST RETURN ONLY JSON"
 * preamble would suppress exactly the failures this tool is trying to measure,
 * and you would leave with a compliance number that your real prompt can't
 * reproduce. This is roughly what people actually write.
 */
export function schemaInstruction(schema: Schema): string {
	const fields = Object.entries(schema)
		.map(([n, s]) => `- ${describeField(n, s)}`)
		.join('\n');
	return `Respond with a JSON object with these fields:\n${fields}\n\nExample shape:\n${JSON.stringify(
		exampleFor(schema),
		null,
		2
	)}`;
}

export interface CallOptions {
	apiKey: string;
	model: ModelId;
	prompt: string;
	schema: Schema;
	temperature: number;
	signal?: AbortSignal;
}

export async function callOnce(opts: CallOptions): Promise<string> {
	const res = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-api-key': opts.apiKey,
			'anthropic-version': '2023-06-01',
			'anthropic-dangerous-direct-browser-access': 'true'
		},
		signal: opts.signal,
		body: JSON.stringify({
			model: opts.model,
			max_tokens: MAX_TOKENS,
			temperature: supportsSampling(opts.model) ? opts.temperature : undefined,
			messages: [
				{
					role: 'user',
					content: `${opts.prompt}\n\n${schemaInstruction(opts.schema)}`
				}
			]
		})
	});

	if (!res.ok) {
		let detail = `${res.status} ${res.statusText}`;
		try {
			const body = await res.json();
			if (body?.error?.message) detail = body.error.message;
		} catch {
			// Non-JSON error body — the status line is all we have.
		}
		if (res.status === 401) throw new ApiError('That key was rejected (401).');
		if (res.status === 429) throw new ApiError('Rate limited (429). Lower the concurrency and try again.');
		throw new ApiError(detail);
	}

	const body = await res.json();
	const text = (body?.content ?? [])
		.filter((b: { type?: string }) => b?.type === 'text')
		.map((b: { text?: string }) => b.text ?? '')
		.join('');
	return text;
}

/**
 * Run the same prompt N times with bounded concurrency.
 *
 * Concurrency is capped and configurable because the failure being measured is
 * distributional: you need tens of samples, and firing fifty requests at once
 * is the fastest way to turn a measurement run into a 429 that looks like a
 * model problem.
 */
export async function runBatch(
	opts: CallOptions & { runs: number; concurrency: number; onResult: (raw: string | Error, i: number) => void }
): Promise<void> {
	const queue = Array.from({ length: opts.runs }, (_, i) => i);
	const workers = Array.from({ length: Math.max(1, Math.min(opts.concurrency, opts.runs)) }, async () => {
		for (;;) {
			const i = queue.shift();
			if (i === undefined) return;
			if (opts.signal?.aborted) return;
			try {
				opts.onResult(await callOnce(opts), i);
			} catch (e) {
				if (opts.signal?.aborted) return;
				opts.onResult(e instanceof Error ? e : new Error(String(e)), i);
			}
		}
	});
	await Promise.all(workers);
}
