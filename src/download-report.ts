import { buildReport } from './report';
import type { ScanSession } from './scan';
import type { Catalog } from './remote-scan-controller';

export function downloadReport(session: ScanSession, catalog?: Catalog) {
  if (session.phase !== 'finished' || session.targets.length === 0) return;
  const generatedAt = new Date().toISOString();
  const report = buildReport(session.targets, session.results, session.outcome, generatedAt, catalog);
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = `externalsss-report-${generatedAt.replaceAll(':', '-').replaceAll('.', '-')}.json`;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
