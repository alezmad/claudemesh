---
title: Marketing pages
description: Discover which marketing pages are available out of the box and how to add a new one.
url: /docs/web/marketing/pages
---

# Marketing pages

TurboStarter comes with pre-defined marketing pages to help you get started with your SaaS application. These pages are built with Next.js and Tailwind CSS and are located in the `apps/web/src/app/[locale]/(marketing)` directory.

TurboStarter comes with the following marketing pages:

* **Home**: conversions-optimized [landing page](https://demo.turbostarter.dev) with [hero section](https://demo.turbostarter.dev#hero), [features](https://demo.turbostarter.dev#features), [pricing](https://demo.turbostarter.dev#pricing), [testimonials](https://demo.turbostarter.dev#testimonials), [FAQ](https://demo.turbostarter.dev#faq) and more
* [Blog](/docs/web/cms/blog): to display your blog posts
* **Pricing**: to display your pricing plans
* **Contact**: to enable users to contact you with a contact form

## Contact form

To make the contact form work, you need to add the following environment variable:

```dotenv
CONTACT_EMAIL=
```

Set this variable to the email address where you want to receive contact form submissions. The sender's email address will match what you configured in your [mailing configuration](/docs/web/emails/configuration).

## Adding a new marketing page

To add a new marketing page, create a new directory in `apps/web/src/app/[locale]/(marketing)` with the desired route name.

The page will automatically become available in your application at the corresponding URL path.

For example, to create a page accessible at `/about`, create a directory named `about` and add a `page.tsx` file inside it. The complete path would be `apps/web/src/app/[locale]/(marketing)/about/page.tsx`.

```tsx title="apps/web/src/app/[locale]/(marketing)/about/page.tsx"
export default function AboutPage() {
  return <div>About</div>;
}
```

This page inherits the layout at `apps/web/src/app/[locale]/(marketing)/layout.tsx`. You can customize the layout by editing this file - but remember that it will affect all marketing pages.
