/**
 * Thread keys — how a site page maps to a discussion.
 *
 * Identity lives in the discussion body, as a marker comment:
 *
 *     <!-- petwan:thread path=/vla-reading/01-what-is-vla/ -->
 *
 * The title is a human-readable mirror ("petwan: /vla-reading/…"), but the
 * marker is authoritative: a title can be edited by hand, the marker is
 * what the service parses. Discussions have no labels and their categories
 * can only be created through the web UI, so neither can carry identity.
 *
 * These are pure functions with no configuration of their own, so they can
 * be imported without a live environment.
 */

const THREAD_MARKER = /<!--\s*petwan:thread\s+path=([^\s>]+)\s*-->/;

/**
 * @param {string} body
 * @returns {string | null} the slug a body claims, or null
 */
export function parseThreadPath(body) {
  if (!body) return null;
  const match = THREAD_MARKER.exec(body);
  return match ? match[1] : null;
}

/**
 * @param {string} slug
 * @returns {string} the title a thread carries
 */
export function threadTitle(slug) {
  return `petwan: ${slug}`;
}

/**
 * Normalise a slug into the form the marker stores.
 *
 * The site hands over a path like "/vla-reading/01-what-is-vla/" — with a
 * leading and trailing slash. The marker keeps exactly that, so the two
 * always compare equal.
 *
 * @param {string} slug
 * @returns {string}
 */
export function normalizeSlug(slug) {
  const trimmed = String(slug ?? "").trim();
  if (!trimmed) return "/";
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}
