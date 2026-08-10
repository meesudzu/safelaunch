# ADMIN-02 — Admin shell design

## Scope

Add one shared Next.js layout for every `/admin/*` page. Existing legal and
audit pages keep their content but stop rendering duplicate headers and
footers.

## Structure

- Header: SafeLaunch Admin identity, authenticated reviewer email, Access
  logout link.
- Navigation: legal review queue and audit log as active links; Metrics and
  Logs are visible but disabled until their tasks ship.
- Content: child route content owns its page heading and width.
- Footer: the existing audit disclosure appears once.

## Identity and security

Read `cf-access-authenticated-user-email` server-side through `next/headers`.
Never persist it in client storage. If Access is absent in local development,
show a neutral local-development label. Logout uses the application-domain
`/cdn-cgi/access/logout` endpoint.
