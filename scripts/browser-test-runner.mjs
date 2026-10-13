import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const metadata = require('storybook/package.json');
const storybook = join(
  dirname(require.resolve('storybook/package.json')),
  typeof metadata.bin === 'string' ? metadata.bin : metadata.bin.storybook,
);
const base = 'http://127.0.0.1:6100/';
let server;
let test;
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(force);
  }
}
async function ready() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null)
      throw new Error('Demo server exited before becoming ready.');
    try {
      if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Demo server did not become ready within 120 seconds.');
}
async function shutdown() {
  await stop(test);
  await stop(server);
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void shutdown().finally(() => process.exit(1));
  });
try {
  let occupied = false;
  try {
    occupied = (await fetch(base, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {}
  if (occupied) throw new Error('Port 6100 is already serving HTTP. Stop that server before running test:browser:ci.');
  server = spawn(process.execPath, [storybook, 'dev', '-p', '6100', '--ci', '--no-open', '--exact-port'], {
    stdio: 'inherit',
    env: { ...process.env, STORYBOOK_DISABLE_TELEMETRY: '1' },
  });
  await ready();
  const limits = process.env.EXTERNALSSS_TEST_CONCURRENCY ? [Number(process.env.EXTERNALSSS_TEST_CONCURRENCY)] : [1, 2, 4];
  for (const limit of limits) {
    console.log(`Browser suite: concurrency ${limit}`);
    test = spawn(process.execPath, ['scripts/browser-test.mjs'], {
      stdio: 'inherit',
      env: { ...process.env, EXTERNALSSS_STORYBOOK_URL: base, EXTERNALSSS_TEST_MODE: '', EXTERNALSSS_TEST_CONCURRENCY: String(limit) },
    });
    const [code] = await once(test, 'exit');
    if (code !== 0) throw new Error(`Browser suite at concurrency ${limit} exited with ${code}.`);
  }
} finally {
  await shutdown();
}
