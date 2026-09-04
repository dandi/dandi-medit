import { FunctionComponent, useState } from "react";
import { Box, Chip, CircularProgress, Collapse, IconButton, Paper, Tooltip, Typography } from "@mui/material";
import PersonIcon from "@mui/icons-material/Person";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import BuildIcon from "@mui/icons-material/Build";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import HistoryIcon from "@mui/icons-material/History";
import MarkdownContent from "./MarkdownContent";
import { ChatMessage, ORContentPart } from "../../chat/types";
import { parseSuggestions } from "../../chat/parseSuggestions";
import { parseRefusalTags, refusalTagLabels } from "../../chat/parseRefusalTags";

interface MessageItemProps {
  message: ChatMessage;
  inProgress?: boolean;
  messageIndex?: number;
  onRevert?: (index: number) => void;
  canRevert?: boolean;
}

const messageContentToString = (
  content: string | ORContentPart[] | null
): string => {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .map((part) => {
      if (part.type === "text") return part.text;
      else if (part.type === "image_url")
        return `![Image](${part.image_url.url})`;
      else return "";
    })
    .join("\n");
};

/**
 * Strip suggestions block from content for display
 */
const stripSuggestionsFromContent = (content: string): string => {
  const { cleanedContent } = parseSuggestions(content);
  return cleanedContent;
};

/**
 * Describe a single entry of a propose_metadata_change `changes` array,
 * e.g. "set name" or "append keywords".
 */
const describeMetadataChange = (change: unknown): string => {
  if (!change || typeof change !== "object") return "change";
  const { operation, path } = change as {
    operation?: unknown;
    path?: unknown;
  };
  const op = typeof operation === "string" ? operation : "set";
  return typeof path === "string" && path ? `${op} ${path}` : op;
};

/**
 * Summarize a propose_metadata_change call, listing at most the first three
 * operation/path pairs of a batch.
 */
const MAX_SUMMARIZED_CHANGES = 3;

const getMetadataChangeSummary = (args: {
  changes?: unknown;
  path?: unknown;
}): string => {
  const changes = Array.isArray(args.changes) ? args.changes : [];
  if (changes.length === 1) {
    return `propose_metadata_change: ${describeMetadataChange(changes[0])}`;
  }
  if (changes.length > 1) {
    const shown = changes
      .slice(0, MAX_SUMMARIZED_CHANGES)
      .map(describeMetadataChange);
    const remaining = changes.length - shown.length;
    const detail =
      remaining > 0
        ? `${shown.join(", ")}, and ${remaining} more`
        : shown.join(", ");
    return `propose_metadata_change: ${changes.length} changes (${detail})`;
  }
  return typeof args.path === "string" && args.path
    ? `propose_metadata_change: ${args.path}`
    : "propose_metadata_change";
};

/**
 * Get a short summary for a tool call based on its name and arguments
 */
const getToolCallSummary = (
  name: string,
  argsString: string
): string => {
  try {
    const args = JSON.parse(argsString);
    switch (name) {
      case "fetch_url":
        return args.url ? `fetch_url: ${args.url}` : "fetch_url";
      case "import_contributors_from_publication":
        return args.doi ? `import_contributors_from_publication: ${args.doi}${args.dryRun ? " (dry run)" : ""}` : name;
      case "lookup_ontology_term":
        return args.term
          ? `lookup_ontology_term: ${args.term}`
          : "lookup_ontology_term";
      case "propose_metadata_change":
        return getMetadataChangeSummary(args);
      default:
        return name;
    }
  } catch {
    return name;
  }
};

/**
 * Expandable tool call component
 */
interface ToolCallItemProps {
  name: string;
  argsString: string;
  inProgress: boolean;
}

const ToolCallItem: FunctionComponent<ToolCallItemProps> = ({
  name,
  argsString,
  inProgress,
}) => {
  const [expanded, setExpanded] = useState(false);
  const summary = getToolCallSummary(name, argsString);

  let formattedArgs = argsString;
  try {
    formattedArgs = JSON.stringify(JSON.parse(argsString), null, 2);
  } catch {
    // Keep original if not valid JSON
  }

  return (
    <Box sx={{ mb: 0.5 }}>
      <Box
        onClick={() => setExpanded(!expanded)}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
          px: 1,
          py: 0.5,
          borderRadius: 1,
          border: 1,
          borderColor: inProgress ? "warning.main" : "success.main",
          backgroundColor: inProgress ? "warning.lighter" : "success.lighter",
          cursor: "pointer",
          "&:hover": {
            backgroundColor: inProgress ? "warning.light" : "success.light",
          },
          transition: "background-color 0.2s",
        }}
      >
        <BuildIcon
          sx={{
            fontSize: 16,
            color: inProgress ? "warning.dark" : "success.dark",
          }}
        />
        <Typography
          variant="body2"
          sx={{
            color: inProgress ? "warning.dark" : "success.dark",
            fontFamily: "monospace",
            fontSize: "0.8rem",
          }}
        >
          {inProgress ? "Calling" : "Called"}: {summary}
        </Typography>
        <IconButton
          size="small"
          sx={{
            p: 0,
            ml: 0.5,
            color: inProgress ? "warning.dark" : "success.dark",
          }}
        >
          {expanded ? (
            <ExpandLessIcon sx={{ fontSize: 16 }} />
          ) : (
            <ExpandMoreIcon sx={{ fontSize: 16 }} />
          )}
        </IconButton>
      </Box>
      <Collapse in={expanded}>
        <Box
          sx={{
            mt: 0.5,
            ml: 2,
            p: 1,
            backgroundColor: "grey.50",
            borderRadius: 1,
            border: 1,
            borderColor: "grey.300",
            maxHeight: 200,
            overflow: "auto",
          }}
        >
          <Typography
            component="pre"
            variant="body2"
            sx={{
              fontFamily: "monospace",
              fontSize: "0.75rem",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              m: 0,
            }}
          >
            {formattedArgs}
          </Typography>
        </Box>
      </Collapse>
    </Box>
  );
};

/**
 * Truncate content for preview, showing first N characters
 */
const truncateContent = (content: string, maxLength: number = 150): string => {
  if (content.length <= maxLength) return content;
  return content.substring(0, maxLength).trim() + "...";
};

/**
 * Tool result component with expandable content
 */
interface ToolResultItemProps {
  message: ChatMessage & { role: "tool" };
}

const ToolResultItem: FunctionComponent<ToolResultItemProps> = ({ message }) => {
  const [expanded, setExpanded] = useState(false);

  // Parse tool result for display
  let resultContent = message.content;
  let isSuccess = true;
  let fullContent = message.content;

  try {
    const parsed = JSON.parse(message.content);
    if (parsed.success !== undefined) {
      isSuccess = parsed.success;
      resultContent = parsed.message || parsed.error || message.content;
      // For full content, show the entire parsed result nicely formatted
      fullContent = JSON.stringify(parsed, null, 2);
    }
  } catch {
    // Keep original content if not JSON
  }

  const isLongContent = resultContent.length > 150;
  const previewContent = isLongContent ? truncateContent(resultContent) : resultContent;

  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "flex-start",
        mb: 2,
        pl: 4,
      }}
    >
      <Paper
        elevation={0}
        sx={{
          p: 1.5,
          maxWidth: "75%",
          backgroundColor: isSuccess ? "success.lighter" : "error.lighter",
          border: 1,
          borderColor: isSuccess ? "success.light" : "error.light",
          borderRadius: 1,
        }}
      >
        <Box
          onClick={() => setExpanded(!expanded)}
          sx={{
            display: "flex",
            alignItems: "flex-start",
            gap: 1,
            cursor: "pointer",
          }}
        >
          <BuildIcon
            sx={{
              fontSize: 16,
              mt: 0.3,
              color: isSuccess ? "success.main" : "error.main",
            }}
          />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              variant="body2"
              sx={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                color: isSuccess ? "success.dark" : "error.dark",
              }}
            >
              {expanded ? resultContent : previewContent}
            </Typography>
          </Box>
          {isLongContent && (
            <IconButton
              size="small"
              sx={{
                p: 0,
                color: isSuccess ? "success.dark" : "error.dark",
              }}
            >
              {expanded ? (
                <ExpandLessIcon sx={{ fontSize: 16 }} />
              ) : (
                <ExpandMoreIcon sx={{ fontSize: 16 }} />
              )}
            </IconButton>
          )}
        </Box>
        {expanded && fullContent !== resultContent && (
          <Collapse in={expanded}>
            <Box
              sx={{
                mt: 1,
                p: 1,
                backgroundColor: "grey.50",
                borderRadius: 1,
                border: 1,
                borderColor: "grey.300",
                maxHeight: 300,
                overflow: "auto",
              }}
            >
              <Typography
                component="pre"
                variant="body2"
                sx={{
                  fontFamily: "monospace",
                  fontSize: "0.75rem",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  m: 0,
                }}
              >
                {fullContent}
              </Typography>
            </Box>
          </Collapse>
        )}
      </Paper>
    </Box>
  );
};

const MessageItem: FunctionComponent<MessageItemProps> = ({
  message,
  inProgress = false,
  messageIndex,
  onRevert,
  canRevert = false,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  // Render revert button conditionally
  const showRevertButton = canRevert && messageIndex !== undefined && onRevert;

  if (message.role === "user") {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 1,
          mb: 2,
        }}
      >
        <Paper
          elevation={1}
          sx={{
            p: 2,
            maxWidth: "80%",
            backgroundColor: "primary.main",
            color: "white",
            borderRadius: 2,
            borderTopRightRadius: 0,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
            <PersonIcon sx={{ fontSize: 20, mt: 0.5 }} />
            <Typography
              variant="body1"
              sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
            >
              {typeof message.content === "string"
                ? message.content
                : messageContentToString(message.content)}
            </Typography>
          </Box>
        </Paper>
      </Box>
    );
  }

  if (message.role === "assistant") {
    const rawContent = messageContentToString(message.content);
    // Strip suggestions block from displayed content
    const contentWithoutSuggestions = stripSuggestionsFromContent(rawContent);
    // Strip refusal tags and surface them as labels instead
    const { cleanedContent: content, tags: refusalTags } = parseRefusalTags(
      contentWithoutSuggestions
    );
    const hasToolCalls = message.tool_calls && message.tool_calls.length > 0;

    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "flex-start",
          alignItems: "center",
          gap: 1,
          mb: 2,
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <Paper
          elevation={1}
          sx={{
            p: 2,
            maxWidth: "85%",
            backgroundColor: "grey.100",
            borderRadius: 2,
            borderTopLeftRadius: 0,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
            <SmartToyIcon sx={{ fontSize: 20, mt: 0.5, color: "primary.main" }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {refusalTags.length > 0 && (
                <Box
                  sx={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 0.5,
                    mb: content ? 1 : 0,
                  }}
                >
                  {refusalTags.map((tag) => (
                    <Chip
                      key={tag}
                      label={refusalTagLabels[tag]}
                      size="small"
                      variant="outlined"
                      color="warning"
                      sx={{ fontSize: "0.7rem", height: 22 }}
                    />
                  ))}
                </Box>
              )}
              {content && (
                <Box
                  sx={{
                    "& p": { mt: 0, mb: 1 },
                    "& p:last-child": { mb: 0 },
                    "& pre": {
                      backgroundColor: "white",
                      p: 1,
                      borderRadius: 1,
                      overflow: "auto",
                    },
                    "& code": {
                      fontSize: "0.875rem",
                    },
                    "& ul, & ol": { mt: 0, mb: 1, pl: 2 },
                  }}
                >
                  <MarkdownContent content={content} doRehypeRaw={!inProgress} />
                </Box>
              )}
              {hasToolCalls && (
                <Box sx={{ mt: content ? 1 : 0 }}>
                  {message.tool_calls!.map((toolCall, index) => (
                    <ToolCallItem
                      key={index}
                      name={toolCall.function.name}
                      argsString={toolCall.function.arguments}
                      inProgress={inProgress}
                    />
                  ))}
                </Box>
              )}
              {inProgress && !content && !hasToolCalls && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <CircularProgress size={16} />
                  <Typography variant="body2" sx={{ fontStyle: "italic", color: "text.secondary" }}>
                    Thinking...
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>
        </Paper>
        {showRevertButton && (
          <Tooltip title="Revert to this point">
            <IconButton
              size="small"
              onClick={() => onRevert(messageIndex)}
              sx={{
                opacity: isHovered ? 1 : 0,
                transition: "opacity 0.2s",
                p: 0.5,
              }}
            >
              <HistoryIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    );
  }

  if (message.role === "tool") {
    return <ToolResultItem message={message} />;
  }

  return null;
};

export default MessageItem;
