/** No secrets in URLs, inline scripts, analytics, or third-party page resources. */
export function reviewerSignInPage(): Response {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MasterSelects review access</title>
<main><h1>MasterSelects review access</h1>
<p>Use the dedicated account and access code provided in the review instructions.</p>
<form method="post" action="/api/auth/reviewer">
<p><label>Review account <input name="account" autocomplete="username" required maxlength="80"></label></p>
<p><label>Access code <input name="credential" type="password" autocomplete="current-password" required minlength="43" maxlength="43"></label></p>
<button type="submit">Sign in</button></form>
<p>Your local projects remain on this device.</p></main></html>`, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}
