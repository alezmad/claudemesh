---
title: Deployment
description: Find answers to common web deployment issues.
url: /docs/web/troubleshooting/deployment
---

# Deployment

## Deployment build fails

This is most likely an issue related to the environment variables not being set correctly in the deployment environment. Please analyse the logs of the deployment provider to see what is the issue.

The kit is very defensive about incorrect environment variables, and will throw an error if any of the required environment variables are not set. In this way - the build will fail if the environment variables are not set correctly - instead of deploying a broken application.

Check our guides for the most popular hosting providers for more information on how to deploy your TurboStarter project correctly:

<Cards>
  <Card title="Vercel" description="Deploy your TurboStarter web app to Vercel platform." href="/docs/web/deployment/vercel" />

  <Card title="Netlify" description="Deploy your TurboStarter web app to Netlify platform." href="/docs/web/deployment/netlify" />

  <Card title="Render" description="Deploy your TurboStarter web app to Render platform." href="/docs/web/deployment/render" />

  <Card title="Railway" description="Deploy your TurboStarter web app to Railway platform." href="/docs/web/deployment/railway" />

  <Card title="AWS Amplify" description="Deploy your TurboStarter web app to AWS Amplify platform." href="/docs/web/deployment/amplify" />

  <Card title="Docker" description="Containerize your TurboStarter web app using Docker." href="/docs/web/deployment/docker" />

  <Card title="Fly.io" description="Deploy your TurboStarter web app to Fly.io platform." href="/docs/web/deployment/fly" />
</Cards>

## What should I set as a URL before my first deployment?

That's very good question! For the first deployment you can set any URL, and then, after you (or your provider) assign a domain name, you can change it to the correct one. There's nothing wrong with redeploying your project multiple times.

## Sign in with OAuth provider doesn't work

This is most likely a settings issues in the provider's settings. To troubleshoot this issue, follow these steps:

1. **Verify provider settings**: Ensure that the OAuth provider's settings are correctly configured. Check that the client ID, client secret, and redirect URI are accurate and match the values in your application.
2. **Check environment variables**: Confirm that the environment variables for the OAuth provider are set correctly in your application production environment.
3. **Validate callback URLs**: Ensure that the callback URLs for each provider are set correctly and match the URLs in your application. This is crucial for the OAuth flow to work correctly.

Please read [Better Auth documentation](https://www.better-auth.com/docs/concepts/oauth) for more information on how to set up third-party providers.
