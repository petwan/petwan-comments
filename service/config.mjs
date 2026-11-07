/**
 * Configuration — read from the environment, validated once at startup.
 *
 * The service runs with systemd's `EnvironmentFile`, which root reads before
 * the process drops to `www-data`. That is why the file can stay mode 600
 * root:root while the process itself runs unprivileged.
 *
 * Only the repository token is a real secret. Everything else — the OAuth
 * client id, the redirect URI, and the two GraphQL node ids — is public
 * information that ships with the site, so they carry defaults here and the
 * deployment can leave them unset.
 */

const PUBLIC_DEFAULTS = {
  GITHUB_APP_REDIRECT_URI: "https://petwan.tech/auth/github/callback/",
  // The petwan/petwan-comments repository's GraphQL node id and the
  // Discussions category new threads land in (General).
  COMMENTS_REPOSITORY_ID: "R_kgDOVldYDg",
  COMMENTS_CATEGORY_ID: "DIC_kwDOVldYDs4DKk_7",
};

function readEnv() {
  // The OAuth app's client id is public, but only you know it, so it has no
  // default here. The repository token is the one real secret.
  const missing = ["GITHUB_APP_CLIENT_ID", "GITHUB_REPO_TOKEN"]
    .filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `missing environment variables: ${missing.join(", ")}\n` +
        "GITHUB_APP_CLIENT_ID is the OAuth app's public client id; " +
        "GITHUB_REPO_TOKEN is a fine-grained PAT with Discussions read/write. " +
        "Set them in /etc/petwan-comments.env and restart the unit.",
    );
  }

  const repo = process.env.COMMENTS_REPO ?? "petwan/petwan-comments";
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`COMMENTS_REPO must look like "owner/name", got "${repo}"`);
  }

  const value = (key) => process.env[key] ?? PUBLIC_DEFAULTS[key];

  return {
    clientId: value("GITHUB_APP_CLIENT_ID"),
    // Optional: PKCE means the exchange works without it. Set it if the
    // OAuth app has one and you want GitHub to verify the caller too.
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET ?? "",
    redirectUri: value("GITHUB_APP_REDIRECT_URI"),
    repoToken: process.env.GITHUB_REPO_TOKEN,
    repositoryId: value("COMMENTS_REPOSITORY_ID"),
    categoryId: value("COMMENTS_CATEGORY_ID"),
    owner,
    name,
    repo,
    port: Number(process.env.COMMENTS_PORT ?? 8788),
    host: process.env.COMMENTS_HOST ?? "127.0.0.1",
  };
}

export const config = readEnv();
