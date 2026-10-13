import { trustedOrigins } from './bridge-protocol';

export interface ExternalsssOptions {
  trustedManagerOrigins?: string[];
}

// Storybook discovers the existing manager and preview exports itself. The
// preset adds configuration only, so those entries are never registered twice.
export function managerHead(head = '', options: ExternalsssOptions = {}): string {
  const json = JSON.stringify(trustedOrigins(options.trustedManagerOrigins)).replaceAll('<', '\\u003c');
  return `${head}<script id="externalsss-trusted-origins" type="application/json">${json}</script>
<script>if(new URLSearchParams(location.search).has('externalsssBridge')){Object.defineProperty(window,'REFS',{configurable:true,get:function(){return {};},set:function(){}});}</script>`;
}
