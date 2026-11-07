/**
 * GitHub access — GraphQL for everything the REST API does not cover.
 *
 * The REST API can list discussions, but it cannot create one and it cannot
 * read or write discussion comments: those endpoints answer 404. GraphQL
 * is the only surface that does the whole job, so the service speaks
 * GraphQL throughout and uses REST only for the cheap index build.
 *
 * The token here is the service's own fine-grained PAT, scoped to one
 * repository with Discussions read/write. The reader's own token never
 * reaches the server: posting happens in the browser so the comment is
 * attributed to the person who wrote it.
 */

import { config } from "./config.mjs";

const GRAPHQL_URL = "https://api.github.com/graphql";
const REST_URL = `https://api.github.com/repos/${config.repo}`;

/**
 * Run a GraphQL document.
 *
 * @param {string} query
 * @param {Record<string, unknown>} [variables]
 * @param {string} [token] defaults to the service token
 * @returns {Promise<any>} the `data` payload
 * @throws {Error} when GitHub reports errors
 */
export async function graphql(query, variables = {}, token = config.repoToken) {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
      "User-Agent": "petwan-comments",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`graphql ${response.status}: ${text.slice(0, 400)}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    const message = payload.errors.map((e) => e.message).join("; ");
    throw new Error(`graphql error: ${message}`);
  }
  return payload.data;
}

/**
 * GET a REST path with the service token.
 *
 * @param {string} path appended to the repository URL
 * @returns {Promise<{status: number, body: any, headers: Headers}>}
 */
export async function rest(path) {
  const response = await fetch(`${REST_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${config.repoToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "petwan-comments",
    },
  });

  let body = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body, headers: response.headers };
}

/**
 * Exchange an OAuth authorization code for an access token.
 *
 * This has to happen server-side: github.com/login/oauth/access_token
 * returns no Access-Control-Allow-Origin header, so a browser cannot call
 * it. PKCE means the code_verifier proves the caller owns the
 * authorization request, but GitHub still requires the client_secret to
 * identify the client — without it the exchange answers
 * `incorrect_client_credentials`. The client_id and the redirect_uri are
 * pinned to the configured values: an endpoint that swapped arbitrary codes
 * for tokens would be a credential oracle for every other app.
 *
 * @param {{code: string, codeVerifier: string, redirectUri: string}} input
 * @returns {Promise<{token: string, expiresIn: number, login: string}>}
 */
export async function exchangeCode({ code, codeVerifier, redirectUri }) {
  if (redirectUri !== config.redirectUri) {
    throw new Error("redirect_uri does not match the configured value");
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
  });

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "petwan-comments",
    },
    body,
  });

  const payload = await response.json();
  if (payload.error) {
    throw new Error(`oauth: ${payload.error_description ?? payload.error}`);
  }
  if (!payload.access_token) {
    throw new Error("oauth: no access_token in the response");
  }

  return {
    token: payload.access_token,
    expiresIn: Number(payload.expires_in ?? 0),
    login: await resolveLogin(payload.access_token),
  };
}

/**
 * Look up the account a token belongs to.
 *
 * @param {string} token
 * @returns {Promise<string>} the login
 */
export async function resolveLogin(token) {
  const data = await graphql("{ viewer { login avatarUrl } }", {}, token);
  return data?.viewer?.login ?? "unknown";
}
