export type ScanConcurrency = 1 | 2 | 3 | 4;
// Selected by the strict 500-story benchmark gate (see scripts/benchmark-results.json).
export const DEFAULT_SCAN_CONCURRENCY: ScanConcurrency = 2;

export function scanConcurrency(value: unknown = DEFAULT_SCAN_CONCURRENCY): ScanConcurrency {
  if (value !== 1 && value !== 2 && value !== 3 && value !== 4)
    throw new Error('scanConcurrency must be an integer from 1 through 4.');
  return value;
}

export function configuredScanConcurrency(): ScanConcurrency {
  const value = JSON.parse(document.getElementById('externalsss-scan-options')?.textContent ?? '{}');
  return scanConcurrency(value.scanConcurrency);
}
