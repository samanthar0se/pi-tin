import { memo } from "react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import "@assistant-ui/react-markdown/styles/dot.css";

export const MarkdownText = memo(function MarkdownText() {
  return <MarkdownTextPrimitive className="markdown" />;
});
