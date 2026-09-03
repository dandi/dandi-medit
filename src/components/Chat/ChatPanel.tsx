import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  Box,
  CircularProgress,
  Typography,
  IconButton,
  Paper,
  Alert,
  Chip,
  Tooltip,
  Button,
  TextField,
  Fab,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import SettingsIcon from "@mui/icons-material/Settings";
import RefreshIcon from "@mui/icons-material/Refresh";
import StopIcon from "@mui/icons-material/Stop";
import DownloadIcon from "@mui/icons-material/Download";
import CompressIcon from "@mui/icons-material/Compress";
import CloseIcon from "@mui/icons-material/Close";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { useMetadataContext } from "../../context/useMetadataContext";
import useChat from "../../chat/useChat";
import { CHEAP_MODELS } from "../../chat/availableModels";
import { getStoredOpenRouterApiKey } from "../../chat/apiKeyStorage";
import ChatInput from "./ChatInput";
import MessageItem from "./MessageItem";
import ChatSettingsDialog from "./ChatSettingsDialog";
import SuggestedPrompts from "./SuggestedPrompts";
import { CompressConfirmDialog } from "./CompressConfirmDialog";

// How close to the bottom (in pixels) the conversation must be for new
// messages to keep scrolling it down automatically.
const NEAR_BOTTOM_THRESHOLD_PX = 80;

export function ChatPanel() {
  const {
    versionInfo,
    originalMetadata,
    modifiedMetadata,
    hasChanges,
    dandisetId,
    version,
    modifyMetadata,
    isLoading,
  } = useMetadataContext();

  const {
    chat,
    submitUserMessage,
    responding,
    compressing,
    partialResponse,
    setChatModel,
    error,
    clearChat,
    abortResponse,
    revertToMessage,
    compressConversation,
    currentSuggestions,
    loadingInitialSuggestions,
    messageQueue,
    removeQueuedMessage,
    updateQueuedMessage,
  } = useChat({
    originalMetadata,
    modifiedMetadata,
    modifyMetadata,
    dandisetId,
    version,
    versionInfo,
  });

  const [newPrompt, setNewPrompt] = useState<string>("");
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [compressDialogOpen, setCompressDialogOpen] = useState<boolean>(false);
  const [errorExpanded, setErrorExpanded] = useState<boolean>(false);
  const [editingQueueIndex, setEditingQueueIndex] = useState<number | null>(null);
  const [editingQueueText, setEditingQueueText] = useState<string>("");
  const conversationRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef<boolean>(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState<boolean>(false);

  // Get compression threshold from URL query parameter (for testing)
  const compressionThreshold = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const testThreshold = params.get('compressThreshold');
    return testThreshold ? parseInt(testThreshold, 10) : 35;
  }, []);

  // Check if API key is required but not present
  const requiresApiKey = !CHEAP_MODELS.includes(chat.model);
  const hasApiKey = !!getStoredOpenRouterApiKey();
  const needsApiKey = requiresApiKey && !hasApiKey;

  // All messages including partial response
  const allMessages = useMemo(() => {
    const messages = chat.messages.map((m) => ({ message: m, inProgress: false }));
    if (responding && partialResponse) {
      return [
        ...messages,
        ...partialResponse.map((m) => ({ message: m, inProgress: true })),
      ];
    }
    return messages;
  }, [chat.messages, responding, partialResponse]);

  // Track whether the conversation is scrolled near the bottom, so that
  // streamed updates do not yank the view away from what the user is reading.
  const handleConversationScroll = useCallback(() => {
    const el = conversationRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX;
    isNearBottomRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = conversationRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    isNearBottomRef.current = true;
    setShowJumpToLatest(false);
  }, []);

  // Auto-scroll to bottom when new messages arrive, but only if the user was
  // already at the bottom. Otherwise leave the scroll position alone; the
  // jump to latest button gives them a way back down.
  useEffect(() => {
    const el = conversationRef.current;
    if (el && isNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [allMessages]);

  // A message the user just sent should always bring the view back down.
  const stickToBottom = useCallback(() => {
    isNearBottomRef.current = true;
    setShowJumpToLatest(false);
  }, []);

  const handleSubmit = useCallback(() => {
    if (newPrompt.trim() === "" || compressing || needsApiKey) return;
    stickToBottom();
    submitUserMessage(newPrompt.trim());
    setNewPrompt("");
  }, [newPrompt, submitUserMessage, compressing, needsApiKey, stickToBottom]);

  const handleNewChat = useCallback(() => {
    clearChat();
    setNewPrompt("");
  }, [clearChat]);

  const handleCompressClick = useCallback(() => {
    setCompressDialogOpen(true);
  }, []);

  const handleCompressConfirm = useCallback(async () => {
    setCompressDialogOpen(false);
    await compressConversation();
  }, [compressConversation]);

  const handleCompressCancel = useCallback(() => {
    setCompressDialogOpen(false);
  }, []);

  const handleDownloadChat = useCallback(() => {
    const lines: string[] = [];
    lines.push(`Dandiset Metadata Assistant - Chat Export`);
    lines.push(`Dandiset: ${dandisetId} (${version})`);
    lines.push(`Model: ${chat.model}`);
    lines.push(`Date: ${new Date().toISOString()}`);
    lines.push(`${"=".repeat(50)}\n`);

    for (const msg of chat.messages) {
      if (msg.role === "user") {
        lines.push(`USER:`);
        lines.push(typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content));
        lines.push("");
      } else if (msg.role === "assistant") {
        lines.push(`ASSISTANT:`);
        if (msg.content) {
          lines.push(typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content));
        }
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            lines.push(`[Tool Call: ${tc.function.name}]`);
            lines.push(tc.function.arguments);
          }
        }
        lines.push("");
      } else if (msg.role === "tool") {
        lines.push(`TOOL RESULT (${msg.name || msg.tool_call_id}):`);
        lines.push(msg.content);
        lines.push("");
      }
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dandiset-${dandisetId}-chat-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [chat.messages, chat.model, dandisetId, version]);

  const hasMetadata = !!versionInfo?.metadata;

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "background.default",
      }}
    >
      {/* Header */}
      <Box
        sx={{
          p: 1.5,
          borderBottom: 1,
          borderColor: "divider",
          backgroundColor: "background.paper",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Typography
          variant="h6"
          sx={{ display: "flex", alignItems: "center", gap: 1, userSelect: "none" }}
        >
          <SmartToyIcon color="primary" />
          Assistant
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          {responding && (
            <Button
              size="small"
              variant="outlined"
              color="error"
              startIcon={<StopIcon />}
              onClick={abortResponse}
              sx={{ mr: 1 }}
            >
              Stop
            </Button>
          )}
          <Chip
            label={chat.model.split("/")[1]}
            size="small"
            variant="outlined"
            onClick={() => setSettingsOpen(true)}
            sx={{ fontSize: "0.7rem", cursor: "pointer" }}
          />
          <Tooltip title="Compress Conversation">
            <span>
              <IconButton
                size="small"
                onClick={handleCompressClick}
                disabled={chat.messages.length < 3 || compressing}
              >
                <CompressIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Download Chat">
            <span>
              <IconButton
                size="small"
                onClick={handleDownloadChat}
                disabled={chat.messages.length === 0}
              >
                <DownloadIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="New Chat">
            <span>
              <IconButton
                size="small"
                onClick={handleNewChat}
                disabled={chat.messages.length === 0}
              >
                <RefreshIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Settings">
            <IconButton size="small" onClick={() => setSettingsOpen(true)}>
              <SettingsIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Chat Messages Area */}
      <Box
        ref={conversationRef}
        onScroll={handleConversationScroll}
        sx={{
          flex: 1,
          overflow: "auto",
          p: 2,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {!hasMetadata ? (
          isLoading ? (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                m: "auto",
                gap: 2,
              }}
            >
              <CircularProgress />
              <Typography variant="body2" color="text.secondary">
                Loading dandiset...
              </Typography>
            </Box>
          ) : (
            <Paper
              elevation={0}
              sx={{
                p: 4,
                textAlign: "center",
                backgroundColor: "grey.50",
                borderRadius: 2,
                m: "auto",
                maxWidth: 400,
              }}
            >
              <SmartToyIcon sx={{ fontSize: 48, color: "grey.400", mb: 2 }} />
              <Typography variant="h6" color="text.secondary" gutterBottom>
                Load a Dandiset First
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Load a dandiset using the welcome page to start chatting with the
                AI assistant about metadata.
              </Typography>
            </Paper>
          )
        ) : allMessages.length === 0 ? (
          <Paper
            elevation={0}
            sx={{
              p: 4,
              textAlign: "center",
              backgroundColor: "grey.50",
              borderRadius: 2,
              m: "auto",
              maxWidth: 400,
            }}
          >
            <SmartToyIcon sx={{ fontSize: 48, color: "primary.main", mb: 2 }} />
            <Typography variant="h6" color="text.secondary" gutterBottom>
              Ready to Help!
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              Ask me questions about your dandiset metadata or request changes.
              I can help you:
            </Typography>
            <Box
              component="ul"
              sx={{
                textAlign: "left",
                pl: 2,
                color: "text.secondary",
                fontSize: "0.875rem",
              }}
            >
              <li>Review and improve metadata fields</li>
              <li>Add missing information</li>
              <li>Fix formatting or compliance issues</li>
              <li>Suggest better descriptions</li>
            </Box>
            {hasChanges && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 2, fontStyle: "italic" }}
              >
                You have pending metadata changes that have not been committed yet.
              </Typography>
            )}
          </Paper>
        ) : (
          <>
            {allMessages.map(({ message, inProgress }, index) => {
              // Find the actual index in chat.messages (excluding partial responses)
              const isFromChat = index < chat.messages.length;
              const chatIndex = isFromChat ? index : -1;
              // Can revert if it's not the last message and not in progress
              const canRevert = isFromChat && index < chat.messages.length - 1 && !responding;

              return (
                <MessageItem
                  key={index}
                  message={message}
                  inProgress={inProgress}
                  messageIndex={chatIndex}
                  onRevert={revertToMessage}
                  canRevert={canRevert}
                />
              );
            })}
            {responding && !partialResponse && (
              <Box sx={{ display: "flex", justifyContent: "flex-start", mb: 2 }}>
                <Paper
                  elevation={1}
                  sx={{
                    p: 2,
                    backgroundColor: "grey.100",
                    borderRadius: 2,
                    borderTopLeftRadius: 0,
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <CircularProgress size={16} />
                    <Typography
                      variant="body2"
                      sx={{ fontStyle: "italic", color: "text.secondary" }}
                    >
                      Thinking...
                    </Typography>
                  </Box>
                </Paper>
              </Box>
            )}
            {compressing && (
              <Box sx={{ display: "flex", justifyContent: "flex-start", mb: 2 }}>
                <Paper
                  elevation={1}
                  sx={{
                    p: 2,
                    backgroundColor: "grey.100",
                    borderRadius: 2,
                    borderTopLeftRadius: 0,
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <CircularProgress size={16} />
                    <Typography
                      variant="body2"
                      sx={{ fontStyle: "italic", color: "text.secondary" }}
                    >
                      Compressing conversation...
                    </Typography>
                  </Box>
                </Paper>
              </Box>
            )}
          </>
        )}

        {/* Jump to latest: shown while the conversation is scrolled up */}
        {showJumpToLatest && allMessages.length > 0 && (
          <Fab
            size="small"
            color="primary"
            aria-label="Jump to latest message"
            onClick={scrollToBottom}
            sx={{
              position: "sticky",
              bottom: 8,
              alignSelf: "flex-end",
              flexShrink: 0,
              mt: 1,
              zIndex: 1,
            }}
          >
            <KeyboardArrowDownIcon />
          </Fab>
        )}
      </Box>

      {/* Error Display */}
      {error && (
        <Alert
          severity="error"
          sx={{ mx: 2, mb: 1 }}
          action={
            error.length > 100 ? (
              <IconButton
                size="small"
                onClick={() => setErrorExpanded(!errorExpanded)}
                sx={{ color: "inherit" }}
              >
                {errorExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
            ) : null
          }
        >
          {error.length > 100 && !errorExpanded ? (
            <Box>
              <Typography variant="body2" component="span">
                {error.substring(0, 100)}...
              </Typography>
            </Box>
          ) : (
            <Box sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {error}
            </Box>
          )}
        </Alert>
      )}

      {/* API Key Warning */}
      {needsApiKey && hasMetadata && (
        <Alert
          severity="warning"
          sx={{ mx: 2, mb: 1 }}
          action={
            <IconButton
              size="small"
              color="inherit"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon fontSize="small" />
            </IconButton>
          }
        >
          This model requires an OpenRouter API key. Click settings to add one
          or switch to a free model.
        </Alert>
      )}

      {/* Compression Suggestion Warning */}
      {chat.messages.length > compressionThreshold && !compressing && (
        <Alert
          severity="info"
          sx={{ mx: 2, mb: 1 }}
          action={
            <Button
              size="small"
              color="inherit"
              onClick={handleCompressClick}
              startIcon={<CompressIcon />}
            >
              Compress
            </Button>
          }
        >
          The conversation is getting long ({chat.messages.length} messages). Consider compressing it to maintain context while reducing token usage.
        </Alert>
      )}

      {/* Suggested Prompts */}
      {hasMetadata && !responding && !compressing && !needsApiKey && (
        <SuggestedPrompts
          suggestions={currentSuggestions}
          onSuggestionClick={(suggestion) => {
            stickToBottom();
            submitUserMessage(suggestion);
          }}
          disabled={responding || compressing || loadingInitialSuggestions}
        />
      )}

      {/* Loading Initial Suggestions Indicator */}
      {hasMetadata && loadingInitialSuggestions && allMessages.length === 0 && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 2,
            py: 1,
            borderTop: 1,
            borderColor: "divider",
            backgroundColor: "grey.50",
          }}
        >
          <CircularProgress size={14} />
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.75rem" }}>
            Loading suggestions...
          </Typography>
        </Box>
      )}

      {/* Queued Messages */}
      {messageQueue.length > 0 && (
        <Box
          sx={{
            px: 2,
            py: 1,
            borderTop: 1,
            borderColor: "divider",
            backgroundColor: "grey.50",
            display: "flex",
            flexDirection: "column",
            gap: 0.5,
          }}
        >
          <Typography variant="caption" color="text.secondary">
            Queued messages ({messageQueue.length}):
          </Typography>
          {messageQueue.map((msg, index) => (
            <Box
              key={index}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
              }}
            >
              <Chip
                label={`${index + 1}`}
                size="small"
                color="primary"
                variant="outlined"
                sx={{ minWidth: 28, height: 22, fontSize: "0.7rem" }}
              />
              {editingQueueIndex === index ? (
                <TextField
                  value={editingQueueText}
                  onChange={(e) => setEditingQueueText(e.target.value)}
                  onBlur={() => {
                    if (editingQueueText.trim()) {
                      updateQueuedMessage(index, editingQueueText.trim());
                    }
                    setEditingQueueIndex(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (editingQueueText.trim()) {
                        updateQueuedMessage(index, editingQueueText.trim());
                      }
                      setEditingQueueIndex(null);
                    } else if (e.key === "Escape") {
                      setEditingQueueIndex(null);
                    }
                  }}
                  size="small"
                  autoFocus
                  fullWidth
                  sx={{ "& .MuiInputBase-input": { fontSize: "0.8rem", py: 0.5 } }}
                />
              ) : (
                <Typography
                  variant="body2"
                  sx={{
                    flex: 1,
                    fontSize: "0.8rem",
                    cursor: "pointer",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    "&:hover": { textDecoration: "underline" },
                  }}
                  onClick={() => {
                    setEditingQueueIndex(index);
                    setEditingQueueText(msg);
                  }}
                >
                  {msg}
                </Typography>
              )}
              <IconButton
                size="small"
                onClick={() => removeQueuedMessage(index)}
                sx={{ p: 0.25 }}
              >
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}

      {/* Input Area */}
      <ChatInput
        value={newPrompt}
        onChange={setNewPrompt}
        onSubmit={handleSubmit}
        disabled={compressing || !hasMetadata || needsApiKey}
        placeholder={
          !hasMetadata
            ? "Load a dandiset first..."
            : needsApiKey
              ? "API key required..."
              : compressing
                ? "Compressing conversation..."
                : responding
                  ? "Type a message to queue it..."
                  : "Ask about metadata or request changes..."
        }
      />

      {/* Usage Display */}
      {chat.totalUsage.estimatedCost > 0 && (
        <Box
          sx={{
            px: 2,
            py: 0.5,
            borderTop: 1,
            borderColor: "divider",
            backgroundColor: "grey.50",
            fontSize: "0.75rem",
            color: "text.secondary",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>
            Tokens: {chat.totalUsage.promptTokens.toLocaleString()} prompt /{" "}
            {chat.totalUsage.completionTokens.toLocaleString()} completion
          </span>
          <span>Est. cost: ${chat.totalUsage.estimatedCost.toFixed(4)}</span>
        </Box>
      )}

      {/* Settings Dialog */}
      <ChatSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        currentModel={chat.model}
        onModelChange={setChatModel}
      />

      {/* Compress Confirmation Dialog */}
      <CompressConfirmDialog
        open={compressDialogOpen}
        onClose={handleCompressCancel}
        onConfirm={handleCompressConfirm}
        messageCount={chat.messages.length}
      />
    </Box>
  );
}
