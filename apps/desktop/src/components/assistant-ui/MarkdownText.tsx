import { memo, useState, type ComponentPropsWithoutRef } from "react";
import { Check, Copy } from "lucide-react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import type { CodeHeaderProps } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import "@assistant-ui/react-markdown/styles/dot.css";

function CodeHeader({ language, code }: CodeHeaderProps) {
  const [copied, setCopied] = useState(false);
  return <div className="code-header">
    <span>{language || "Code"}</span>
    <button type="button" aria-label="Copy code" title="Copy code" onClick={() => void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    })}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>
  </div>;
}

function MarkdownLink({ href, ...props }: ComponentPropsWithoutRef<"a">) {
  return <a href={href} target="_blank" rel="noreferrer" {...props} />;
}

function MarkdownTable(props: ComponentPropsWithoutRef<"table">) {
  return <div className="markdown-table"><table {...props} /></div>;
}

const markdownComponents = {
  a: MarkdownLink,
  table: MarkdownTable,
  blockquote: (props: ComponentPropsWithoutRef<"blockquote">) => <blockquote className="markdown-quote" {...props} />,
  CodeHeader,
};

export const MarkdownText = memo(function MarkdownText() {
  return <MarkdownTextPrimitive className="markdown" components={markdownComponents} remarkPlugins={[remarkGfm]} />;
});
