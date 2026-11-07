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

The discussion is created when somebody posts the first comment on a page, not
on a page visit: a crawler should not be able to open an empty thread for every
article.

## Where the work happens

| Step | Where | Why |
|---|---|---|
| Read a thread | browser → `api.github.com` | public discussions are served anonymously with `Access-Control-Allow-Origin: *` |
| Render a comment | browser | GitHub's `html+json` media type returns already-sanitized `body_html` |
| Post a comment | browser → `api.github.com/graphql` | the reader's own token, so the comment carries their name |
| Exchange the OAuth code | server | `github.com/login/oauth/access_token` sends no CORS headers |
| Create the discussion | server | only a token with write access to this repository may open one |

So the server does two things and proxies no reads. It listens on
`127.0.0.1:8788` behind nginx under `/api/comments/` and `/api/comments-auth/`,
and is never exposed directly.

## Layout

```
service/
├── server.mjs     HTTP server: OAuth exchange + thread creation
├── config.mjs     environment parsing, fails fast on a missing variable
├── github.mjs     GraphQL and REST access
├── threads.mjs    idempotent per-slug discussion creation
├── thread-key.mjs slug marker parsing and normalisation
└── petwan-comments.service   systemd unit
```

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/comments-auth/config` | `{ clientId, redirectUri }` |
| `POST` | `/api/comments-auth/exchange` | `{ code, codeVerifier, redirectUri }` → `{ token, expiresIn, login }` |
| `POST` | `/api/comments/thread` | `{ slug }` → `{ slug, discussion }`, creating it if absent |

## Configuration

`/etc/petwan-comments.env`, mode `600 root:root`:

| Variable | Meaning | Required |
|---|---|---|
| `GITHUB_APP_CLIENT_ID` | the OAuth app's client id | yes |
| `GITHUB_REPO_TOKEN` | fine-grained PAT, this repository, Discussions read/write | yes |
| `GITHUB_APP_CLIENT_SECRET` | the OAuth app's client secret | no — PKCE covers the exchange |
| `GITHUB_APP_REDIRECT_URI` | the OAuth callback URL | no — defaults to `https://petwan.tech/auth/github/callback/` |
| `COMMENTS_REPOSITORY_ID` | GraphQL node id of this repository | no — baked into `config.mjs` |
| `COMMENTS_CATEGORY_ID` | GraphQL node id of the discussion category | no — baked into `config.mjs` |
| `COMMENTS_REPO` | defaults to `petwan/petwan-comments` | no |
| `COMMENTS_PORT` | defaults to `8788` | no |

The client id, the redirect URI and both node ids are public values: they
appear in the authorize URL and in anonymous API responses. Baking them in
keeps the deployment down to two secrets.

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
GITHUB_APP_CLIENT_ID=… GITHUB_REPO_TOKEN=… node server.mjs
```

The site proxies `/api/comments*` to `127.0.0.1:8788` in development, so the
widget talks to this service and reads threads straight from GitHub.
