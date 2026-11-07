/**
 * Threads — creating the discussion that backs a page.
 *
 * Reads and writes both happen in the browser: the REST API serves public
 * discussions anonymously (with `Access-Control-Allow-Origin: *`) and the
 * reader's own token posts comments through GraphQL. The one thing a
 * reader's token cannot do is create a discussion — that needs write access
 * to the repository — so creation is the only thread work the server does.
 *
 * Creation is idempotent per slug: the in-flight map stops two visitors who
 * comment at the same moment from opening two threads for one page.
 */

import { config } from "./config.mjs";
import { graphql, rest } from "./github.mjs";
import { normalizeSlug, parseThreadPath, threadTitle } from "./thread-key.mjs";

export { normalizeSlug, parseThreadPath, threadTitle };

/** In-flight creations, keyed by slug. */
const creating = new Map();

/**
 * Find the discussion already serving a slug.
 *
 * One REST page covers 100 threads. A comment section reaching that many
 * pages would be a good problem to have; until then, the single request
 * is cheaper than paginating.
 *
 * @param {string} slug normalized
 * @returns {Promise<{id: string, number: number, title: string, url: string} | null>}
 */
async function findExisting(slug) {
  const { status, body } = await rest("/discussions?per_page=100");
  if (status !== 200 || !Array.isArray(body)) return null;

  for (const discussion of body) {
    const parsed = parseThreadPath(discussion.body);
    // `null` means "this discussion has no marker" — not the "/" page.
    if (parsed && normalizeSlug(parsed) === slug) {
      return {
        id: discussion.node_id,
        number: discussion.number,
        title: discussion.title,
        url: discussion.html_url,
      };
    }
  }
  return null;
}

/**
 * Create the discussion for a slug.
 *
 * @param {string} slug normalized
 * @returns {Promise<{id: string, number: number, title: string, url: string}>}
 */
async function createDiscussion(slug) {
  const body = [
    `<!-- petwan:thread path=${slug} -->`,
    `<!-- petwan:site https://petwan.tech${slug} -->`,
    "",
    "Comments for this page. The site owns this thread; the marker above is the machine-readable key.",
  ].join("\n");

  const data = await graphql(
    `mutation CreateDiscussion($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
      createDiscussion(input: { repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body }) {
        discussion { id number title url }
      }
    }`,
    {
      repositoryId: config.repositoryId,
      categoryId: config.categoryId,
      title: threadTitle(slug),
      body,
    },
  );

  const discussion = data?.createDiscussion?.discussion;
  if (!discussion) throw new Error("createDiscussion returned no discussion");
  return discussion;
}

/**
 * Return the discussion for a slug, creating it when it does not exist yet.
 *
 * @param {string} rawSlug
 * @returns {Promise<{id: string, number: number, title: string, url: string}>}
 */
export function ensureDiscussion(rawSlug) {
  const slug = normalizeSlug(rawSlug);

  const pending = creating.get(slug);
  if (pending) return pending;

  const creation = (async () => {
    const existing = await findExisting(slug);
    return existing ?? createDiscussion(slug);
  })().finally(() => {
    creating.delete(slug);
  });

  creating.set(slug, creation);
  return creation;
}
