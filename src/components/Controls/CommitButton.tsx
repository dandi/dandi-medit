import { useState, useEffect } from 'react';
import { Box, Button, Typography, Tooltip, Badge, CircularProgress, Alert, Snackbar, IconButton, FormControlLabel, Switch } from '@mui/material';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import SaveIcon from '@mui/icons-material/Save';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import LockIcon from '@mui/icons-material/Lock';
import LinkIcon from '@mui/icons-material/Link';
import { useMetadataContext } from '../../context/useMetadataContext';
import { CommitConfirmDialog } from './CommitConfirmDialog';
import { commitMetadataChanges, fetchDandisetVersionInfo, fetchEditPermission, type EditPermission } from '../../utils/api';
import { resolveCommitPermission } from './commitPermission';
import { createProposalLink } from '../../core/proposalLink';
import type { DandisetMetadata } from '../../types/dandiset';

interface CommitButtonProps {
  isReviewMode?: boolean;
}

export function CommitButton({ isReviewMode = false }: CommitButtonProps) {
  const {
    apiKey,
    versionInfo,
    dandisetId,
    version,
    setVersionInfo,
    setIsLoading,
    originalMetadata,
    modifiedMetadata,
    hasChanges,
    setOriginalMetadata,
    clearModifications,
    dandiApiBase,
    dandiInstance,
  } = useMetadataContext();

  const [isCommitting, setIsCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitSuccess, setCommitSuccess] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  const [permission, setPermission] = useState<EditPermission | null>(null);
  // Admin mode is deliberate and per dandiset: it is remembered as the id it
  // was enabled for, so loading another dandiset starts with it off again.
  const [adminModeFor, setAdminModeFor] = useState<string | null>(null);
  const adminMode = adminModeFor === dandisetId;
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Bumped every time the dialog opens so it remounts with a cleared checkbox.
  const [confirmKey, setConfirmKey] = useState(0);

  const commitPermission = resolveCommitPermission(permission, adminMode);
  const canCommit = hasChanges && !!apiKey && !!versionInfo && commitPermission.allowed;

  // Find out whether the user owns the dandiset or is an administrator
  useEffect(() => {
    let cancelled = false;
    async function loadPermission() {
      if (!apiKey || !dandisetId) {
        setPermission(null);
        return;
      }
      const result = await fetchEditPermission(dandisetId, apiKey, dandiApiBase);
      if (!cancelled) setPermission(result);
    }
    loadPermission();
    return () => {
      cancelled = true;
    };
  }, [apiKey, dandisetId, dandiApiBase]);

  const handleOpenConfirm = () => {
    setConfirmKey((key) => key + 1);
    setConfirmOpen(true);
  };

  const handleCommit = async () => {
    if (!apiKey || !versionInfo || !dandisetId || !version || !modifiedMetadata) {
      return;
    }

    setIsCommitting(true);
    setCommitError(null);

    try {
      // Commit the changes directly to the DANDI API
      await commitMetadataChanges(dandisetId, version, modifiedMetadata, apiKey, dandiApiBase);

      // Success! The committed metadata is now the local original, so the
      // panel keeps showing what was just committed (this also resets the
      // pending modifications).
      setOriginalMetadata(modifiedMetadata);
      setCommitSuccess(true);

      // Refresh the version info to get the latest state
      setIsLoading(true);
      try {
        const updatedInfo = await fetchDandisetVersionInfo(dandisetId, version, apiKey, dandiApiBase);
        setVersionInfo(updatedInfo);
      } catch (refreshError) {
        console.warn('Failed to refresh version info after commit:', refreshError);
        // The commit itself succeeded, so warn without blocking.
        setRefreshWarning('Changes were committed, but the page could not be refreshed with the latest server copy.');
      } finally {
        setIsLoading(false);
      }

    } catch (error) {
      console.error('Commit failed:', error);
      setCommitError(error instanceof Error ? error.message : 'Failed to commit changes');
    } finally {
      setIsCommitting(false);
      setConfirmOpen(false);
    }
  };


  const handleDiscard = () => {
    if (window.confirm('Are you sure you want to discard all pending changes?')) {
      clearModifications();
    }
  };

  const handleCopyProposalLink = async () => {
    if (!dandisetId || !originalMetadata || !modifiedMetadata || !hasChanges) {
      return;
    }

    try {
      const link = await createProposalLink(
        dandisetId,
        originalMetadata as DandisetMetadata,
        modifiedMetadata as DandisetMetadata
      );
      
      if (!link) {
        setCopyError('No changes to share');
        return;
      }
      
      await navigator.clipboard.writeText(link);
      setCopySuccess(true);
    } catch (error) {
      console.error('Failed to copy proposal link:', error);
      setCopyError(error instanceof Error ? error.message : 'Failed to create proposal link');
    }
  };

  if (!versionInfo) {
    return null;
  }

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        {/* Pending changes indicator - hidden in review mode */}
        {!isReviewMode && hasChanges && (
          <Badge color="secondary" variant="dot">
            <Typography variant="body2" color="textSecondary">
              You have pending changes
            </Typography>
          </Badge>
        )}

        {/* Copy Proposal Link button - hidden in review mode */}
        {!isReviewMode && (
          <Tooltip title={!hasChanges ? 'No changes to share' : 'Copy a shareable link with your proposed changes'}>
            <span>
              <IconButton
                color="primary"
                size="small"
                onClick={handleCopyProposalLink}
                disabled={!hasChanges || isCommitting}
                sx={{
                  border: '1px solid',
                  borderColor: 'primary.main',
                  '&:disabled': {
                    borderColor: 'action.disabled'
                  }
                }}
              >
                <LinkIcon />
              </IconButton>
            </span>
          </Tooltip>
        )}

        {/* Discard button - hidden in review mode */}
        {!isReviewMode && (
          <Button
            variant="outlined"
            color="warning"
            size="small"
            startIcon={<DeleteSweepIcon />}
            onClick={handleDiscard}
            disabled={!hasChanges || isCommitting}
          >
            Discard All
          </Button>
        )}

        {/* Admin mode: only offered to administrators who do not own the dandiset */}
        {apiKey && commitPermission.adminModeAvailable && (
          <Tooltip title="You are not an owner of this dandiset. Admin mode lets you commit anyway, using your DANDI administrator rights.">
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  color="warning"
                  checked={adminMode}
                  onChange={(e) => setAdminModeFor(e.target.checked ? dandisetId : null)}
                  disabled={isCommitting}
                />
              }
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <AdminPanelSettingsIcon fontSize="small" color={adminMode ? 'warning' : 'disabled'} />
                  <Typography variant="body2" color={adminMode ? 'warning.main' : 'text.secondary'}>
                    Admin mode
                  </Typography>
                </Box>
              }
              sx={{ mr: 0 }}
            />
          </Tooltip>
        )}

        {/* Commit button */}
        <Tooltip
          title={
            !apiKey
              ? 'API key required to commit changes'
              : commitPermission.reason
              ? commitPermission.reason
              : !hasChanges
              ? 'No pending changes to commit'
              : commitPermission.viaAdmin
              ? 'Commit all pending changes as a DANDI administrator'
              : 'Commit all pending changes'
          }
        >
          <span>
            <Button
              variant="contained"
              color={commitPermission.viaAdmin ? 'warning' : 'success'}
              size="small"
              startIcon={
                isCommitting
                  ? <CircularProgress size={16} color="inherit" />
                  : !apiKey
                    ? <LockIcon />
                    : commitPermission.viaAdmin
                      ? <AdminPanelSettingsIcon />
                      : <SaveIcon />
              }
              onClick={handleOpenConfirm}
              disabled={!canCommit || isCommitting}
            >
              {isCommitting ? 'Committing...' : commitPermission.viaAdmin ? 'Commit as admin' : 'Commit Changes'}
            </Button>
          </span>
        </Tooltip>
      </Box>

      <CommitConfirmDialog
        key={confirmKey}
        open={confirmOpen}
        dandisetId={dandisetId}
        instanceName={dandiInstance.name}
        original={originalMetadata}
        modified={modifiedMetadata}
        isCommitting={isCommitting}
        asAdmin={commitPermission.viaAdmin}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleCommit}
      />

      {/* Success snackbar */}
      <Snackbar
        open={commitSuccess}
        autoHideDuration={6000}
        onClose={() => setCommitSuccess(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={() => setCommitSuccess(false)} 
          severity="success" 
          variant="filled"
          sx={{ width: '100%' }}
        >
          Metadata committed successfully!
        </Alert>
      </Snackbar>

      {/* Error snackbar */}
      <Snackbar
        open={!!commitError}
        autoHideDuration={10000}
        onClose={() => setCommitError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setCommitError(null)}
          severity="error"
          variant="filled"
          sx={{ width: '100%' }}
        >
          {commitError}
        </Alert>
      </Snackbar>

      {/* Copy success snackbar */}
      <Snackbar
        open={copySuccess}
        autoHideDuration={4000}
        onClose={() => setCopySuccess(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setCopySuccess(false)}
          severity="success"
          variant="filled"
          sx={{ width: '100%' }}
        >
          Proposal link copied to clipboard!
        </Alert>
      </Snackbar>

      {/* Refresh warning snackbar */}
      <Snackbar
        open={!!refreshWarning}
        autoHideDuration={10000}
        onClose={() => setRefreshWarning(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setRefreshWarning(null)}
          severity="warning"
          variant="filled"
          sx={{ width: '100%' }}
        >
          {refreshWarning}
        </Alert>
      </Snackbar>

      {/* Copy error snackbar */}
      <Snackbar
        open={!!copyError}
        autoHideDuration={10000}
        onClose={() => setCopyError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setCopyError(null)}
          severity="error"
          variant="filled"
          sx={{ width: '100%' }}
        >
          {copyError}
        </Alert>
      </Snackbar>
    </>
  );
}
