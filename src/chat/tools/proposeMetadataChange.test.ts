import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isPrefixedAwardNumber,
  proposeMetadataChangeTool,
  stripAwardNumberPrefix,
} from './proposeMetadataChange';
import type { ToolExecutionContext } from '../types';

describe('award number prefix detection', () => {
  it.each([
    ['Grant No. 12345', '12345'],
    ['grant 12345', '12345'],
    ['Grant number 12345', '12345'],
    ['Award #12345', '12345'],
    ['award: R01NS123456', 'R01NS123456'],
    ['Project number 7', '7'],
    ['Project No 276693517', '276693517'],
    ['No. 12345', '12345'],
    ['no 12345', '12345'],
    ['#12345', '12345'],
    ['# 12345', '12345'],
    ['Grant Award No. 99', '99'],
  ])('flags %j and strips it to %j', (input, expected) => {
    expect(isPrefixedAwardNumber(input)).toBe(true);
    expect(stripAwardNumberPrefix(input)).toBe(expected);
  });

  it.each([
    'NOAA-123',
    'Nordic-2020',
    'Novartis-77',
    'R01NS123456',
    '276693517',
    'Grant-2020-001',
    'Project-X-12',
    'NSF 1707398',
    'U19NS123456-01A1',
  ])('accepts %j as a bare identifier', (input) => {
    expect(isPrefixedAwardNumber(input)).toBe(false);
    expect(stripAwardNumberPrefix(input)).toBe(input);
  });

  it('does not flag a bare keyword with nothing after it', () => {
    expect(isPrefixedAwardNumber('grant')).toBe(false);
    expect(isPrefixedAwardNumber('No. ')).toBe(false);
  });
});

describe('propose_metadata_change award number handling', () => {
  const modifyMetadata = vi.fn();
  const context: ToolExecutionContext = {
    modifyMetadata,
    originalMetadata: { contributor: [] },
    modifiedMetadata: { contributor: [] },
  };

  const funder = (awardNumber: string) => ({
    schemaKey: 'Organization',
    name: 'National Institutes of Health',
    roleName: ['dcite:Funder'],
    awardNumber,
  });

  beforeEach(() => {
    modifyMetadata.mockReset();
    modifyMetadata.mockReturnValue({ success: true });
    // Identifier validation may reach the network for ORCID and ROR lookups;
    // the funders here carry neither, but keep fetch stubbed so no test can.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects a funder object whose award number carries a prefix', async () => {
    const { result } = await proposeMetadataChangeTool.execute(
      { operation: 'append', path: 'contributor', value: funder('Grant No. 12345') },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('contributor.awardNumber');
    expect(parsed.error).toContain('"12345"');
    expect(modifyMetadata).not.toHaveBeenCalled();
  });

  it('rejects a direct awardNumber path with a prefix', async () => {
    const { result } = await proposeMetadataChangeTool.execute(
      { operation: 'set', path: 'contributor.0.awardNumber', value: 'Award #R01NS123456' },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('"R01NS123456"');
    expect(modifyMetadata).not.toHaveBeenCalled();
  });

  it('accepts an award number that merely starts with the letters "no"', async () => {
    const value = funder('NOAA-123');
    const { result } = await proposeMetadataChangeTool.execute(
      { operation: 'append', path: 'contributor', value },
      context,
    );
    expect(JSON.parse(result).success).toBe(true);
    expect(modifyMetadata).toHaveBeenCalledWith('append', 'contributor', value);
  });

  it('records exactly one failure per prefixed change in a batch', async () => {
    const { result } = await proposeMetadataChangeTool.execute(
      {
        changes: [
          { operation: 'append', path: 'contributor', value: funder('Project number 1') },
          { operation: 'append', path: 'contributor', value: funder('276693517') },
        ],
      },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.totalChanges).toBe(2);
    expect(parsed.failedChanges).toBe(1);
    expect(parsed.successfulChanges).toBe(1);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0]).toMatchObject({ index: 0, success: false });
    expect(parsed.results[1]).toMatchObject({ index: 1, success: true });
    expect(modifyMetadata).toHaveBeenCalledTimes(1);
  });
});
