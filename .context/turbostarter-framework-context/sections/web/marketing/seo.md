---
title: SEO
description: Learn how to optimize your app for search engines.
url: /docs/web/marketing/seo
---

# SEO

SEO is an important part of building a website. It helps search engines understand your website and rank it higher in search results. In this guide, you'll learn how to improve your SaaS application's search engine optimization (SEO).

<Callout title="Already optimized!">
  TurboStarter is already optimized for SEO out of the box (including meta tags, sitemaps, robots files and many more). However, there are a few things you can do to improve your application's SEO.
</Callout>

**Content:** High-quality, relevant content is the cornerstone of effective SEO. Focus on **creating valuable, engaging content** that addresses your customers' needs and questions. Regularly update your content to keep it fresh and relevant.

**Keyword optimization:** Conduct thorough keyword research to identify terms your target audience is searching for. Incorporate these keywords naturally into your content, titles, meta descriptions, and headers. Avoid keyword stuffing; prioritize readability and user experience.

**On-Page SEO:**

* Use descriptive, keyword-rich titles and meta descriptions for each page.
* Implement a clear heading structure (H1, H2, H3) to organize your content.
* Optimize images with descriptive file names and alt text.
* Ensure your URLs are clean, descriptive, and include relevant keywords.

**Technical SEO:**

* Improve website loading speed by optimizing images, minifying CSS and JavaScript, and leveraging browser caching.
* Ensure your website is mobile-friendly and responsive across all devices.
* Implement schema markup to help search engines better understand your content.
* Use HTTPS to secure your website and boost search rankings.

**User experience:**

* Design an intuitive site structure and navigation to improve user engagement.
* Reduce bounce rates by creating compelling, easy-to-read content.
* Implement internal linking to guide users through your site and distribute page authority.

**Link building:**

* Create high-quality, shareable content to naturally attract backlinks.
* Engage in guest posting on reputable sites within your industry.
* Participate in industry forums and discussions, providing valuable insights and linking to your content when relevant.
* Leverage social media to increase content visibility and encourage sharing.

**Local SEO (if applicable):**

* Claim and optimize your Google My Business listing.
* Ensure consistent NAP (Name, Address, Phone) information across all online directories.
* Encourage customer reviews on Google and other relevant platforms.

**Monitor and analyze:**

* Use [Google Search Console](https://search.google.com/search-console/about) to monitor your site's performance in search results and identify issues.
* Regularly analyze your SEO efforts using tools like Google Analytics to understand user behavior and refine your strategy.

**Stay updated:**

* Keep abreast of SEO best practices and algorithm updates to continually refine your strategy.
* Regularly audit your website to identify and fix any SEO issues.

## Sitemap

Generally speaking, Google will find your pages without a sitemap as it follows the link in your website. However, you can add pages to the sitemap by adding them to the `apps/web/src/app/sitemap.ts` file, which is used to generate the sitemap.

If you add more static pages to your website, you can add them to the sitemap by adding them to the `apps/web/src/app/sitemap.ts` returned array.

```tsx title="sitemap.ts"
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      ...getEntry(pathsConfig.index),
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
    ...getContentItems({
      collection: CollectionType.BLOG,
      locale: appConfig.locale,
    }).items.map<MetadataRoute.Sitemap[number]>((post) => ({
      ...getEntry(pathsConfig.marketing.blog.post(post.slug)),
      lastModified: new Date(post.lastModifiedAt),
      changeFrequency: "monthly",
      priority: 0.7,
    })),

    /* other pages */
  ];
}
```

All the existing pages are already added to the sitemap. You don't need to add them manually.

## Meta tags

TurboStarter provides a helper function called `getMetadata` to easily set meta tags for your pages. This helper ensures consistent metadata formatting across your site and includes essential SEO tags like title, description, and Open Graph tags. You can use it in any page's metadata export:

```tsx title="page.tsx"
export const generateMetadata = getMetadata({
  title: "My Page Title",
  description: "My Page Description",
});
```

This will generate the following meta tags:

```html
<meta name="description" content="My Page Description" />
<meta property="og:title" content="My Page Title" />
<meta property="og:description" content="My Page Description" />
```

The `getMetadata` helper is really useful for generating consistent meta tags across your site, making SEO optimization simpler and more reliable.

<Callout title="Translations supported!">
  `getMetadata` also supports translations. You can pass a translation key to the `title` and `description` parameters, and it will automatically use the correct translation for the current locale.

  ```tsx
  export const generateMetadata = getMetadata({
    title: "billing:title",
    description: "billing:description",
  });
  ```

  In this example, the `title` and `description` will be fetched from the `billing` namespace for the current locale and placed in the meta tags.
</Callout>

## Backlinks

Backlinks are said to be the **most important factor** in modern SEO. The more backlinks you have from high-quality websites, the higher your website will rank in search results - and the more traffic you'll get.

How do you acquire backlinks? The most effective strategy is to create high-quality, valuable content that naturally attracts links from other websites. However, there are several other methods to build backlinks:

1. **Guest blogging:** Contribute articles to reputable websites within your industry. This not only provides backlinks but also exposes your brand to a new audience.
2. **Strategic outreach:** Identify websites that could benefit from linking to your content. Reach out with a personalized pitch, explaining the value your content adds to their audience.
3. **Digital PR:** Create newsworthy content or conduct original research that journalists and bloggers will want to reference and link to.
4. **Broken link building:** Find broken links on relevant websites and suggest your content as a replacement.
5. **Resource page link building:** Find resource pages in your niche and suggest your content for inclusion.
6. **Social media engagement:** While not directly impacting SEO, active social media presence can increase content visibility and indirectly lead to more backlinks.
7. **Create linkable assets:** Develop infographics, tools, or comprehensive guides that others in your industry will want to reference.
8. **Participate in industry forums and discussions:** Contribute meaningfully to conversations in your field, including your website when relevant.

Remember, the quality of backlinks is more important than quantity. Focus on acquiring links from authoritative, relevant websites in your niche. Avoid any black-hat techniques or link schemes that could result in penalties from search engines.

## Adding your website to Google Search Console

Once you've optimized your website for SEO, you can add it to Google Search Console. Google Search Console is a free tool that helps you monitor and maintain your website's presence in Google search results.

You can use it to check your website's indexing status, submit sitemaps, and get insights into how Google sees your website.

The first thing you need to do is verify your website in Google Search Console. You can do this by adding a meta tag to your website's HTML or by uploading an HTML file to your website.

Once you've verified your website, you can submit your sitemap to Google Search Console. This will help Google find and index your website's pages faster.

Please submit your sitemap to Google Search Console by going to the `Sitemaps` section and adding the URL of your sitemap. The URL of your sitemap is `https://your-website.com/sitemap.xml`.

Of course, please replace `your-website.com` with your actual website URL.

## Content

When it comes to internal factors, **content is king**. Make sure your content is relevant, useful, and engaging. Make sure it's updated regularly and optimized for SEO.

<Callout title="What should you write about?">
  Most importantly, you want to think about how your customers will search for the problem your SaaS is solving. For example, if you're building a project management tool, you might want to write about project management best practices, how to manage a remote team, or how to use your tool to improve productivity.
</Callout>

You can use the blog and documentation features in TurboStarter to create high-quality content that will help your website rank higher in search results - and help your customers find what they're looking for.

## Indexing and ranking take time

New websites can take a while to get indexed by search engines. It can take anywhere from a few days to a few weeks (in some cases, even months!) for your website to show up in search results. Be patient and keep updating your content and optimizing your website for search engines.

Also, you can edit `robots.ts` file to control which pages are indexed by search engines:

```tsx title="robots.ts"
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api", "/dashboard", "/auth"],
    },
    sitemap: appConfig.url + "/sitemap.xml",
  };
}
```

Remember, **SEO is an ongoing process.** Consistently apply these practices and adapt your strategy based on performance data and industry changes to improve your search engine visibility over time.
