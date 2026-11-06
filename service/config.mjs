/**
 * Configuration — read from the environment, validated once at startup.
 *
 * The service runs with systemd's `EnvironmentFile`, which root reads before
 * the process drops to `www-data`. That is why the file can stay mode 600
 * root:root while the process itself runs unprivileged.
 *
 * Every variable is required: a missing one is a deployment mistake, and
 * failing at startup is louder than failing on the first request.
 */

const REQUIRED = [
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_REDIRECT_URI",
  "GITHUB_REPO_TOKEN",
  "COMMENTS_REPOSITORY_ID",
  "COMMENTS_CATEGORY_ID",
];

function readEnv() {
  const missing = REQUIRED.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `missing environment variables: ${missing.join(", ")}\n` +
        "Set them in /etc/petwan-comments.env and restart the unit.",
    );
  }

  const repo = process.env.COMMENTS_REPO ?? "petwan/petwan-comments";
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`COMMENTS_REPO must look like "owner/name", got "${repo}"`);
  }

  return {
    clientId: process.env.GITHUB_APP_CLIENT_ID,
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET ?? "",
    redirectUri: process.env.GITHUB_APP_REDIRECT_URI,
    repoToken: process.env.GITHUB_REPO_TOKEN,
    repositoryId: process.env.COMMENTS_REPOSITORY_ID,
    categoryId: process.env.COMMENTS_CATEGORY_ID,
    owner,
    name,
    repo,
    port: Number(process.env.COMMENTS_PORT ?? 8788),
    host: process.env.COMMENTS_HOST ?? "127.0.0.1",
    // How long a thread payload stays fresh. Comments land within seconds,
    // so a short TTL keeps the page close to live without hammering the API.
    threadTtlMs: Number(process.env.COMMENTS_THREAD_TTL_MS ?? 30_000),
    // The slug -> discussion index changes far less often than the thread
    // contents do.
    indexTtlMs: Number(process.env.COMMENTS_INDEX_TTL_MS ?? 30 * 60_000),
  };
}

export const config = readEnv();
