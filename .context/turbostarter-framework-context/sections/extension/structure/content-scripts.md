---
title: Content scripts
description: Learn more about content scripts.
url: /docs/extension/structure/content-scripts
---

# Content scripts

Content scripts run in the context of web pages in an isolated world. This allows multiple content scripts from various extensions to coexist without conflicting with each other's execution and to stay isolated from the page's JavaScript.

A script that ends with `.ts` will not have front-end runtime (e.g. react) bundled with it and won't be treated as a ui script, while a script that ends in `.tsx` will be.

There are many use cases for content scripts:

* Injecting a custom stylesheet into the page
* Scraping data from the current web page
* Selecting, finding, and styling elements from the current web page
* Injecting UI elements into current web page

Code for the content scripts is located in `src/app/content` directory - you need to define `.ts` or `.tsx` file inside and use `defineContentScript` to allow WXT to include your script in the build.

```ts title="src/app/content/index.ts"
export default defineContentScript({
  matches: ["<all_urls>"],
  async main(ctx) {
    console.log(
      "Content script is running! Edit `app/content` and save to reload.",
    );
  },
});
```

Reload your extension, open a web page, then open its inspector:

![Content Script](/images/docs/extension/structure/content-script.png)
To learn more about content scripts, e.g. how to configure only specific pages to load content scripts, how to inject them into `window` object or how to fetch data inside, please check [the official documentation](https://wxt.dev/guide/essentials/content-scripts.html).

## UI scripts

WXT has first-class support for mounting React components into the current webpage. This feature is called content scripts UI (CSUI).

![CSUI](/images/docs/extension/structure/csui.png)

An extension can have as many CSUI as needed, with each CSUI targeting a group of webpages or a specific webpage.

To get started with CSUI, create a `.tsx` file in `src/app/content` directory and use `defineContentScript` allow WXT to include your script in the build and mount your component into the current webpage:

```tsx title="src/app/content/index.tsx"
const ContentScriptUI = () => {
  return (
    <Button onClick={() => alert("This is injected UI!")}>
      Content script UI
    </Button>
  );
};

export default defineContentScript({
  matches: ["<all_urls>"],
  cssInjectionMode: "ui",
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: "turbostarter-extension",
      position: "overlay",
      anchor: "body",
      onMount: (container) => {
        const app = document.createElement("div");
        container.append(app);

        const root = ReactDOM.createRoot(app);
        root.render(<ContentScriptUI />);
        return root;
      },
      onRemove: (root) => {
        root?.unmount();
      },
    });

    ui.mount();
  },
});
export default ContentScriptUI;
```

<Callout title="File extensions matters!" type="warn">
  The `.tsx` extension is essential to differentiate between Content Scripts UI and regular Content Scripts. Make sure to check if you're using appropriate type of content script for your use case.
</Callout>

To learn more about content scripts UI, e.g. how to inject custom styles, fonts or the whole lifecycle of a component, please check [the official documentation](https://wxt.dev/guide/essentials/content-scripts.html#ui).

<Callout title="How does it work?">
  Under the hood, the component is wrapped inside the component that implements the Shadow DOM technique, together with many helpful features. This isolation technique prevents the web page's style from affecting your component's styling and vice-versa.

  [Read more about the lifecycle of CSUI](https://docs.plasmo.com/framework/content-scripts-ui/life-cycle)
</Callout>
