# Contributing to CutFlow

Thanks for contributing! This repo has one non-negotiable rule: **honesty about what the app can actually do.**

## Dev setup

1. Install Node.js 18+.
2. `npm install`
3. `npm run dev` — dev server at http://localhost:5173
4. `npm run test` — run the test suite (Vitest).

## Ground rules

- **`npm run test` must stay green.** All PRs run the full suite (engine, store, tools, exports — 76 tests). If you add behavior, add tests for it.
- **Honest feature labeling.** When you add, change, or break a capability, update the status board in `src/features/checklist.ts`:
  - `working` — verified end-to-end (preview + export where relevant)
  - `partial` — works with caveats; state the caveat in `note`
  - `not-possible` — document why in `note`
  Never describe a `partial` or `not-possible` feature as if it works. The checklist is rendered in-app and mirrored in the README.
- **Preview and export must match.** Changes to rendering should go through the shared engine so an exported frame is identical to the previewed frame.
- **No secrets, ever.** API keys are user-entered and stored in `localStorage` at runtime. Never hardcode keys, tokens, or personal paths in source or config.
- **Local-first stays local.** New features must not require a backend or upload user media off-device. Network fetches are limited to optional things like model downloads and stock search.

## PR guidelines

1. Fork / create a branch.
2. Keep diffs focused — one feature or fix per PR.
3. Ensure `npm run test` and `npm run build` (includes `tsc -b`) both pass.
4. Update the checklist in `src/features/checklist.ts` if behavior changed.
5. In the PR description, state what's working, what's partial, and any browser caveats.
