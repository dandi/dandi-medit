import { useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  LinearProgress,
  Tooltip,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
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
 * Metadata quality checklist, shown as a collapsed accordion whose header
 * carries the score. Rule-based items are computed from the current
 * (modified) metadata, so pending edits update them immediately.
 */
export function ChecklistPanel({ assessment }: ChecklistPanelProps) {
  const { modifiedMetadata } = useMetadataContext();
  const [expanded, setExpanded] = useState(false);
  const items = useMemo(() => computeChecklist(modifiedMetadata, assessment), [modifiedMetadata, assessment]);
  const summary = useMemo(() => summarizeChecklist(items), [items]);

  if (!modifiedMetadata) return null;

  const complete = summary.rulesPassed === summary.rulesTotal;
  const percent = summary.rulesTotal > 0 ? Math.round((summary.rulesPassed / summary.rulesTotal) * 100) : 0;
  const failing = items.filter((i) => i.status === 'fail');

  return (
    <Accordion
      expanded={expanded}
      onChange={(_, isExpanded) => setExpanded(isExpanded)}
      disableGutters
      variant="outlined"
      sx={{ mb: 2, '&:before': { display: 'none' }, borderRadius: 1, overflow: 'hidden' }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 48, '& .MuiAccordionSummary-content': { alignItems: 'center', gap: 1, my: 1 } }}>
        <ChecklistIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" fontWeight="bold" sx={{ flex: 1 }}>
          Metadata Checklist
        </Typography>
        {!expanded && failing.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', md: 'block' }, mr: 1 }}>
            {failing.length} to fix
          </Typography>
        )}
        <Tooltip title="Rule-based items computed from the metadata. Judgment items are assessed by the assistant.">
          <Chip
            size="small"
            color={complete ? 'success' : 'default'}
            label={`${summary.rulesPassed} / ${summary.rulesTotal}${summary.pending > 0 ? ` · ${summary.pending} to assess` : ''}`}
            onClick={(e) => e.stopPropagation()}
          />
        </Tooltip>
      </AccordionSummary>
      <LinearProgress
        variant="determinate"
        value={percent}
        color={complete ? 'success' : 'primary'}
        sx={{ height: 4 }}
      />
      <AccordionDetails sx={{ pt: 1.5 }}>
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
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
      </AccordionDetails>
    </Accordion>
  );
}
