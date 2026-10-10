# Externalsss

Externalsss is an addon for Storybook 10.6.1 and later 10.x releases. It checks local stories for resources that could make visual tests inconsistent. Open the **Externalsss** panel and choose **Run scan**. The addon visits each story in a hidden preview, leaving your selected story and visible Canvas in place.

The scan reports four kinds of findings:

- **Load failure:** An image completed without usable pixels, a resource element emitted a load error, or a font face reported an error.
- **External dependency:** An observed HTTP(S) resource came from another origin. It may affect stability, but the scan does not assume it failed.
- **Font timing:** A font was loading when Storybook signaled render, became available afterward, or was still loading when observation ended.
- **Review for mocking:** A fetch or XHR call was observed, including calls to the same origin. The scan cannot tell whether it is already mocked.

A resource can have more than one label, so category counts can overlap. Each count covers distinct resources in that category. Use the filters to see a category or the incomplete stories. Expand a result for the affected stories, full URL, and a suggested next step. Collapsed results hide query values.

When a scan finishes or stops, choose **Download JSON** to save the report. It includes findings, affected stories, category counts, and a status for every story. Unvisited stories are marked `not-scanned`, so a cancelled or interrupted scan stays partial. The download omits resource URL query values and fragments. Check story names and resource paths before sharing it.

## Try the demo

Use Node.js 24.12 or newer. This checkout uses pnpm 10.22.

```sh
pnpm install
pnpm build
pnpm storybook
```

Open Storybook, select a demo story, and open **Externalsss**. The demo has local and broken images, external requests, fetch and XHR, successful and failed fonts, a late font, and a render error. Its external requests use `example.invalid` on purpose, including a remote asset that fails and receives more than one label.

## Install in another Storybook

In a Storybook project using version 10.6.1 or a later 10.x release, install the addon:

```sh
pnpm add -D storybook-addon-externalsss
```

Add the package to `.storybook/main.ts`:

```ts
export default {
  addons: ['storybook-addon-externalsss'],
};
```

You do not need a preview import or addon options. The addon requires React 18.2 or 19 for its manager panel; install that peer if your package manager does not do so automatically.

## What the scan can and cannot see

The scan covers `story` entries in the current Storybook index and skips composed external catalogs. It reads browser Resource Timing entries and records fetch/XHR calls made after instrumentation starts. Resource Timing is not a complete network trace, and cross-origin response details may be unavailable. An unknown response status is not treated as a failure.

Each story gets up to 15 seconds. After Storybook finishes rendering, the scan waits for images, fonts, stylesheets, and scripts to settle and then for 500 ms without activity. A timeout, render error, cancellation, unsupported browser API, or resource buffer limit leaves the story marked incomplete. Activity after the observation window may be missed. The scan uses the current Storybook globals and default story args.

Results stay in the browser tab until you download a JSON file. The addon does not send reports to a service, save them automatically, or change requests. It does not lint CSS font declarations or create mocks.

## Checks

```sh
pnpm check
pnpm test
pnpm build
pnpm build-storybook
pnpm exec playwright install chromium
pnpm test:browser
```

`test:browser` expects the demo at `http://127.0.0.1:6100/`. Start it with `pnpm exec storybook dev -p 6100 --ci --no-open`, or set `EXTERNALSSS_STORYBOOK_URL` to another URL. `EXTERNALSSS_TEST_MODE=full` runs only the full-scan browser case, which is useful for a static build served under a subpath.

See [the exercise prospectus](docs/prospectus.md) for the problem and the deliberate scope cut.

## Releasing

Use Conventional Commit titles for pull requests and squash-merge them so the title becomes the commit on `main`. Use `feat:` for a feature, `fix:` or `perf:` for a patch, and `!` after the type or scope for a breaking change. Documentation, tests, and maintenance changes do not publish a package by themselves. Before 1.0, features and breaking changes bump the minor version; fixes and performance improvements bump the patch version.

Release Please opens a version and changelog pull request after a qualifying commit reaches `main`. Review and merge that pull request to create the GitHub release and `v*` tag. The tag triggers the [npm publishing workflow](.github/workflows/publish.yml), which builds and tests the package, then publishes through npm trusted publishing without an npm token.

The release workflow uses a GitHub App installed only on this repository. Its numeric App ID is stored in the `RELEASE_APP_ID` repository variable and its private key in the `RELEASE_APP_PRIVATE_KEY` repository secret. The app needs metadata read and contents, pull requests, and issues write permissions.

If publishing fails, check whether that exact version already exists on npm before rerunning the tag workflow. npm versions cannot be published twice.
