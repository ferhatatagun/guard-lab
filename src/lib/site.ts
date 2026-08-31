/**
 * The canonical origin, in one place.
 *
 * It appears in the metadata base, the JSON-LD, the sitemap and robots.txt.
 * A copy that drifts out of sync doesn't fail a build — it quietly points
 * crawlers at a domain that isn't this one.
 */
export const SITE_ORIGIN = 'https://guard-lab.vercel.app';
