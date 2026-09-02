/* eslint-disable @typescript-eslint/no-explicit-any */
import { FunctionComponent, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkMath from "remark-math";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vs as highlightStyle } from "react-syntax-highlighter/dist/esm/styles/prism";

// remark-math marks math with `language-math` plus `math-inline` or
// `math-display`, and rehype-katex reads those classes. The default schema
// already keeps `language-*` on `code`, so we only need to add the two
// positional classes. We sanitize before rehype-katex runs so that the schema
// does not have to allow the MathML and inline styles that KaTeX emits.
const mathClasses = ["math", "math-inline", "math-display"];

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), ["className", ...mathClasses]],
    div: [...(defaultSchema.attributes?.div || []), ["className", ...mathClasses]],
    span: [...(defaultSchema.attributes?.span || []), ["className", ...mathClasses]],
  },
};

interface MarkdownContentProps {
  content: string;
  doRehypeRaw?: boolean;
}

const MarkdownContent: FunctionComponent<MarkdownContentProps> = ({
  content,
  doRehypeRaw,
}) => {
  const rehypePlugins = useMemo(() => {
    const plugins: any[] = [];
    if (doRehypeRaw) {
      // rehype-raw turns the model's HTML into real elements, so it has to be
      // followed by rehype-sanitize before anything is rendered.
      plugins.push(rehypeRaw, [rehypeSanitize, sanitizeSchema]);
    }
    plugins.push(rehypeKatex);
    return plugins;
  }, [doRehypeRaw]);
  
  const remarkPlugins = useMemo(() => {
    const plugins: any[] = [remarkGfm, remarkMath];
    return plugins;
  }, []);

  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={{
        a({ children, ...props }) {
          return (
            <a
              href={props.href}
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            >
              {children}
            </a>
          );
        },
        code(props) {
          const { children, className, ...rest } = props;
          const match = /language-(\w+)/.exec(className || "");
          const code = String(children).replace(/\n$/, "");

          // eslint-disable-next-line react-hooks/rules-of-hooks
          const [copied, setCopied] = useState(false);

          const handleCopy = () => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          };

          return match ? (
            <div style={{ position: "relative" }}>
              <SyntaxHighlighter
                PreTag="div"
                children={code}
                language={match[1]}
                style={highlightStyle}
              />
              <button
                onClick={handleCopy}
                style={{
                  color: "black",
                  position: "absolute",
                  right: "8px",
                  bottom: "24px",
                  padding: "4px 8px",
                  fontSize: "12px",
                  background: "#f5f5f5",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          ) : (
            <code
              {...rest}
              className={className}
              style={{ background: "#eee", padding: "2px 4px", borderRadius: "3px" }}
            >
              {children}
            </code>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
};

export default MarkdownContent;
