---
title: Overview
description: Manage your content in TurboStarter.
url: /docs/web/cms/overview
---

# Overview

TurboStarter implements a CMS interface that abstracts the implementation from where you store your data. It provides a simple API to interact with your data, and it's easy to extend and customize.

By default, the starter kit ships with these implementations in place:

1. [Content Collections](https://www.content-collections.dev/) - a headless CMS that uses [MDX](https://mdxjs.com/) files to store your content.

The implementation is available under `@turbostarter/cms` package, here we'll go over how to use it.

## API

The CMS package provides a simple, unified API to interact with the content. It's the same for all the providers, so you can easily use it with any of the implementations without changing the code.

### Fetching content items

To fetch items from your colletions, you can use the `getContentItems` function.

```ts
import { getContentItems } from "@turbostarter/cms";

const { items, count } = getContentItems({
  collection: CollectionType.BLOG,
  tags: [ContentTag.SKILLS],
  sortBy: "publishedAt",
  sortOrder: SortOrder.DESCENDING,
  status: ContentStatus.PUBLISHED,
  locale: "en",
});
```

It accepts an object with the following properties:

* `collection`: The collection to fetch the items from.
* `tags`: The tags to filter the items by.
* `sortBy`: The field to sort the items by.
* `sortOrder`: The order to sort the items in.
* `status`: The status of the items to fetch. It can be `published` or `draft`. By default, only `published` items are fetched.
* `locale`: The locale to fetch the items in. By default, all locales are fetched.

### Fetching a single content item

To fetch a single content item, you can use the `getContentItemBySlug` function.

```ts
import { getContentItemBySlug } from "@turbostarter/cms";

const item = getContentItemBySlug({
  collection: CollectionType.BLOG,
  slug: "my-first-blog-post",
  status: ContentStatus.PUBLISHED,
  locale: "en",
});
```

It accepts an object with the following properties:

* `collection`: The collection to fetch the item from.
* `slug`: The slug of the item to fetch.
* `status`: The status of the item to fetch. It can be `published` or `draft`. By default, only `published` items are fetched.
* `locale`: The locale to fetch the item in. By default, all locales are fetched.
