# Zhiju login theme

This presentation-only theme extends the bundled `keycloak.v2` login theme in
Keycloak **26.7.0**. It uses the workspace's blue and white palette, typography,
brand, rounded inputs, and visible keyboard focus. It retains Keycloak's native
templates, form actions, error binding, password visibility, and authentication
scripts. It does not embed React or shadcn/ui in the identity service.

## Installation

Install or read-only mount the `zhiju` directory at
`/opt/keycloak/themes/zhiju`. In the application's realm, select **Login theme:
zhiju** under **Realm settings → Themes**. Enable internationalization and add
**zh-Hans** under **Localization**, making it the default locale while preserving
the realm's existing supported locales. English is also supported. The message
filename uses `zh_Hans`; the realm locale uses `zh-Hans`.

The workspace environment launcher does not install or select this theme.
Container recreation must preserve the theme mount or reinstall its files.
Apply theme and locale changes only during an authorized deployment. Record the
previous theme and locale settings so they can be restored. Leave the master
realm, clients, authentication flows, credentials, and security policies intact.
Restart the identity service in the deployment window when theme caches are
enabled; keep caching enabled in the deployed environment.

## Verification and upgrades

Use an isolated instance of the repository's pinned Keycloak image with a
synthetic realm, client, and user. Check the actual login form at 1440 px and
320 px, including short windows and page scrolling. Verify Chinese labels,
keyboard navigation, visible focus, password visibility, rejected credentials,
and successful authorization-code login with PKCE. Check accessibility and
ensure the form submits to Keycloak's original action.

Do not substitute static HTML screenshots for a running Keycloak form. The
workspace browser checks cover the application entry, not this independent
service. Recheck the theme after a Keycloak upgrade because bundled markup and
PatternFly selectors can change. CSS color values intentionally match
`src/styles/theme.css`; update both surfaces when the product palette changes.

See [Keycloak's theme documentation](https://www.keycloak.org/ui-customization/themes)
for the parent-theme and resource-loading contract, and the project's
[deployment runbook](../../../.vibe/runbooks/workspace-mvp-e2e-macos.md#登录页面主题)
for installation and rollback boundaries.
