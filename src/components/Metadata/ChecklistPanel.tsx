import { useMemo } from 'react';
import { Box, Chip, LinearProgress, Paper, Tooltip, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import ChecklistIcon from '@mui/icons-material/Checklist';
import { computeChecklist, summarizeChecklist, type ChecklistAssessment, type ChecklistItem } from '../../core/checklist';
import { useMetadataContext } from '../../context/useMetadataContext';

interface ChecklistPanelProps {
  /** Model assessment of the judgment items, when available. */
  assessment?: ChecklistAssessment;
}

function StatusIcon({ status }: { status: ChecklistItem['status'] }) {
  if (status === 'pass') return <CheckCircleIcon fontSize="small" color="success" />;
  if (status === 'fail') return <CancelIcon fontSize="small" color="error" />;
  return <HourglassEmptyIcon fontSize="small" color="disabled" />;
}

/**
 * Live metadata quality checklist. Rule-based items are computed from the
 * current (modified) metadata, so pending edits update them immediately.
 */
export function ChecklistPanel({ assessment }: ChecklistPanelProps) {
  const { modifiedMetadata } = useMetadataContext();
  const items = useMemo(() => computeChecklist(modifiedMetadata, assessment), [modifiedMetadata, assessment]);
  const summary = useMemo(() => summarizeChecklist(items), [items]);

  if (!modifiedMetadata) return null;

  const percent = summary.rulesTotal > 0 ? Math.round((summary.rulesPassed / summary.rulesTotal) * 100) : 0;

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <ChecklistIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" fontWeight="bold" sx={{ flex: 1 }}>
          Metadata Checklist
        </Typography>
        <Tooltip title="Rule-based items computed from the metadata. Judgment items are assessed by the assistant.">
          <Chip
            size="small"
            color={summary.rulesPassed === summary.rulesTotal ? 'success' : 'default'}
            label={`${summary.rulesPassed} / ${summary.rulesTotal}${summary.pending > 0 ? ` · ${summary.pending} to assess` : ''}`}
          />
        </Tooltip>
      </Box>
      <LinearProgress
        variant="determinate"
        value={percent}
        color={percent === 100 ? 'success' : 'primary'}
        sx={{ mb: 1.5, height: 6, borderRadius: 3 }}
      />
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {items.map((item) => (
          <Box component="li" key={item.id} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            <Box sx={{ mt: 0.25, display: 'flex' }}>
              <StatusIcon status={item.status} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: item.status === 'fail' ? 600 : 400 }}>
                {item.label}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', wordBreak: 'break-word' }}>
                {item.detail}
              </Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </Paper>
  );
}
