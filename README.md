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

## Try the demo

Use Node.js 24.12 or newer. This checkout uses pnpm 10.22.

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

Include the port for development origins, such as `http://localhost:6006`. Wildcards, paths, query strings, and fragments are not accepted. Remote access is denied unless the origin is listed; URL parameters cannot grant access. Deploy the updated referenced Storybook before scanning it from the host.

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
pnpm test
pnpm build
pnpm build-storybook
pnpm exec playwright install chromium
pnpm test:browser
pnpm test:composition
pnpm test:compatibility
```

`test:browser` expects the demo at `http://127.0.0.1:6100/`. Start it with `pnpm exec storybook dev -p 6100 --ci --no-open`, or set `EXTERNALSSS_STORYBOOK_URL` to another URL. `EXTERNALSSS_TEST_MODE=full` runs only the full-scan browser case, which is useful for a static build served under a subpath.

`test:composition` checks bridge trust, message validation, connection failures, and independent reports for catalogs with identical story IDs. It uses the built demo and port 6150.

`test:compatibility` builds the demo and uses port 6150 for the composition host. It packs the addon and installs it in temporary Storybook 9 and 10 projects. It covers React 18, React 19, Vue without React, Vite, and Webpack in development and static builds. The checks include composed catalogs, cancellation, retries, hosting subpaths, and custom preview URLs. Set `EXTERNALSSS_COMPAT_CASE` to a case name from `scripts/compatibility-test.mjs` to run one combination. CI runs each combination separately.

## Releasing

Use Conventional Commit titles for pull requests and squash-merge them so the title becomes the commit on `main`. Use `feat:` for a feature, `fix:` or `perf:` for a patch, and `!` after the type or scope for a breaking change. Documentation, tests, and maintenance changes do not publish a package by themselves. Before 1.0, features and breaking changes bump the minor version; fixes and performance improvements bump the patch version.

Release Please opens a version and changelog pull request after a qualifying commit reaches `main`. Review and merge that pull request to create the GitHub release and `v*` tag. The tag triggers the [npm publishing workflow](.github/workflows/publish.yml), which builds and tests the package, then publishes through npm trusted publishing without an npm token.

The release workflow uses a GitHub App installed only on this repository. Its numeric App ID is stored in the `RELEASE_APP_ID` repository variable and its private key in the `RELEASE_APP_PRIVATE_KEY` repository secret. The app needs metadata read and contents, pull requests, and issues write permissions.

If publishing fails, check whether that exact version already exists on npm before rerunning the tag workflow. npm versions cannot be published twice.
