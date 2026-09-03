import { useState } from 'react';
import {
  Box,
  TextField,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
  Chip,
  Tooltip,
  CircularProgress,
  Alert,
} from '@mui/material';
import KeyIcon from '@mui/icons-material/Key';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { useMetadataContext } from '../../context/useMetadataContext';
import { getCurrentStorageType, type StorageType } from '../../utils/dandiApiKeyStorage';
import { ApiKeyPersistCheckbox } from './ApiKeyPersistCheckbox';
import { verifyApiKey } from '../../utils/api';

export function ApiKeyManager() {
  const { apiKey, setApiKey, dandiInstance } = useMetadataContext();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [localApiKey, setLocalApiKey] = useState('');
  const [persistKey, setPersistKey] = useState(() => getCurrentStorageType(dandiInstance.apiUrl));
  const [showKey, setShowKey] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  const hasApiKey = !!apiKey;

  const handleOpen = () => {
    setLocalApiKey(apiKey || '');
    setPersistKey(getCurrentStorageType(dandiInstance.apiUrl));
    setKeyError(null);
    setIsDialogOpen(true);
  };

  const handleClose = () => {
    setIsDialogOpen(false);
    setLocalApiKey('');
    setShowKey(false);
    setKeyError(null);
  };

  const handleSave = async () => {
    const trimmed = localApiKey.trim();
    if (!trimmed) {
      setApiKey(null);
      handleClose();
      return;
    }
    setIsVerifying(true);
    setKeyError(null);
    try {
      await verifyApiKey(trimmed, dandiInstance.apiUrl);
      const storageType: StorageType = persistKey ? 'local' : 'session';
      setApiKey(trimmed, storageType);
      handleClose();
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleClear = () => {
    setApiKey(null);
    setLocalApiKey('');
  };

  return (
    <>
      <Tooltip title={hasApiKey ? 'API Key configured' : 'No API Key - Click to configure'}>
        <Chip
          icon={hasApiKey ? <CheckCircleIcon /> : <ErrorIcon />}
          label={hasApiKey ? 'API Key Set' : 'No API Key'}
          color={hasApiKey ? 'success' : 'default'}
          variant={hasApiKey ? 'filled' : 'outlined'}
          onClick={handleOpen}
          sx={{ cursor: 'pointer' }}
        />
      </Tooltip>

      <Dialog open={isDialogOpen} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <KeyIcon />
          {dandiInstance.name} API Key
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Enter your {dandiInstance.name} API key to enable committing changes.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            To get your API key, log in to{' '}
            <a
              href={dandiInstance.webUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {dandiInstance.name}
            </a>
            {' '}and click on your user initials in the top-right corner.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <TextField
              fullWidth
              label="API Key"
              type={showKey ? 'text' : 'password'}
              value={localApiKey}
              onChange={(e) => setLocalApiKey(e.target.value)}
              placeholder={`Enter your ${dandiInstance.name} API key`}
              autoComplete="off"
            />
            <IconButton onClick={() => setShowKey(!showKey)}>
              {showKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
            </IconButton>
          </Box>
          <ApiKeyPersistCheckbox
            checked={persistKey === 'local'}
            onChange={(checked) => setPersistKey(checked ? 'local' : 'session')}
          />
          {keyError && (
            <Alert severity="error" sx={{ mt: 1 }}>{keyError}</Alert>
          )}
        </DialogContent>
        <DialogActions>
          {hasApiKey && (
            <Button onClick={handleClear} color="error">
              Clear Key
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button onClick={handleClose} disabled={isVerifying}>Cancel</Button>
          <Button onClick={handleSave} variant="contained" disabled={isVerifying}>
            {isVerifying ? <CircularProgress size={20} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
