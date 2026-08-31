/**
 * The statistics of "it worked when I tested it".
 *
 * Schema failures are distributional. You run a prompt once, it returns clean
 * JSON, you ship. Then one call in forty invents an enum value and you never
 * see it, because you looked at one sample.
 *
 * The trap this module exists to close is the *clean* run. Fifty runs with
 * zero failures feels like proof. It isn't: with n = 50 the data is still
 * consistent with a true failure rate near 6%, and at production volume 6% is
 * not a rounding error. Reporting "0 failures" without that bound is the
 * single most misleading thing this tool could do, so it doesn't.
 */

/** Wilson score interval — well-behaved at 0 and 1, where the normal approximation isn't. */
export function wilson(successes: number, n: number, z = 1.96): { lo: number; hi: number } {
	if (n === 0) return { lo: 0, hi: 1 };
	const p = successes / n;
	const z2 = z * z;
	const denom = 1 + z2 / n;
	const centre = p + z2 / (2 * n);
	const spread = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
	return {
		lo: Math.max(0, (centre - spread) / denom),
		hi: Math.min(1, (centre + spread) / denom)
	};
}

export interface RateEstimate {
	/** Observed failures ÷ runs. */
	observed: number;
	/** 95% interval on the true rate. */
	lo: number;
	hi: number;
	/** True when nothing failed — the case that needs the caveat most. */
	zeroObserved: boolean;
}

export function failureRate(failures: number, runs: number): RateEstimate {
	const { lo, hi } = wilson(failures, runs);
	return {
		observed: runs === 0 ? 0 : failures / runs,
		lo,
		hi,
		zeroObserved: failures === 0 && runs > 0
	};
}

/**
 * Runs needed before a clean sweep can rule out a given rate.
 *
 * The textbook shortcut here is the rule of three — zero events in n trials
 * bounds the rate near 3/n, so ~300 runs for 1%. It is not used, because this
 * tool reports a Wilson bound everywhere else and Wilson is slightly more
 * conservative at zero: 300 clean runs actually bound the rate at 1.26%. A
 * tool that promises 300 and then reports 1.26% is arguing with itself in
 * front of the user.
 *
 * So this inverts the same interval the UI displays. With k = 0 the Wilson
 * upper bound collapses to z² / (n + z²), which solves exactly:
 *
 *     n = z²(1 - rate) / rate
 *
 * Ruling out 1% takes 381 clean runs, which is a more deflating number than
 * 300 and the one that matches what the tool will tell you afterwards.
 */
export function runsToRuleOut(rate: number, z = 1.96): number {
	if (rate <= 0) return Infinity;
	if (rate >= 1) return 0;
	return Math.ceil((z * z * (1 - rate)) / rate);
}

/** Expected bad records per day, which is the unit the argument is actually about. */
export function projectedDefects(rate: number, callsPerDay: number): number {
	return rate * callsPerDay;
}

export function formatRate(r: number): string {
	if (r === 0) return '0%';
	if (r < 0.001) return '<0.1%';
	if (r < 0.01) return `${(r * 100).toFixed(2)}%`;
	return `${(r * 100).toFixed(1)}%`;
}

export function formatCount(n: number): string {
	if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
	if (n >= 10) return n.toFixed(0);
	if (n >= 1) return n.toFixed(1);
	return n.toFixed(2);
}
