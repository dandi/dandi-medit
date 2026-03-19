import { useState, useEffect } from 'react';
import { Box, Button, Typography, Tooltip, Badge, CircularProgress, Alert, Snackbar, IconButton } from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import LockIcon from '@mui/icons-material/Lock';
import LinkIcon from '@mui/icons-material/Link';
import { useMetadataContext } from '../../context/MetadataContext';
import { commitMetadataChanges, fetchDandisetVersionInfo, checkUserIsOwner } from '../../utils/api';
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
    clearModifications,
    dandiApiBase,
  } = useMetadataContext();

  const [isCommitting, setIsCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitSuccess, setCommitSuccess] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState<boolean | null>(null);

  const hasChanges = JSON.stringify(originalMetadata) !== JSON.stringify(modifiedMetadata);
  const canCommit = hasChanges && !!apiKey && !!versionInfo && isOwner === true;

  // Check if the user is an owner of the dandiset
  useEffect(() => {
    async function checkOwnership() {
      if (!apiKey || !dandisetId) {
        setIsOwner(null);
        return;
      }

      try {
        const ownerStatus = await checkUserIsOwner(dandisetId, apiKey, dandiApiBase);
        setIsOwner(ownerStatus);
      } catch (error) {
        console.error('Failed to check ownership:', error);
        setIsOwner(false);
      }
    }

    checkOwnership();
  }, [apiKey, dandisetId]);

  const handleCommit = async () => {
    if (!apiKey || !versionInfo || !dandisetId || !version) {
      return;
    }

    setIsCommitting(true);
    setCommitError(null);

    try {
      // Commit the changes directly to the DANDI API
      await commitMetadataChanges(dandisetId, version, modifiedMetadata, apiKey, dandiApiBase);

      // Success! Clear pending changes
      clearModifications();
      setCommitSuccess(true);

      // Refresh the version info to get the latest state
      setIsLoading(true);
      try {
        const updatedInfo = await fetchDandisetVersionInfo(dandisetId, version, apiKey, dandiApiBase);
        setVersionInfo(updatedInfo);
      } catch (refreshError) {
        console.warn('Failed to refresh version info after commit:', refreshError);
        // Don't show error to user - commit was successful
      } finally {
        setIsLoading(false);
      }

    } catch (error) {
      console.error('Commit failed:', error);
      setCommitError(error instanceof Error ? error.message : 'Failed to commit changes');
    } finally {
      setIsCommitting(false);
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

        {/* Commit button */}
        <Tooltip
          title={
            !apiKey
              ? 'API key required to commit changes'
              : isOwner === false
              ? 'You must be an owner of this dandiset to commit changes'
              : !hasChanges
              ? 'No pending changes to commit'
              : 'Commit all pending changes'
          }
        >
          <span>
            <Button
              variant="contained"
              color="success"
              size="small"
              startIcon={isCommitting ? <CircularProgress size={16} color="inherit" /> : (!apiKey ? <LockIcon /> : <SaveIcon />)}
              onClick={handleCommit}
              disabled={!canCommit || isCommitting}
            >
              {isCommitting ? 'Committing...' : 'Commit Changes'}
            </Button>
          </span>
        </Tooltip>
      </Box>

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
