// PDF Module
// Exports for external use

// Context & Hooks
export {
  PdfViewerProvider,
  usePdfViewer,
  useCanGoBack,
  useCanGoForward,
} from "./context";
export { usePdfNavigation } from "./hooks";

// Layout Components
export { PdfLayout } from "./layout/layout";
export { PdfPreview } from "./layout/preview";

// Thread Components
export { Chat as PdfChat } from "./thread";
export { ChatComposer as PdfComposer } from "./composer";
export { CitationMarkdown } from "./thread/citation-markdown";

// Navigation & Citations
export {
  NavigationControls,
  Citation,
  CitationPreview,
  type CitationProps,
  type CitationPreviewProps,
} from "./components";
