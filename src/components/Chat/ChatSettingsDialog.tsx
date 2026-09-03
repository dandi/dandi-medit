import { FunctionComponent, useState, useMemo } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Box,
  Alert,
  IconButton,
  InputAdornment,
  Autocomplete,
} from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { AVAILABLE_MODELS, CHEAP_MODELS } from "../../chat/availableModels";
import {
  getStoredOpenRouterApiKey,
  setStoredOpenRouterApiKey,
  clearStoredOpenRouterApiKey,
  maskApiKey,
} from "../../chat/apiKeyStorage";

interface ChatSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  currentModel: string;
  onModelChange: (model: string) => void;
}

interface ModelAutocompleteProps {
  currentModel: string;
  onModelChange: (model: string) => void;
}

// Rendered inside the dialog content, so it is remounted every time the dialog
// is opened and the displayed value starts from the active model again.
const ModelAutocomplete: FunctionComponent<ModelAutocompleteProps> = ({
  currentModel,
  onModelChange,
}) => {
  const [inputValue, setInputValue] = useState<string>(currentModel);

  const commitInputValue = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setInputValue(currentModel);
      return;
    }
    setInputValue(trimmed);
    if (trimmed !== currentModel) onModelChange(trimmed);
  };

  return (
    <Autocomplete
      freeSolo
      options={AVAILABLE_MODELS.map((m) => m.model)}
      value={currentModel}
      inputValue={inputValue}
      onChange={(_e, newValue) => {
        if (newValue !== null) commitInputValue(newValue);
      }}
      onInputChange={(_e, newValue) => {
        setInputValue(newValue);
      }}
      renderOption={(props, option) => {
        const model = AVAILABLE_MODELS.find((m) => m.model === option);
        const isCheap = CHEAP_MODELS.includes(option);
        return (
          <li {...props} key={option}>
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                width: "100%",
                alignItems: "center",
              }}
            >
              <span>{model?.label ?? option}</span>
              <Typography
                variant="caption"
                sx={{
                  ml: 2,
                  color: isCheap ? "success.main" : "warning.main",
                }}
              >
                {isCheap
                  ? "Free"
                  : model
                    ? `$${model.cost.prompt}/$${model.cost.completion} per 1M tokens`
                    : "Custom"}
              </Typography>
            </Box>
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label="AI Model"
          placeholder="Select or type an OpenRouter model ID"
          onBlur={() => commitInputValue(inputValue)}
        />
      )}
    />
  );
};

const ChatSettingsDialog: FunctionComponent<ChatSettingsDialogProps> = ({
  open,
  onClose,
  currentModel,
  onModelChange,
}) => {
  const [apiKey, setApiKey] = useState<string>("");
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [refreshKey, setRefreshKey] = useState<number>(0);
  
  // Check for stored key on each render when open (derived state)
  const hasStoredKey = useMemo(() => {
    if (!open) return false;
    // refreshKey forces re-check after save/clear
    void refreshKey;
    return !!getStoredOpenRouterApiKey();
  }, [open, refreshKey]);

  const handleSaveApiKey = () => {
    if (apiKey.trim()) {
      setStoredOpenRouterApiKey(apiKey.trim());
      setApiKey("");
      setRefreshKey((k) => k + 1);
    }
  };

  const handleClearApiKey = () => {
    clearStoredOpenRouterApiKey();
    setApiKey("");
    setRefreshKey((k) => k + 1);
  };

  const requiresApiKey = !CHEAP_MODELS.includes(currentModel);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Chat Settings</DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3, pt: 1 }}>
          {/* Model Selection */}
          <ModelAutocomplete
            currentModel={currentModel}
            onModelChange={onModelChange}
          />

          {/* Model Info */}
          <Alert severity={requiresApiKey ? "warning" : "info"}>
            {requiresApiKey ? (
              <>
                <strong>{currentModel.split("/").pop()}</strong> requires an
                OpenRouter API key. Get one at{" "}
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  openrouter.ai/keys
                </a>
              </>
            ) : (
              <>
                <strong>{currentModel.split("/").pop()}</strong> is a free model
                and doesn't require your own API key.
              </>
            )}
          </Alert>

          {/* API Key Section */}
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              OpenRouter API Key (Optional)
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Required only for premium models. Your key is stored locally in
              your browser.
            </Typography>

            {hasStoredKey ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                <TextField
                  fullWidth
                  value={maskApiKey(getStoredOpenRouterApiKey() || "")}
                  disabled
                  size="small"
                  label="Stored API Key"
                />
                <Button
                  variant="outlined"
                  color="error"
                  onClick={handleClearApiKey}
                  size="small"
                >
                  Remove
                </Button>
              </Box>
            ) : (
              <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                <TextField
                  fullWidth
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-or-..."
                  size="small"
                  label="Enter API Key"
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={() => setShowApiKey(!showApiKey)}
                          edge="end"
                          size="small"
                        >
                          {showApiKey ? (
                            <VisibilityOffIcon />
                          ) : (
                            <VisibilityIcon />
                          )}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
                <Button
                  variant="contained"
                  onClick={handleSaveApiKey}
                  disabled={!apiKey.trim()}
                  size="small"
                >
                  Save
                </Button>
              </Box>
            )}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default ChatSettingsDialog;
