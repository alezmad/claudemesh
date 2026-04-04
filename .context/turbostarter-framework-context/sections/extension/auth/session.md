---
title: Session
description: Learn how to manage the user session in your extension.
url: /docs/extension/auth/session
---

# Session

We're not implementing fully-featured auth flow in the extension. Instead, **we're sharing the same auth session with the web app.**

It's a common practice in the industry used e.g. by [Notion](https://www.notion.so) and [Google Workspace](https://workspace.google.com/).

That way, when the user is signed in to the web app, the extension can use the same session to authenticate the user, so he doesn't have to sign in again. Also signing out from the extension will affect both platforms.

<Callout title="Remember to add your extension scheme as trusted origin">
  For browser extensions, we need to define an [authentication trusted origin](https://www.better-auth.com/docs/reference/security#trusted-origins) using an extension scheme.

  Extension schemes (like `chrome-extension://...`) are used for redirecting users to specific screens after authentication and sharing the auth session with the web app.

  To find your extension ID, open Chrome and go to `chrome://extensions/`, enable Developer Mode in the top right, and look for your extension's ID. Then add it to your auth server configuration:

  ```ts title="server.ts"
  export const auth = betterAuth({
    ...

    trustedOrigins: ["chrome-extension://your-extension-id"],

    ...
  });
  ```

  Adding your extension scheme to the trusted origins list is crucial for security - it prevents CSRF attacks and blocks malicious open redirects by ensuring only requests from approved origins (your extension) are allowed through.

  [Read more about auth security in Better Auth's documentation.](https://www.better-auth.com/docs/reference/security)
</Callout>

## Cookies

When the user signs in to the [web app](/docs/web) through our [Better Auth API](/docs/web/auth/configuration#api), web app is setting the cookie with the session token under your app's domain, which is later used to validate the session on the server.

You can find your cookie in *Cookies* tab in the browser's developer tools (remember to be logged in to the app to check it):

![Session cookie](/images/docs/extension/auth/cookie.png)

To enable your extension to read the cookie and that way share the session with the web app, you need to set the `cookies` permission in the `wxt.config.ts` under `manifest.permissions` field:

```ts title="wxt.config.ts"
export default defineConfig({
  manifest: {
    permissions: ["cookies"],
  },
});
```

And to be able to read the cookie from your app url, you need to set `host_permissions`, which will include your app url:

```ts title="wxt.config.ts"
export default defineConfig({
  manifest: {
    host_permissions: ["http://localhost/*", "https://your-app-url.com/*"],
  },
});
```

Then you would be able to share the cookie with API requests and also read its value using `browser.cookies` API.

<Callout title="Avoid &#x22;<all_urls>&#x22;" type="warn">
  Avoid using `<all_urls>` in `host_permissions`. It affects all urls and may cause security issues, as well as a [rejection](https://developer.chrome.com/docs/webstore/review-process#review-time-factors) from the destination store.
</Callout>

<Cards>
  <Card title="Declare permissions" href="https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions" description="developer.chrome.com" />

  <Card title="chrome.cookies" href="https://developer.chrome.com/docs/extensions/reference/api/cookies" description="developer.chrome.com" />
</Cards>

## Reading session

You **don't** need to worry about reading, parsing, or validating the session cookie. TurboStarter comes with a pre-built solution that ensures your session is correctly shared with the web app.

It also ensures that appropriate cookies are passed to [API](/docs/web/api/overview) requests, so you can safely use [protected endpoints](/docs/web/api/protected-routes) (that require authentication) in your extension.

To get session details in your extension code (e.g., inside a popup window), you can leverage the `useSession` hook provided by the [auth client](https://www.better-auth.com/docs/basic-usage#client-side) (which is also used in the web and mobile apps):

```tsx title="user.tsx"
import { authClient } from "~/lib/auth";

const User = () => {
  const {
    data: { user, session },
    isPending,
  } = authClient.useSession();

  if (isPending) {
    return <p>Loading...</p>;
  }

  /* do something with the session data... */
  return <p>{user?.email}</p>;
};
```

That's how you can access user details right in your extension.

## Signing out

Signing out from the extension also involves using the well-known `signOut` function that is derived from our [auth client](https://www.better-auth.com/docs/basic-usage#signout):

```tsx title="logout.tsx"
import { authClient } from "~/lib/auth";

export const Logout = () => {
  return <button onClick={() => authClient.signOut()}>Log out</button>;
};
```

The session is automatically invalidated, so the next use of `useSession` or any other query that depends on the session will return `null`. The UI for both the extension and the web app will be updated to show the user as logged out.

<Callout title="This will sign out the user from the web app as well" type="warn">
  As web app is using the same session cookie, the user will be signed out from the web app as well. **This is intentional**, as your extension will most probably serves as an add-on for the web app and it doesn't make sense to keep the user signed in there if the extension is not used.
</Callout>

![Sign out](/images/docs/web/auth/sign-out.png)
