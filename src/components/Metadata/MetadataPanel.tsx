import DescriptionIcon from '@mui/icons-material/Description';
import EditIcon from '@mui/icons-material/Edit';
import EditNoteIcon from '@mui/icons-material/EditNote';
import { Box, Button, CircularProgress, IconButton, Tooltip, Typography } from '@mui/material';
import { useState } from 'react';
import { useMetadataContext } from '../../context/useMetadataContext';
import { CommitButton } from '../Controls/CommitButton';
import { DandisetInfo } from './DandisetInfo';
import { JsonEditorDialog } from './JsonEditorDialog';
import { ChangesSummary } from './ChangesSummary';
import { EditableMetadataView } from './EditableMetadataView';

interface MetadataPanelProps {
  isReviewMode?: boolean;
  onExitReviewMode?: () => void;
}

export function MetadataPanel({ isReviewMode = false, onExitReviewMode }: MetadataPanelProps) {
  const { versionInfo, isLoading, originalMetadata, modifiedMetadata } = useMetadataContext();
  const [editorOpen, setEditorOpen] = useState(false);

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'background.default',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          p: 2,
          borderBottom: 1,
          borderColor: 'divider',
          backgroundColor: 'background.paper',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1,
        }}
      >
        <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1, userSelect: 'none' }}>
          <DescriptionIcon color="primary" />
          Metadata
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {isReviewMode && onExitReviewMode && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<EditNoteIcon />}
              onClick={onExitReviewMode}
            >
              Edit
            </Button>
          )}
          {!isReviewMode && versionInfo && (
            <Tooltip title="Edit JSON directly">
              <IconButton
                onClick={() => setEditorOpen(true)}
                size="small"
                color="primary"
              >
                <EditIcon />
              </IconButton>
            </Tooltip>
          )}
          <CommitButton isReviewMode={isReviewMode} />
        </Box>
      </Box>

      {/* Content */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          p: 2,
        }}
      >
        {isLoading ? (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              height: '100%',
            }}
          >
            <CircularProgress />
          </Box>
        ) : versionInfo ? (
          <>
            {/* Dandiset Info */}
            <DandisetInfo />

            {/* Changes Summary - appears at top when there are pending changes */}
            <ChangesSummary original={originalMetadata} modified={modifiedMetadata} />
            
            {/* Editable Metadata View */}
            <EditableMetadataView />
          </>
        ) : (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              height: '100%',
              color: 'text.secondary',
            }}
          >
            <DescriptionIcon sx={{ fontSize: 64, color: 'grey.300', mb: 2 }} />
            <Typography variant="h6" color="text.secondary">
              Loading Dandiset...
            </Typography>
          </Box>
        )}
      </Box>

      {/* JSON Editor Dialog */}
      <JsonEditorDialog
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
      />
    </Box>
  );
}
