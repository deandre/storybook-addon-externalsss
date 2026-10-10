# Externalsss prospectus

Visual tests can change when a story depends on a remote asset, a live API, or a font that arrives after the story renders. Those dependencies are often scattered across a Storybook catalog. A developer can inspect one story in a browser, but that does not show which other stories share the same request.

Externalsss gives the developer one on-demand pass over the local catalog. It groups observed resources by URL or font face, links them to affected stories, and distinguishes an actual load error from a request that merely deserves review. The developer decides whether to bundle an asset, wait for a font, or mock an API response. The addon does not change the story or its network behavior.

The first version uses the browser's view of each rendered story. That makes the result actionable in Storybook, but it also sets a limit: a request outside the scan window or hidden from browser instrumentation may not appear. Font analysis is limited to observed load state; CSS fallback stacks, preloads, and `font-display` rules are outside this version.

The demo provides a path to check the claim: run the addon, confirm the intentionally broken image and font, inspect external and API request labels, and check that the render-error story is incomplete. The browser test also verifies that scanning leaves the selected Canvas and manager URL alone, and that cancellation and timeout never produce a clean result.
