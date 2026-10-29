/*
 * The Google OAuth client the CLI's local mode uses when `~/.collected/.env` names none.
 *
 * These two strings belong to an OAuth client of type "Desktop app" in the collected Google Cloud project (the same
 * project as the web client, so one consent screen, one set of scopes and one verification cover both;
 * artifacts/SETUP.md says how it is created). A desktop client accepts `http://127.0.0.1:<any port>/...` as a
 * redirect URI without registration, which is what lets `collected ui` and `collected connect google` finish the
 * flow on whatever loopback port they got.
 *
 * Shipping the secret is the sanctioned pattern, not a leak: per Google's installed-app guidance the secret of a
 * desktop client is not treated as confidential (the binary can be read by anyone who installs it), and the flow
 * carries PKCE (core/src/auth/pkce.ts) so a leaked authorization code is useless without the verifier that stayed
 * in the process. An operator who wants their own project sets GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in
 * `~/.collected/.env`, which wins over this pair (agent/src/local.ts).
 *
 * The owner fills the two strings in before a release. While both are empty (this build), Google connect fails
 * softly: `/api/google/start` sends the browser back to Sources with the not-configured reason, the cards say the
 * build ships without a Google client, and `connect google` says so before it listens. Neither value is ever logged.
 */
export const BUILTIN_GOOGLE_CLIENT = { id: '', secret: '' } as const;
