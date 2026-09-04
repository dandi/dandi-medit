import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Typography,
} from '@mui/material';
import { summarizePendingChanges } from '../../core/metadataDiff';

export const CHANGE_PREVIEW_LIMIT = 15;

interface CommitConfirmDialogProps {
  open: boolean;
  dandisetId: string;
  instanceName: string;
  original: unknown;
  modified: unknown;
  isCommitting: boolean;
  /** The commit relies on administrator rights rather than ownership. */
  asAdmin?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function CommitConfirmDialog({
  open,
  dandisetId,
  instanceName,
  original,
  modified,
  isCommitting,
  onCancel,
  asAdmin = false,
  onConfirm,
}: CommitConfirmDialogProps) {
  // The dialog is remounted (via a key) each time it opens, so computing the
  // summary once at mount keeps the list stable while the commit is in flight.
  const [{ lines, hidden, total }] = useState(() =>
    summarizePendingChanges(original, modified, CHANGE_PREVIEW_LIMIT)
  );
  const [reviewed, setReviewed] = useState(false);

  return (
    <Dialog open={open} onClose={isCommitting ? undefined : onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>
        Commit {total} {total === 1 ? 'change' : 'changes'} to dandiset {dandisetId} on {instanceName}?
      </DialogTitle>
      <DialogContent>
        {asAdmin && (
          <Alert severity="error" sx={{ mb: 2 }}>
            You are not an owner of dandiset {dandisetId}. This commit will use your DANDI
            administrator rights, and the owners will not be notified by this tool. Make sure
            they expect these changes.
          </Alert>
        )}
        <Alert severity="warning" sx={{ mb: 2 }}>
          Please verify every change before committing. This AI assistant can still make mistakes,
          including incorrect ordering, hallucinated identifiers, or inappropriate values. Review
          each proposed change carefully.
        </Alert>

        <Box
          component="ul"
          sx={{
            m: 0,
            pl: 3,
            maxHeight: 260,
            overflowY: 'auto',
            listStyleType: 'disc',
          }}
        >
          {lines.map((line, index) => (
            <Typography
              key={`${index}-${line}`}
              component="li"
              variant="body2"
              sx={{ wordBreak: 'break-word' }}
            >
              {line}
            </Typography>
          ))}
        </Box>
        {hidden > 0 && (
          <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
            and {hidden} more
          </Typography>
        )}

        <FormControlLabel
          sx={{ mt: 2 }}
          control={
            <Checkbox
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
              disabled={isCommitting}
            />
          }
          label="I have reviewed each of these changes"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} color="inherit" disabled={isCommitting}>
          Cancel
        </Button>
        <Button
          onClick={onConfirm}
          color="success"
          variant="contained"
          disabled={!reviewed || isCommitting}
        >
          {isCommitting ? 'Committing...' : 'Commit'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
