# petwan-comments

Comment threads for [petwan.tech](https://petwan.tech).

Every article on the site has one GitHub Discussion here. The site itself
([petwan/sparrow.blog](https://github.com/petwan/sparrow.blog)) is private; this
repository is public, so readers can read the discussions without an account
and can take part by signing in with GitHub.

## How a page maps to a discussion

The **body** of a discussion carries the machine-readable key:

```html
<!-- petwan:thread path=/vla-reading/01-what-is-vla/ -->
```

The title (`petwan: /vla-reading/01-what-is-vla/`) is a human-readable mirror.
The marker is what the service parses — a title can be edited by hand, the
marker cannot drift without the service noticing.

The service creates the discussion the first time somebody opens the page, so
there is nothing to set up per article.

## Layout

```
service/
├── server.mjs     HTTP server: OAuth exchange + cached thread reads
├── config.mjs     environment parsing, fails fast on a missing variable
├── github.mjs     GraphQL and REST access
├── threads.mjs    slug ↔ discussion mapping, thread reads
├── cache.mjs      TTL cache
└── petwan-comments.service   systemd unit
```

The service runs on the site server as `petwan-comments.service`, listens on
`127.0.0.1:8788`, and is reached through nginx under `/api/comments/` and
`/api/comments-auth/`. It is never exposed directly.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/comments-auth/config` | `{ clientId, redirectUri }` |
| `POST` | `/api/comments-auth/exchange` | `{ code, codeVerifier, redirectUri }` → `{ token, expiresIn, login }` |
| `GET` | `/api/comments/thread?slug=…` | the thread and its comments; `&fresh=1` bypasses the cache |
| `POST` | `/api/comments/cache/purge` | `{ slug }` → `204` |

Reads happen here because GitHub's anonymous GraphQL budget is 60 requests per
hour per IP — a limit every reader behind one office NAT would share. Writes
do not happen here: the reader's own token posts straight to GitHub from the
browser, so a comment is attributed to the person who wrote it.

## Configuration

`/etc/petwan-comments.env`, mode `600 root:root`:

| Variable | Meaning |
|---|---|
| `GITHUB_APP_CLIENT_ID` | the GitHub App's client id |
| `GITHUB_APP_CLIENT_SECRET` | the GitHub App's client secret (optional with PKCE) |
| `GITHUB_APP_REDIRECT_URI` | the OAuth callback URL |
| `GITHUB_REPO_TOKEN` | fine-grained PAT, this repository, Discussions read/write |
| `COMMENTS_REPOSITORY_ID` | GraphQL node id of this repository (`R_kgDO…`) |
| `COMMENTS_CATEGORY_ID` | GraphQL node id of the discussion category (`DIC_kwDO…`) |
| `COMMENTS_REPO` | defaults to `petwan/petwan-comments` |
| `COMMENTS_PORT` | defaults to `8788` |

## Moderation

Everything happens in the GitHub interface — there is no custom moderation UI.

| Action | Where |
|---|---|
| Lock a thread | Discussion → "…" → **Lock discussion** |
| Delete a comment | Comment → "…" → **Delete** |
| Edit a comment | Comment → "…" → **Edit** |
| Accept an answer | Comment → "…" → **Accept as answer** |
| Post a note at the top of every thread | edit the discussion body — the site renders it as a banner |

Discussions have no native pin, so the discussion body is the place for a
site-wide note.

## Local development

```bash
cd service
GITHUB_APP_CLIENT_ID=… GITHUB_APP_REDIRECT_URI=… GITHUB_REPO_TOKEN=… \
COMMENTS_REPOSITORY_ID=… COMMENTS_CATEGORY_ID=… \
node server.mjs
```

The site proxies `/api/comments*` to `https://petwan.tech` in development, so
the widget talks to production threads while you work on it.
