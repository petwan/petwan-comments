/**
 * End-to-end check of the service against the live GitHub API.
 *
 * Usage: node smoke-test.mjs
 *
 * Needs the same environment the service reads:
 *   GITHUB_APP_CLIENT_ID, GITHUB_APP_REDIRECT_URI, GITHUB_REPO_TOKEN,
 *   COMMENTS_REPOSITORY_ID, COMMENTS_CATEGORY_ID
 *
 * It exercises the read path against a real thread and creates one if the
 * repository has none, then reads it back. Nothing is deleted — a
 * throwaway discussion is left behind for the maintainer to remove.
 */

import { config } from "./config.mjs";
import { getIndex, getThread, ensureDiscussion } from "./threads.mjs";
import { parseThreadPath } from "./thread-key.mjs";

const TEST_SLUG = "/smoke-test/";

async function main() {
  console.log(`repo: ${config.repo}`);
  console.log(`repositoryId: ${config.repositoryId}`);
  console.log(`categoryId: ${config.categoryId}`);

  console.log("\n--- index ---");
  const index = await getIndex();
  console.log(`  threads found: ${index.size}`);
  for (const [slug, entry] of [...index.entries()].slice(0, 5)) {
    console.log(`  ${slug} -> #${entry.number} ${entry.title}`);
  }

  console.log("\n--- ensureDiscussion (creates if missing) ---");
  const discussion = await ensureDiscussion(TEST_SLUG);
  console.log(`  #${discussion.number} ${discussion.title}`);
  console.log(`  nodeId: ${discussion.nodeId}`);

  console.log("\n--- getThread ---");
  const thread = await getThread(TEST_SLUG, { fresh: true });
  console.log(`  slug: ${thread.slug}`);
  console.log(`  number: ${thread.discussion.number}`);
  console.log(`  locked: ${thread.discussion.isLocked}`);
  console.log(`  answered: ${thread.discussion.isAnswered}`);
  console.log(`  comments: ${thread.comments.length} (total ${thread.totalCount})`);
  console.log(`  body starts: ${thread.body.slice(0, 60)}`);

  console.log("\n--- index sees the new thread ---");
  const freshIndex = await getIndex();
  console.log(`  threads: ${freshIndex.size}`);
  const found = [...freshIndex.entries()].find(([slug]) => slug === TEST_SLUG);
  console.log(`  ${TEST_SLUG} -> ${found ? `#${found[1].number}` : "not in index (index TTL not elapsed)"}`);

  console.log("\n--- marker round-trip ---");
  const reread = await getThread(TEST_SLUG, { fresh: true });
  console.log(`  parsed slug: ${parseThreadPath(`<!-- petwan:thread path=${reread.slug} -->`)}`);
}

main().catch((error) => {
  console.error(`FAILED: ${error.message}`);
  process.exit(1);
});
