# <picture><source media="(prefers-color-scheme: dark)" srcset="assets/logo/externalsss-symbol-dark.svg"><img src="assets/logo/externalsss-symbol.svg" alt="" width="42" height="42"></picture> Externalsss

Externalsss is an addon for Storybook 9 and 10. It checks local stories for resources that could make visual tests inconsistent. Open the **Externalsss** panel and choose **Run scan**. The addon visits each story in a hidden preview, leaving your selected story and visible Canvas in place.

The scan reports four kinds of findings:

- **Load failure:** An image completed without usable pixels, a resource element emitted a load error, or a font face reported an error.
- **External dependency:** An observed HTTP(S) resource came from another origin. It may affect stability, but the scan does not assume it failed.
- **Font timing:** A font was loading when Storybook signaled render, became available afterward, or was still loading when observation ended.
- **Review for mocking:** A fetch or XHR call was observed, including calls to the same origin. The scan cannot tell whether it is already mocked.

A resource can have more than one label, so category counts can overlap. Each count covers distinct resources in that category. Use the filters to see a category or the incomplete stories. Expand a result for the affected stories, full URL, and a suggested next step. Collapsed results hide query values.

When a scan finishes or stops, choose **Download JSON** to save the report. It includes findings, affected stories, category counts, and a status for every story. Observed stories also include diagnostic warnings and an error message when available. The report marks unvisited stories as `not-scanned`, so a cancelled or interrupted scan stays partial. The download omits resource URL query values and fragments. Check story names and resource paths before sharing it.

Choose **Retry incomplete** to revisit only stories whose observations did not complete, including stories not reached before cancellation. Completed observations stay in the report. Retries keep the original globals and preview settings; **Scan again** starts a new catalog scan with your current settings.

## Storybook testing controls

In Storybook development, Externalsss also appears in the testing controls. Choose **Run scan**, or use Storybook’s **Run tests** action, to scan the local catalog without opening the panel. Both entry points share progress and results. **View results**, or selecting an Externalsss story status, opens the panel’s local results.

Story statuses report errors for broken resources and render errors; warnings for resources needing review or incomplete observations; and success only for complete observations with no findings or diagnostic warnings. Success means no findings in the scan window. Cancelled and unvisited stories remain unknown. A completed run can contain story errors; a crashed provider means the scanner itself could not execute.

**Cancel** preserves partial results, and **Retry incomplete** retains completed observations. Storybook’s Clear control discards the local scan and its statuses after execution stops. The integration uses Storybook’s experimental Test Provider API automatically when available. Composed catalogs continue to use the panel and do not publish statuses into the host’s local catalog. Deployed static Storybooks retain panel scanning.

## Try the demo

Use Node.js 26.13.0 or newer within Node 26 and pnpm 12.16.1. The checkout pins
these versions in `.nvmrc` and `package.json`.

```sh
pnpm install
pnpm build
pnpm storybook
```

Open Storybook, select a demo story, and open **Externalsss**. The demo has local and broken images, external requests, fetch and XHR, successful and failed fonts, a late font, and a render error. Its external requests use `example.invalid` on purpose, including a remote asset that fails and receives more than one label.

## Install in another Storybook

In a Storybook 9 or 10 project using Node.js 20.19 or newer, install the addon with npm:

```sh
npm install -D storybook-addon-externalsss
```

Or with pnpm:

```sh
pnpm add -D storybook-addon-externalsss
```

Add the package to `.storybook/main.ts`:

```ts
export default {
  addons: ['storybook-addon-externalsss'],
};
```

Storybook supplies React for the manager panel. The addon works with React and other frameworks without adding or changing your app's React dependencies. Local scans need no preview import or addon options.

## Configure parallel scanning

Scans run two stories concurrently by default. Set `scanConcurrency` to an integer from 1 through 4 in `.storybook/main.ts`:

```ts
export default {
  addons: [
    {
      name: 'storybook-addon-externalsss',
      options: { scanConcurrency: 2 },
    },
  ],
};
```

Each active story has its own hidden iframe and 15-second deadline. Progress shows completed stories and active observations. **Cancel** stops queued stories, aborts active observations, and preserves collected results. **Retry incomplete** retains the scan's concurrency and original preview settings. Results stay in catalog order even when stories finish in a different order.

Parallel stories share browser CPU, network, cache, origin storage, and service workers. Contention can change font timing or cause timeouts, and stories can interfere through shared storage. Set `scanConcurrency: 1` to restore sequential scanning. Each referenced Storybook uses its own addon option; the host does not override it.

## Scan a composed Storybook

When your Storybook has `refs`, choose **Local** or a referenced catalog in the panel's **Catalog** selector. Each scan and JSON report covers one catalog. Loading or unavailable refs cannot be selected.

Install Externalsss in both the host and each referenced Storybook. In the referenced Storybook, allow the host's exact origin:

```ts
export default {
  addons: [
    {
      name: 'storybook-addon-externalsss',
      options: {
        trustedManagerOrigins: ['https://storybook.example.com'],
      },
    },
  ],
};
```

Include the port for development origins, such as `http://localhost:6006`. Wildcards, paths, query strings, and fragments are not accepted. Remote access is denied unless the origin is listed; URL parameters cannot grant access. Deploy the updated referenced Storybook before scanning it from the host. The host and referenced Storybooks must both use Externalsss bridge protocol v3; older bridge versions are rejected. Upgrade both installations together.

Remote scans run in a hidden instance of the referenced Storybook's manager and use that catalog's default globals and preview configuration. Nested refs are excluded. The host's visible Canvas stays in place, and story links open the source Storybook. **Retry incomplete** reuses the remote scan's original context.

The remote manager sends observations only to an explicitly trusted host. Trust a host only if it may receive the resource URLs shown in expanded findings. Authentication, framing policies, and index access must permit composition. Connection failures leave received results available to download; start a new scan to reconnect. Connecting can take up to 30 seconds, and a running bridge stops after 20 seconds without an update.

## What the scan can and cannot see

The scan covers `story` entries in the selected catalog’s own index. It does not recursively scan that catalog’s refs. It reads browser Resource Timing entries and records fetch/XHR calls made after instrumentation starts. Resource Timing is not a complete network trace, and cross-origin response details may be unavailable. An unknown response status is not treated as a failure.

Each story gets up to 15 seconds. After Storybook finishes rendering, the scan waits for images, fonts, stylesheets, and scripts to settle and then for 500 ms without activity. It uses the current Storybook globals and default story args.

A timeout, render error, cancellation, unsupported browser API, or resource buffer limit leaves the story marked incomplete. The scan may miss activity after the observation window.

Custom preview URLs must use the same origin as the manager. Preview instrumentation sends raw observations only to its same-origin manager. Composed scans relay results from that manager to an explicitly trusted host.

Results stay in the browser tab until you download a JSON file. The addon does not send reports to a service, save them automatically, or change requests. It does not lint CSS font declarations or create mocks.

## Checks

```sh
pnpm check
pnpm check:complexity
pnpm test
pnpm build
pnpm build-storybook
pnpm exec playwright install chromium
pnpm test:browser
pnpm test:browser:ci
pnpm test:composition
pnpm test:compatibility
```

`pnpm benchmark:scans` builds an isolated 500-story catalog and compares concurrency 1, 2, and 4. It runs three fresh-context and three warm-cache scans for both local and composed catalogs, checks cancellation and Canvas isolation, and records duration, incomplete stories, per-story classifications, bridge payload volume, peak iframe count, and result-copying/aggregation timings. The benchmark uses ports 6160–6162. Raw results stay in the printed workspace under `node_modules/.cache`. Set `EXTERNALSSS_BENCH_OUTPUT` to choose another output path. `EXTERNALSSS_BENCH_STORIES` and `EXTERNALSSS_BENCH_REPETITIONS` support shorter smoke runs, which cannot select a parallel default.

Two becomes the recommended default only if all four cohorts improve median duration by at least 20%, sequential runs agree, and parallel scans add no incomplete stories or classification differences. Cancellation and Canvas checks must pass. Concurrency four remains configurable.

The [500-story benchmark results](scripts/benchmark-results.json) from October 13, 2026 passed that gate, so the default is two. All 36 scans had the same 50 intentional render errors and no classification differences against their respective sequential baselines. Cancellation, Canvas globals/selection, message isolation, and iframe cleanup passed at every limit. These are local headless Chromium results on an Apple M2 Max; other workloads can differ.

| Catalog / cache | One worker | Two workers | Four workers | Two-worker improvement |
| --- | ---: | ---: | ---: | ---: |
| Local / fresh | 266.2 s | 140.3 s | 75.3 s | 47.3% |
| Local / warm | 266.2 s | 140.1 s | 73.7 s | 47.4% |
| Composed / fresh | 262.1 s | 136.0 s | 70.1 s | 48.1% |
| Composed / warm | 261.4 s | 135.8 s | 69.5 s | 48.0% |

Composed scans exchanged about 0.60–0.62 MB of serialized bridge payloads per run. The existing incremental transport remains in place. A separate synthetic benchmark of the copying and aggregation helpers measured medians of 8.1 ms and 27.9 ms across all 500 result updates; those numbers exclude browser rendering and observation time. The benchmark reports a recommendation and does not change addon options.

`test:browser` expects the demo at `http://127.0.0.1:6100/`. Start it with `pnpm exec storybook dev -p 6100 --ci --no-open`, or set `EXTERNALSSS_STORYBOOK_URL` to another URL. `EXTERNALSSS_TEST_MODE=full` runs only the full-scan browser case, which is useful for a static build served under a subpath.

`test:browser:ci` starts the demo on port 6100, runs the complete browser suite at concurrency 1, 2, and 4, and stops the server. `test:composition` checks those same limits. Set `EXTERNALSSS_TEST_CONCURRENCY` to 1, 2, or 4 to run a single limit. CI runs these alongside compatibility checks. `check:complexity` enforces a maximum cyclomatic complexity of 10 for all production TypeScript, including demo stories.

`test:composition` checks bridge trust, message validation, connection failures, and independent reports for catalogs with identical story IDs. It uses the built demo and port 6150.

`test:compatibility` builds the demo and uses port 6150 for the composition host. It packs the addon and installs it in temporary Storybook 9 and 10 projects. It covers React 18, React 19, Vue without React, Vite, and Webpack in development and static builds. The checks include composed catalogs, cancellation, retries, hosting subpaths, and custom preview URLs. Set `EXTERNALSSS_COMPAT_CASE` to a case name from `scripts/compatibility-test.mjs` to run one combination. CI runs each combination separately.

## Releasing

Use Conventional Commit titles for pull requests and squash-merge them so the title becomes the commit on `main`. Use `feat:` for a feature, `fix:` or `perf:` for a patch, and `!` after the type or scope for a breaking change. Documentation, tests, and maintenance changes do not publish a package by themselves. Before 1.0, features and breaking changes bump the minor version; fixes and performance improvements bump the patch version.

Release Please opens a version and changelog pull request after a qualifying commit reaches `main`. Review and merge that pull request to create the GitHub release and `v*` tag. The tag triggers the [npm publishing workflow](.github/workflows/publish.yml), which builds and tests the package, then publishes through npm trusted publishing without an npm token.

The release workflow uses a GitHub App installed only on this repository. Its numeric App ID is stored in the `RELEASE_APP_ID` repository variable and its private key in the `RELEASE_APP_PRIVATE_KEY` repository secret. The app needs metadata read and contents, pull requests, and issues write permissions.

If publishing fails, check whether that exact version already exists on npm before rerunning the tag workflow. npm versions cannot be published twice.
