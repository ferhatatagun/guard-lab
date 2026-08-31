/**
 * The schema language.
 *
 * Deliberately smaller than JSON Schema. The point of this tool is to find out
 * how a model breaks a contract, and a contract you can't read at a glance is
 * one you won't check. Every field is one line.
 *
 *   {
 *     "risk":  { "type": "enum", "values": ["high", "medium", "low"] },
 *     "score": { "type": "number", "min": 0, "max": 100 },
 *     "note":  { "type": "string", "optional": true }
 *   }
 */

export type FieldSpec =
	| { type: 'enum'; values: string[]; optional?: boolean }
	| { type: 'number'; min?: number; max?: number; integer?: boolean; optional?: boolean }
	| { type: 'string'; optional?: boolean }
	| { type: 'boolean'; optional?: boolean }
	| { type: 'array'; of?: 'string' | 'number' | 'boolean'; optional?: boolean };

export type Schema = Record<string, FieldSpec>;

export class SchemaError extends Error {}

const KINDS = ['enum', 'number', 'string', 'boolean', 'array'] as const;

/**
 * Parse and validate the schema itself.
 *
 * A malformed schema silently classifies every run as a failure, which looks
 * exactly like a catastrophically bad prompt. Failing loudly here is the
 * difference between "the model is broken" and "you typo'd a field type".
 */
export function parseSchema(text: string): Schema {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		throw new SchemaError("The schema isn't valid JSON.");
	}
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new SchemaError('The schema must be an object of field definitions.');
	}

	const out: Schema = {};
	for (const [name, spec] of Object.entries(raw as Record<string, unknown>)) {
		if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
			throw new SchemaError(`Field "${name}" must be an object, e.g. { "type": "string" }.`);
		}
		const s = spec as Record<string, unknown>;
		const kind = s.type;
		if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) {
			throw new SchemaError(`Field "${name}" needs a type: ${KINDS.join(', ')}.`);
		}

		if (kind === 'enum') {
			const values = s.values;
			if (!Array.isArray(values) || values.length === 0 || values.some((v) => typeof v !== 'string')) {
				throw new SchemaError(`Field "${name}" is an enum and needs a non-empty "values" array of strings.`);
			}
			out[name] = { type: 'enum', values: values as string[], optional: !!s.optional };
		} else if (kind === 'number') {
			out[name] = {
				type: 'number',
				min: typeof s.min === 'number' ? s.min : undefined,
				max: typeof s.max === 'number' ? s.max : undefined,
				integer: !!s.integer,
				optional: !!s.optional
			};
		} else if (kind === 'array') {
			const of = s.of;
			out[name] = {
				type: 'array',
				of: of === 'string' || of === 'number' || of === 'boolean' ? of : undefined,
				optional: !!s.optional
			};
		} else {
			out[name] = { type: kind as 'string' | 'boolean', optional: !!s.optional };
		}
	}

	if (Object.keys(out).length === 0) {
		throw new SchemaError('The schema has no fields.');
	}
	return out;
}

/** A human-readable one-liner per field, for the prompt and the UI. */
export function describeField(name: string, spec: FieldSpec): string {
	const opt = spec.optional ? ' (optional)' : '';
	switch (spec.type) {
		case 'enum':
			return `${name}: one of ${spec.values.map((v) => JSON.stringify(v)).join(' | ')}${opt}`;
		case 'number': {
			const bounds =
				spec.min !== undefined && spec.max !== undefined
					? ` between ${spec.min} and ${spec.max}`
					: spec.min !== undefined
						? ` >= ${spec.min}`
						: spec.max !== undefined
							? ` <= ${spec.max}`
							: '';
			return `${name}: ${spec.integer ? 'integer' : 'number'}${bounds}${opt}`;
		}
		case 'array':
			return `${name}: array${spec.of ? ` of ${spec.of}` : ''}${opt}`;
		default:
			return `${name}: ${spec.type}${opt}`;
	}
}

/** An example object satisfying the schema — used to show the model the shape. */
export function exampleFor(schema: Schema): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [name, spec] of Object.entries(schema)) {
		switch (spec.type) {
			case 'enum':
				out[name] = spec.values[0];
				break;
			case 'number':
				out[name] = spec.min ?? 0;
				break;
			case 'boolean':
				out[name] = true;
				break;
			case 'array':
				out[name] = [];
				break;
			default:
				out[name] = 'string';
		}
	}
	return out;
}
