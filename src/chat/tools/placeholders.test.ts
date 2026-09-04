import { describe, expect, it, vi } from 'vitest';
import { describePlaceholderFindings, findPlaceholderValues, isPlaceholderString } from './placeholders';
import { proposeMetadataChangeTool } from './proposeMetadataChange';
import type { ToolExecutionContext } from '../types';

describe('isPlaceholderString', () => {
  it.each([
    '', '   ', 'N/A', 'n/a', 'NA', 'None', 'unknown', 'Not specified', 'not provided', 'TBD', 'TBA', 'To be determined',
    'TODO', 'pending', 'placeholder', 'XXX', '???', '-', '[Insert IRB number]', '[TBD]', '<approval number>', '{DOI}',
    'Insert email here', 'Enter approval number', 'Your name here', 'Placeholder value', 'example_value',
    '0000-0000-0000-0000', '0000-0000-0000-000X', 'https://ror.org/XXXXXXX', 'https://ror.org/0000000',
    'https://doi.org/10.xxxx/placeholder', 'someone@example.com', 'contact@test.org', 'IRB number', 'Protocol #',
  ])('flags %j', (value) => {
    expect(isPlaceholderString(value)).toBe(true);
  });

  it.each([
    'Lovelace, Augusta Ada', 'Stanford University', 'https://ror.org/00f54p054', '0000-0001-9902-1984',
    'ada@lbl.gov', 'IRB-2021-0456', 'Protocol AN123456', 'https://doi.org/10.7554/eLife.78362',
    'Unknown cortical layer recordings', 'Testing the limits of working memory', 'This dataset has none of the artifacts seen previously.',
    'Nature Neuroscience', 'Pending publication of the companion paper, this description will be expanded.',
    'spdx:CC-BY-4.0', 'dcite:ContactPerson', 'A test of hippocampal replay',
  ])('accepts %j', (value) => {
    expect(isPlaceholderString(value)).toBe(false);
  });
});

describe('findPlaceholderValues', () => {
  it('walks nested objects and arrays and reports dot paths', () => {
    const findings = findPlaceholderValues(
      {
        schemaKey: 'EthicsApproval',
        identifier: 'N/A',
        contactPoint: { schemaKey: 'ContactPoint', email: 'someone@example.com', url: 'https://irb.stanford.edu' },
        notes: ['fine', '[insert]'],
      },
      'ethicsApproval.0',
    );
    expect(findings).toEqual([
      { path: 'ethicsApproval.0.identifier', value: 'N/A' },
      { path: 'ethicsApproval.0.contactPoint.email', value: 'someone@example.com' },
      { path: 'ethicsApproval.0.notes.1', value: '[insert]' },
    ]);
  });

  it('checks a bare string value and ignores schemaKey constants', () => {
    expect(findPlaceholderValues('TBD', 'name')).toEqual([{ path: 'name', value: 'TBD' }]);
    expect(findPlaceholderValues({ schemaKey: 'Person', name: 'Doe, Jane' }, 'contributor.0')).toEqual([]);
    expect(findPlaceholderValues(42, 'x')).toEqual([]);
    expect(findPlaceholderValues(null, 'x')).toEqual([]);
  });

  it('describes findings for the model', () => {
    const message = describePlaceholderFindings([{ path: 'ethicsApproval.0.identifier', value: 'N/A' }]);
    expect(message).toContain('ethicsApproval.0.identifier: "N/A"');
    expect(message).toContain('Omit the field');
  });
});

describe('propose_metadata_change rejects placeholders', () => {
  const modifyMetadata = vi.fn().mockReturnValue({ success: true });
  const context: ToolExecutionContext = { modifyMetadata, originalMetadata: {}, modifiedMetadata: {} };

  it('rejects a stub ethics approval and does not apply it', async () => {
    modifyMetadata.mockClear();
    const { result } = await proposeMetadataChangeTool.execute(
      {
        operation: 'append',
        path: 'ethicsApproval',
        value: { schemaKey: 'EthicsApproval', identifier: 'Not specified' },
      },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('placeholder');
    expect(parsed.error).toContain('ethicsApproval.identifier');
    expect(modifyMetadata).not.toHaveBeenCalled();
  });

  it('rejects a placeholder in one change of a batch and applies the other', async () => {
    modifyMetadata.mockClear();
    const { result } = await proposeMetadataChangeTool.execute(
      {
        changes: [
          { operation: 'set', path: 'description', value: 'TBD' },
          { operation: 'append', path: 'keywords', value: 'grid cells' },
        ],
      },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.failedChanges).toBe(1);
    expect(parsed.successfulChanges).toBe(1);
    expect(modifyMetadata).toHaveBeenCalledTimes(1);
    expect(modifyMetadata).toHaveBeenCalledWith('append', 'keywords', 'grid cells');
  });
});
