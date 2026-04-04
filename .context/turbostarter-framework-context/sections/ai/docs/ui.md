---
title: UI
description: Learn more about UI components and design system in AI starter kit.
url: /ai/docs/ui
---

# UI

TurboStarter AI builds on the core TurboStarter UI foundation to create engaging interfaces for all AI features.

The UI architecture uses shared components and styles with platform-specific implementations:

* **`@turbostarter/ui`**: includes shared assets, themes, and fundamental styles
* **`@turbostarter/ui-web`**: contains web components built with [Tailwind CSS](https://tailwindcss.com), [Radix UI](https://www.radix-ui.com/), and [shadcn/ui](https://ui.shadcn.com)
* **`@turbostarter/ui-mobile`**: delivers mobile components using [Uniwind](https://uniwind.dev/) and [react-native-reusables](https://reactnativereusables.com/)

This approach maximizes code reuse while optimizing for each platform's unique capabilities.

## UI in AI applications

The AI starter kit leverages this foundation to create intuitive interfaces for various features and demo apps:

<Cards>
  <Card title="Chat interfaces" className="shadow-none">
    Components for displaying conversations, user input, and streaming responses
    (used in [Chatbot](/ai/docs/chat) and [Chat with PDF](/ai/docs/pdf) demos).
  </Card>

  <Card title="Image galleries" className="shadow-none">
    Displaying AI-generated images as masonry grids with options for interaction
    (used in [Image Generation](/ai/docs/image) demo).
  </Card>

  <Card title="Input forms" className="shadow-none">
    Structured forms for configuring AI tasks (e.g., selecting models, adjusting
    parameters, modifying prompts).
  </Card>

  <Card title="Animations" className="shadow-none">
    Visual feedback during AI processing, such as loading spinners or progress
    indicators (e.g. [Text to Speech](/ai/docs/tts) voice avatar animation).
  </Card>

  <Card title="Feedback mechanisms" className="shadow-none">
    UI elements for users to rate or provide feedback on AI outputs. This can
    include thumbs up/down buttons or text input fields for comments.
  </Card>

  <Card title="Error handling" className="shadow-none">
    Components for displaying error messages or alerts when AI tasks fail or
    encounter issues.
  </Card>

  <Card title="Accessibility features" className="shadow-none">
    Ensuring that all UI components are usable for individuals with
    disabilities, including keyboard navigation and screen reader support.
  </Card>

  <Card title="Visualizations" className="shadow-none">
    Components for displaying data or model outputs visually, such as charts,
    graphs, or progress bars.
  </Card>
</Cards>

## Generative UI

A standout aspect of AI applications is their ability to dynamically create or modify UI elements based on AI responses. TurboStarter AI enables this through:

* **AI SDK components**: libraries like the [AI SDK](https://sdk.vercel.ai/docs/introduction) provide specialized components and hooks (like `useActions` and `useUIState`) designed to render UI based on AI actions or structured data. This creates interactive elements—buttons, forms, or visualizations—that appear dynamically within conversations or workflows.
* **Structured output**: AI models can return data in specific formats (such as JSON) that your frontend parses to render appropriate components, display information, or trigger actions. For example, an AI might return product details that automatically render as interactive cards.
* **Conditional rendering**: the platform uses standard React patterns for showing, hiding, or transforming UI components based on AI interaction states. This creates smooth transitions between loading states, results displays, and follow-up options tailored to AI suggestions.

This approach delivers truly responsive user experiences where interfaces adapt intelligently to ongoing AI processes. The [Chat demo app](/ai/docs/chat) showcases these generative UI capabilities in action.

## Customization and further details

Customizing appearance (themes, styling) or adding new UI components follows the same process as core TurboStarter applications. For complete guides on styling, theme management, and component development, see our core documentation:

<Cards>
  <Card title="Web UI customization" description="Learn how to customize styling and components for the web application." href="/docs/web/customization/styling" />

  <Card title="Mobile UI customization" description="Learn how to customize styling and components for the mobile application." href="/docs/mobile/customization/styling" />
</Cards>

By leveraging the core UI system, TurboStarter AI ensures consistent user experiences across platforms while letting you focus on creating unique AI functionalities.
