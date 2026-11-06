/**
 * Threads — mapping a site page to a GitHub Discussion.
 *
 * The key convention lives in ./thread-key.mjs; this module holds the
 * network side: the index, thread creation, and thread reads.
 */

import { config } from "./config.mjs";
import { graphql, rest } from "./github.mjs";
import { TtlCache } from "./cache.mjs";
import { normalizeSlug, parseThreadPath, threadTitle } from "./thread-key.mjs";

export { normalizeSlug, parseThreadPath, threadTitle };

const indexCache = new TtlCache(config.indexTtlMs, 1);
const threadCache = new TtlCache(config.threadTtlMs, 500);

/** In-flight creations, keyed by slug, so two visitors cannot race. */
const creating = new Map();

/**
 * Build the slug -> discussion index from the REST list.
 *
 * The REST list endpoint is the cheap one: one request per 100
 * discussions, with the raw body, so the marker can be parsed out of it.
 * GraphQL would work too but costs a larger payload for the same list.
 *
 * @returns {Promise<Map<string, {number: number, nodeId: string, title: string}>>}
 */
async function buildIndex() {
  /** @type {Map<string, {number: number, nodeId: string, title: string}>} */
  const index = new Map();
  let page = 1;

  while (page <= 10) {
    const { status, body, headers } = await rest(`/discussions?per_page=100&page=${page}`);
    if (status !== 200 || !Array.isArray(body)) break;

    for (const discussion of body) {
      const slug = parseThreadPath(discussion.body);
      if (slug) {
        index.set(normalizeSlug(slug), {
          number: discussion.number,
          nodeId: discussion.node_id,
          title: discussion.title,
        });
      }
    }

    // The Link header carries rel="next" while there are more pages.
    const link = headers.get("link") ?? "";
    if (!link.includes('rel="next"')) break;
    page += 1;
  }

  return index;
}

/**
 * The slug -> discussion index, cached.
 *
 * @returns {Promise<Map<string, {number: number, nodeId: string, title: string}>>}
 */
export async function getIndex() {
  const cached = indexCache.get("index");
  if (cached) return cached;
  const index = await buildIndex();
  return indexCache.set("index", index);
}

/**
 * Find the discussion for a slug, creating it when it does not exist yet.
 *
 * @param {string} rawSlug
 * @returns {Promise<{number: number, nodeId: string, title: string}>}
 */
export async function ensureDiscussion(rawSlug) {
  const slug = normalizeSlug(rawSlug);
  const index = await getIndex();
  const hit = index.get(slug);
  if (hit) return hit;

  const pending = creating.get(slug);
  if (pending) return pending;

  const creation = createDiscussion(slug)
    .then((created) => {
      index.set(slug, created);
      return created;
    })
    .finally(() => {
      creating.delete(slug);
    });

  creating.set(slug, creation);
  return creation;
}

/**
 * @param {string} slug
 * @returns {Promise<{number: number, nodeId: string, title: string}>}
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
        discussion { id number title }
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
  return { number: discussion.number, nodeId: discussion.id, title: discussion.title };
}

const THREAD_QUERY = `
query Thread($owner: String!, $name: String!, $number: Int!, $first: Int!) {
  repository(owner: $owner, name: $name) {
    discussion(number: $number) {
      id
      number
      title
      url
      body
      bodyText
      isLocked
      isAnswered
      createdAt
      author { login avatarUrl }
      answer { id bodyText bodyHTML createdAt author { login avatarUrl } }
      comments(first: $first) {
        totalCount
        nodes {
          id
          body
          bodyText
          bodyHTML
          createdAt
          updatedAt
          isAnswer
          author { login avatarUrl }
          replyTo { id }
        }
      }
    }
  }
}`;

/**
 * Read one thread, with its comments.
 *
 * A page nobody has commented on has no discussion yet — reads never
 * create one (crawlers would otherwise open an empty thread per page).
 * The client calls ensureThread (POST) when the first comment lands.
 *
 * @param {string} rawSlug
 * @param {{fresh?: boolean}} [options]
 * @returns {Promise<object>}
 */
export async function getThread(rawSlug, options = {}) {
  const slug = normalizeSlug(rawSlug);
  const key = `thread:${slug}`;
  if (!options.fresh) {
    const cached = threadCache.get(key);
    if (cached) return { ...cached, cached: true };
  }

  const index = await getIndex();
  const existing = index.get(slug);
  if (!existing) {
    return { slug, discussion: null, body: "", answer: null, comments: [], totalCount: 0, cached: false };
  }

  const data = await graphql(THREAD_QUERY, {
    owner: config.owner,
    name: config.name,
    number: existing.number,
    first: 100,
  });

  const node = data?.repository?.discussion;
  if (!node) throw new Error(`thread ${slug} not found`);

  const payload = {
    slug,
    discussion: {
      id: node.id,
      number: node.number,
      title: node.title,
      url: node.url,
      isLocked: node.isLocked,
      isAnswered: node.isAnswered,
      createdAt: node.createdAt,
      author: node.author,
    },
    body: node.bodyText ?? "",
    answer: node.answer
      ? {
          id: node.answer.id,
          body: node.answer.bodyText ?? "",
          bodyHtml: node.answer.bodyHTML ?? "",
          createdAt: node.answer.createdAt,
          author: node.answer.author,
        }
      : null,
    comments: (node.comments?.nodes ?? []).map((comment) => ({
      id: comment.id,
      body: comment.bodyText ?? "",
      bodyHtml: comment.bodyHTML ?? "",
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      isAnswer: comment.isAnswer,
      author: comment.author,
      replyToId: comment.replyTo?.id ?? null,
    })),
    totalCount: node.comments?.totalCount ?? 0,
  };

  threadCache.set(key, payload);
  return { ...payload, cached: false };
}

/**
 * Create the discussion for a slug when it does not exist yet, then read
 * the thread back. Called when a logged-in reader posts the first comment.
 *
 * @param {string} rawSlug
 * @returns {Promise<object>}
 */
export async function ensureThread(rawSlug) {
  await ensureDiscussion(rawSlug);
  purgeThread(rawSlug);
  return getThread(rawSlug, { fresh: true });
}

/**
 * Drop a thread from the cache.
 *
 * @param {string} rawSlug
 */
export function purgeThread(rawSlug) {
  threadCache.delete(`thread:${normalizeSlug(rawSlug)}`);
}
