---
title: Blog
description: Learn how to manage your blog content.
url: /docs/web/cms/blog
---

# Blog

TurboStarter comes with a pre-configured blog implementation that allows you to manage your blog content.

## Creating a new blog post

To create a new blog post, you need to create a new directory (its name will be used as the slug of the blog post) with `.mdx` files in the `packages/cms/src/collections/blog/content` directory. Each file in this directory should be named after the locale it belongs to (e.g `en.mdx`, `es.mdx`, etc.).

The file will start with a [frontmatter](https://mdxjs.com/guides/frontmatter/) block, which is a yaml-like block that contains metadata about the post. The frontmatter block should be surrounded by three dashes (`---`).

```mdx title="packages/cms/src/collections/blog/content/my-first-blog-post/en.mdx"
---
title: Quick Tips to Improve Your Skills Right Away
description: Whether you're learning a new technical skill or working on personal development, these quick tips can help you improve right away. Learn how to break down your goals, practice consistently, and track your progress using Markdown.
publishedAt: 2023-04-19
tags: [learning, skills, progress]
thumbnail: https://images.unsplash.com/photo-1483639130939-150975af84e5?q=80&w=2370&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D
status: published
---
```

Let's break down the frontmatter fields:

* `title`: The title of the blog post (it will be also used to generate a slug for the blog post)
* `description`: The description of the blog post
* `publishedAt`: The date when the blog post was published
* `tags`: The tags of the blog post
* `thumbnail`: The thumbnail of the blog post
* `status`: The status of the blog post (could be `published` or `draft`)

After the frontmatter block, you can add the content of the blog post:

```mdx title="packages/cms/src/collections/blog/content/my-first-blog-post/en.mdx"
# Quick Tips to Improve Your Skills Right Away

Awesome paragraph!

[Link](https://www.turbostarter.dev)

<Callout>This is a callout component.</Callout>

...
```

You can consume the content the same as it's described in [Content Collections](/docs/web/cms/content-collections).

## BONUS: Using custom components

As you're using MDX, you can use **any React component** in your blog posts. Just define it as a normal React component and pass it to `<MdxContent />` in `components` prop:

```tsx title="apps/web/src/app/content/page.tsx"
import { MyComponent } from "~/modules/common/my-component";

export default function Page() {
  return (
    <MDXContent
      code={data.body}
      components={{ ...defaultMdxComponents, MyComponent }}
    />
  );
}
```

Then, you would be able to use it in your document content and it will rendered on the page as a result:

```mdx title="packages/cms/src/collections/blog/content/my-first-blog-post/en.mdx"
...

# Heading

Excellent paragraph!

<MyComponent />

1. First item
2. Second item
3. Third item
```

TurboStarter ships with a set of default components that you can use in your blog posts, e.g. `<Callout />`, `<Card />` etc. Use them or define your own to make your blog posts more engaging.
