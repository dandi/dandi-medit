import { useState, useEffect } from 'react';
import {
  Box,
  TextField,
  Button,
  CircularProgress,
  Alert,
  Typography,
  Paper,
  IconButton,
  InputAdornment,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  FormControlLabel,
  Checkbox,
  TableSortLabel,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ScienceIcon from '@mui/icons-material/Science';
import KeyIcon from '@mui/icons-material/Key';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import LockIcon from '@mui/icons-material/Lock';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import { useMetadataContext } from '../../context/MetadataContext';
import {
  fetchDandisetVersionInfo,
  fetchDandisets,
  verifyApiKey,
  type OwnedDandiset,
  type DandisetSortOrder,
} from '../../utils/api';
import { getCurrentStorageType, type StorageType } from '../../utils/dandiApiKeyStorage';
import { ApiKeyPersistCheckbox } from '../Controls/ApiKeyPersistCheckbox';

interface WelcomePageProps {
  onDandisetLoaded: (dandisetId: string) => void;
}

const PAGE_SIZE = 25;

export function WelcomePage({ onDandisetLoaded }: WelcomePageProps) {
  const {
    setDandisetId,
    setVersion,
    setVersionInfo,
    isLoading,
    setIsLoading,
    error,
    setError,
    clearModifications,
    apiKey,
    setApiKey,
    dandiInstance,
    dandiApiBase,
  } = useMetadataContext();

  const [localDandisetId, setLocalDandisetId] = useState('');
  const [localApiKey, setLocalApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [persistKey, setPersistKey] = useState(() => getCurrentStorageType(dandiInstance.apiUrl));
  const [dandisets, setDandisets] = useState<OwnedDandiset[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [sortOrder, setSortOrder] = useState<DandisetSortOrder>('-modified');
  const [onlyMine, setOnlyMine] = useState(false);
  const [page, setPage] = useState(1);
  const [hideEmpty, setHideEmpty] = useState(true);
  const [isLoadingDandisets, setIsLoadingDandisets] = useState(false);
  const [isVerifyingKey, setIsVerifyingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  // Fetch dandisets
  useEffect(() => {
    // "My dandisets" requires an API key
    if (onlyMine && !apiKey) return;

    setIsLoadingDandisets(true);
    fetchDandisets({
      apiKey,
      onlyMine,
      hideEmpty,
      order: sortOrder,
      page,
      pageSize: PAGE_SIZE,
      dandiApiBase,
    })
      .then(({ results, count }) => {
        setDandisets(results);
        setTotalCount(count);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to fetch dandisets');
        setDandisets([]);
        setTotalCount(0);
      })
      .finally(() => {
        setIsLoadingDandisets(false);
      });
  }, [apiKey, dandiApiBase, sortOrder, onlyMine, hideEmpty, page, setError]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [sortOrder, onlyMine, hideEmpty]);

  const handleSaveApiKey = async () => {
    const trimmed = localApiKey.trim();
    if (!trimmed) return;
    setIsVerifyingKey(true);
    setKeyError(null);
    try {
      await verifyApiKey(trimmed, dandiInstance.apiUrl);
      const storageType: StorageType = persistKey ? 'local' : 'session';
      setApiKey(trimmed, storageType);
      setLocalApiKey('');
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setIsVerifyingKey(false);
    }
  };

  const handleApiKeyKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveApiKey();
    }
  };

  const handleLoadDandiset = async (dandisetIdToLoad: string) => {
    if (!dandisetIdToLoad.trim()) {
      setError('Please enter a Dandiset ID');
      return;
    }

    setIsLoading(true);
    setError(null);
    clearModifications();

    try {
      const info = await fetchDandisetVersionInfo(dandisetIdToLoad.trim(), 'draft', apiKey, dandiApiBase);
      setVersionInfo(info);
      setDandisetId(dandisetIdToLoad.trim());
      setVersion('draft');
      onDandisetLoaded(dandisetIdToLoad.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dandiset');
      setVersionInfo(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleManualLoad = () => {
    handleLoadDandiset(localDandisetId);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleManualLoad();
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        backgroundColor: 'grey.50',
        p: 3,
        overflow: 'auto',
      }}
    >
      <Paper
        elevation={3}
        sx={{
          p: 4,
          maxWidth: 950,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <Box sx={{ mb: 3, textAlign: 'center' }}>
          <ScienceIcon sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />
          <Typography variant="h5" gutterBottom>
            Dandiset Metadata Assistant
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Select a dandiset to edit or enter an ID manually
          </Typography>
        </Box>

        {/* API Key Section */}
        {!apiKey ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 3 }}>
            <TextField
              label="DANDI API Key (optional)"
              type={showApiKey ? 'text' : 'password'}
              value={localApiKey}
              onChange={(e) => setLocalApiKey(e.target.value)}
              onKeyPress={handleApiKeyKeyPress}
              fullWidth
              size="small"
              placeholder="Enter API key to see your dandisets and commit changes"
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => setShowApiKey(!showApiKey)} edge="end" size="small">
                      {showApiKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <ApiKeyPersistCheckbox
                checked={persistKey === 'local'}
                onChange={(checked) => setPersistKey(checked ? 'local' : 'session')}
              />
              <Button
                variant="contained"
                size="small"
                onClick={handleSaveApiKey}
                disabled={!localApiKey.trim() || isVerifyingKey}
                startIcon={isVerifyingKey ? <CircularProgress size={16} /> : <KeyIcon />}
              >
                {isVerifyingKey ? 'Verifying...' : 'Save Key'}
              </Button>
            </Box>
            {keyError && (
              <Alert severity="error" sx={{ mt: 1 }}>{keyError}</Alert>
            )}
            <Typography variant="caption" color="text.secondary">
              To get your API key, log in to{' '}
              <a href={dandiInstance.webUrl} target="_blank" rel="noopener noreferrer">
                {dandiInstance.name}
              </a>
              {' '}and click on your user initials in the top-right corner. An API key is only required to save metadata changes back to dandisets that you have write access to.
            </Typography>
          </Box>
        ) : null}

        {/* Manual ID Entry */}
        <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
          <TextField
            label="Dandiset ID"
            placeholder="e.g., 000003"
            value={localDandisetId}
            onChange={(e) => setLocalDandisetId(e.target.value)}
            onKeyPress={handleKeyPress}
            size="small"
            fullWidth
            disabled={isLoading}
          />
          <Button
            variant="contained"
            onClick={handleManualLoad}
            disabled={isLoading || !localDandisetId.trim()}
            startIcon={isLoading ? <CircularProgress size={16} /> : <SearchIcon />}
          >
            Load
          </Button>
        </Box>

        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Divider sx={{ mb: 2 }} />

        {/* Filter Controls */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
          <Typography variant="subtitle2" color="text.secondary">
            {onlyMine ? 'My' : 'All'} Dandisets ({totalCount.toLocaleString()})
          </Typography>
          <FormControlLabel
            control={
              <Checkbox
                checked={hideEmpty}
                onChange={(e) => setHideEmpty(e.target.checked)}
                size="small"
              />
            }
            label={<Typography variant="body2">Hide empty</Typography>}
            sx={{ ml: 1 }}
          />
          {apiKey && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={onlyMine}
                  onChange={(e) => setOnlyMine(e.target.checked)}
                  size="small"
                />
              }
              label={<Typography variant="body2">Only mine</Typography>}
            />
          )}
        </Box>

        {/* Dandisets Table */}
        {isLoadingDandisets ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : dandisets.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
            No dandisets found.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, width: 100 }}>
                    <TableSortLabel
                      active={sortOrder === 'id' || sortOrder === '-id'}
                      direction={sortOrder === '-id' ? 'desc' : 'asc'}
                      onClick={() => {
                        if (sortOrder === 'id') setSortOrder('-id');
                        else setSortOrder('id');
                      }}
                    >
                      ID
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 120, whiteSpace: 'nowrap' }}>
                    <TableSortLabel
                      active={sortOrder === 'modified' || sortOrder === '-modified'}
                      direction={sortOrder === '-modified' ? 'desc' : 'asc'}
                      onClick={() => {
                        if (sortOrder === '-modified') setSortOrder('modified');
                        else setSortOrder('-modified');
                      }}
                    >
                      Modified
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 80 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 100 }}>Stage</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {dandisets.map((dandiset) => (
                  <TableRow
                    key={dandiset.identifier}
                    hover
                    onClick={() => handleLoadDandiset(dandiset.identifier)}
                    sx={{ cursor: isLoading ? 'default' : 'pointer' }}
                  >
                    <TableCell>
                      <Typography variant="body2" fontWeight="medium">
                        {dandiset.identifier}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography
                        variant="body2"
                        sx={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: 400,
                        }}
                      >
                        {dandiset.draft_version.name}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {formatDate(dandiset.modified)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={
                          dandiset.draft_version.status === 'Valid' ? 'Valid'
                            : dandiset.draft_version.status === 'Pending' ? 'Pending'
                            : 'Invalid'
                        }
                        size="small"
                        color={
                          dandiset.draft_version.status === 'Valid' ? 'success'
                            : dandiset.draft_version.status === 'Pending' ? 'warning'
                            : 'error'
                        }
                        sx={{ fontSize: '0.65rem', height: 20 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={
                          dandiset.embargo_status === 'EMBARGOED' ? 'Embargoed'
                            : dandiset.draft_version.status === 'Published' ? 'Published'
                            : 'Draft'
                        }
                        size="small"
                        variant="outlined"
                        icon={dandiset.embargo_status === 'EMBARGOED' ? <LockIcon sx={{ fontSize: '14px !important' }} /> : undefined}
                        color={
                          dandiset.embargo_status === 'EMBARGOED' ? 'warning'
                            : dandiset.draft_version.status === 'Published' ? 'primary'
                            : 'default'
                        }
                        sx={{ fontSize: '0.65rem', height: 20 }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mt: 2 }}>
            <IconButton
              size="small"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isLoadingDandisets}
            >
              <NavigateBeforeIcon />
            </IconButton>
            <Typography variant="body2" color="text.secondary">
              Page {page} of {totalPages}
            </Typography>
            <IconButton
              size="small"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isLoadingDandisets}
            >
              <NavigateNextIcon />
            </IconButton>
          </Box>
        )}
      </Paper>
    </Box>
  );
}
