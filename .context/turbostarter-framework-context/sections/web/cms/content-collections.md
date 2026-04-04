---
title: Content Collections
description: Get started with Content Collections.
url: /docs/web/cms/content-collections
---

# Content Collections

By default, TurboStarter uses [Content Collections](https://www.content-collections.dev/) to store and retrieve content from the MDX files.

Content from there is used to populate data in the following places:

* **Blog**
* **Legal pages**
* **Documentation**

<Callout title="Why content-collections?">
  It is a great alternative to headless CMS like Contentful or Prismic based on MDX (a more powerful version of markdown). It is free, open source and the content is located right in your repository.
</Callout>

Of course, you can add more collections and views, as it's very flexible.

## Defining new collection

To define a new collection, you need to create a new file in the `packages/cms/src/collections` directory:

```ts title="packages/cms/src/collections/legal/index.ts"
import { defineCollection } from "@content-collections/core";

export const legal = defineCollection({
  name: "legal",
  directory: "src/collections/legal/content",
  include: "**/*.mdx",
  schema: (z) => ({
    title: z.string(),
    description: z.string(),
  }),
  transform: async (doc, context) => {
    const mdx = await transformMDX(doc, context);

    return {
      ...mdx,
      slug: doc._meta.directory,
      locale: doc._meta.fileName.split(".")[0],
    };
  },
});
```

Then it's passed to the config in `packages/cms/content-collections.ts` file which is used to generate types and parse content from MDX files.

```tsx title="packages/cms/content-collections.ts"
import { defineConfig } from "@content-collections/core";

import { legal } from "./src/collections/legal";

export default defineConfig({
  collections: [legal],
});
```

When you run a development server, content collections will be automatically rebuilt (in `.content-collections` directory) and you will be able to import the content and metadata of each file in your application.

<Callout title="It's fully type-safe!">
  By exporting the generated content you get fully type-safe API to interact
  with the content. We can have type safety on the data that we're receiving
  from the MDX files.
</Callout>

## Using content collections

To get some content from `@turbostarter/cms` package, you need to use the exposed API that we described in the [Overview section](/docs/web/cms/overview#api):

```tsx title="apps/web/src/app/[locale](marketing)/legal/[slug]/page.tsx"
import { content } from "@turbostarter/cms";

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>;
}) {
  const item = getContentItemBySlug({
    collection: CollectionType.LEGAL,
    slug: (await params).slug,
    locale: (await params).locale,
  });

  return <h1>{title}</h1>;
}
```

Voila! You can now access the content from the MDX files.

<Cards>
  <Card title="Content Collections" description="content-collections.dev" href="https://www.content-collections.dev/" />

  <Card title="MDX" description="mdxjs.com" href="https://mdxjs.com/" />
</Cards>
