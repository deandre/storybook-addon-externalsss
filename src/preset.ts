import { scanConcurrency, type ScanConcurrency } from './scan-options';
import { trustedOrigins } from './bridge-protocol';

export interface ExternalsssOptions {
  scanConcurrency?: ScanConcurrency;
  trustedManagerOrigins?: string[];
}

// Storybook discovers the existing manager and preview exports itself. The
// preset adds configuration only, so those entries are never registered twice.
export function managerHead(head = '', options: ExternalsssOptions = {}): string {
  const json = JSON.stringify(trustedOrigins(options.trustedManagerOrigins)).replaceAll('<', '\\u003c');
  const scanOptions = JSON.stringify({ scanConcurrency: scanConcurrency(options.scanConcurrency) });
  return `${head}<script id="externalsss-trusted-origins" type="application/json">${json}</script>
<script id="externalsss-scan-options" type="application/json">${scanOptions}</script>
<script>if(new URLSearchParams(location.search).has('externalsssBridge')){Object.defineProperty(window,'REFS',{configurable:true,get:function(){return {};},set:function(){}});}</script>`;
}
