# Vendored Overlay Strategy

This is a **vendored clone** of `https://github.com/PrimeIntellect-ai/prime-agent`
with local patches maintained via git-overlay branches. The vendored t3code tree
(`~/vendor/t3code/VENDOR.md`) uses the same strategy, adapted from this repo.

## FROZEN TS BASE — read this first

Upstream **ported Prime Agent to Rust** (origin/main commit `39bc99a91`,
"Port Prime Agent to Rust (#2524)"). The TypeScript tree ends at release
**v0.9.8** (`7d442aafa`), which is pinned locally as branch **`ts/main`** and is
the permanent overlay base for this repo. `origin/main` now contains only Rust
(`crates/pa-*`) and **must never be used as an overlay base** — the overlays
patch `packages/coding-agent/**`, which no longer exists there. Running
`git fetch` is fine; merging toward `origin/main` is not.

If you ever want upstream changes again, the path is porting the overlay
features to the Rust crates — not merging. pi itself (earendil-works/pi, the
upstream of this fork) is still TypeScript, but it intentionally lacks the
RLM/goal/autonomous machinery this fork adds, so rebasing onto pi is not an
option either.

## Branch Structure

```
origin/main              ← upstream (Rust now; never commit here, never merge)
ts/main                  ← pinned TS base (v0.9.8, 7d442aafa; overlay base)
├── overlay/tooling
├── overlay/bash-timeout-heartbeat
├── overlay/daemon-event-stream-backpressure
├── overlay/autonomous-events
├── overlay/reload-command
└── local                ← integration branch (merge commits ONLY)
```

**Rule #1: Never commit directly to `main` or `local`.** `local` is rebuilt from
scratch on every `mise run rebuild-local` (`git reset --hard ts/main`, then
merge every `overlay/*` branch) — any direct commit there is destroyed on the
next rebuild. All real work lives on `overlay/*` branches.

**Rule #2: One concern per overlay.** Don't mix unrelated changes.

**Rule #3: Overlay branches are independent topics**, each synced onto
`ts/main` itself — never stacked on each other. rerere remembers conflict
resolutions between rebuilds.

## Creating a New Overlay

```bash
# 1. Create branch from ts/main
git checkout -b overlay/my-feature ts/main

# 2. Make changes, commit (see "Critical Git Rules" below — only your files)
git add <specific-files-only>
git commit -m "fix(scope): description"

# 3. Overlay onto ts/main (creates the standard merge commit)
bash ~/code/git-overlay/git-overlay ts/main overlay/my-feature

# 4. Build and promote to the runtime
mise run update
```

`mise run sync` re-overlays every `overlay/*` branch onto ts/main and returns
to the original branch. `mise run rebuild-local` resets `local` to ts/main and
re-merges all overlays; it deliberately ends on `local`.

## Mise Tasks

| Task                     | Purpose                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `mise run sync`          | Re-overlay every `overlay/*` branch onto ts/main                     |
| `mise run rebuild-local` | Reset `local` to ts/main, re-merge all `overlay/*` branches          |
| `mise run build`         | Build all packages (TypeScript + bundle)                           |
| `mise run smoke-test`    | Boot-check the bundle (`cli.js --version`)                         |
| `mise run swap`          | Promote the build to `~/.prime/agent/dist/current` (current→bak)   |
| `mise run swap-back`     | Restore the previous build from bak                                |
| `mise run setup-stable`  | Pin current bak as the stable fallback tier                        |
| `mise run update`        | rebuild-local + build + smoke-test + swap                          |
| `mise run upgrade`       | sync + rebuild-local + build + smoke-test + swap                   |
| `mise run dev`           | Run from source via tsx (`prime-agent.sh`)                         |
| `mise run run-dist`      | Run from the vendor tree's bundled build                           |
| `mise run check`         | Full check suite — required after code changes (see Commands)      |

Tasks chain sequentially inside `update`/`upgrade` — do not convert them to mise
`depends`, which runs tasks in parallel and races the git operations.

## Runtime (~/.prime/agent)

The installed runtime lives outside the vendor dir and survives
`rm -rf ~/vendor/prime-agent`:

```
~/.prime/agent/
  bin/prime-agent    <- runner on PATH (tier walk: current -> bak -> stable,
                        falls back to vendor source via tsx)
  dist/current/      <- active build (bundle/cli.js + package.json + node_modules)
  dist/bak/          <- previous build (auto-created by swap)
  dist/stable/       <- pinned known-good (setup-stable)
```

Daily flow: `mise run upgrade` refreshes the runtime; `bin/prime-agent` execs the
first healthy tier. Fallback: `mise run swap-back` (bak to current), or re-run
`mise run setup-stable` from a known-good bak.

The git-overlay tool lives at `~/code/git-overlay/git-overlay` (also installed as
`git overlay`).

# Development Rules

## Conversational Style

- No fluff or cheerful filler text
- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- Technical prose only, be kind but direct (e.g., "Thanks @user" not "Thanks so much @user!")

## Code Quality

- Read files in full before making wide-ranging changes, before editing files you have not already fully inspected, and when the user asks you to investigate or audit something. Do not rely only on search snippets for broad changes.
- Don't be too verbose with comments in the code. Only write comments when there is serious ambiguity
- No `any` types unless absolutely necessary
- Check node_modules for external API type definitions instead of guessing
- **NEVER use inline imports** - no `await import("./foo.js")`, no `import("pkg").Type` in type positions, no dynamic imports for types. Always use standard top-level imports.
- NEVER remove or downgrade code to fix type errors from outdated dependencies; upgrade the dependency instead
- Always ask before removing functionality or code that appears to be intentional
- Do not preserve backward compatibility unless the user explicitly asks for it
- Never hardcode key checks with, eg. `matchesKey(keyData, "ctrl+x")`. All keybindings must be configurable. Add default to matching object (`DEFAULT_EDITOR_KEYBINDINGS` or `DEFAULT_APP_KEYBINDINGS`)
- NEVER modify `packages/ai/src/models.generated.ts` directly. Update `packages/ai/scripts/generate-models.ts` instead.

## Commands

- After code changes (not documentation changes): `npm run check` (get full output, no tail). Fix all errors, warnings, and infos before committing.
- Note: `npm run check` does not run tests.
- NEVER run: `npm run dev`, `npm run build`, `npm test`
- Only run specific tests if user instructs: `npx tsx ../../node_modules/vitest/dist/cli.js --run test/specific.test.ts`
- Run tests from the package root, not the repo root.
- If you create or modify a test file, you MUST run that test file and iterate until it passes.
- When writing tests, run them, identify issues in either the test or implementation, and iterate until fixed.
- For `packages/coding-agent/test/suite/`, use `test/suite/harness.ts` plus the faux provider. Do not use real provider APIs, real API keys, or paid tokens.
- Put issue-specific regressions under `packages/coding-agent/test/suite/regressions/` and name them `<issue-number>-<short-slug>.test.ts`.

## Daemon Protocol Changes

- Classify every daemon command, event, and response-shape change as backward-compatible, capability-gated, or incompatible.
- Add optional features behind a negotiated server capability. Clients must check the capability before sending the command or depending on the event.
- Bump `DAEMON_PROTOCOL_VERSION` for incompatible changes or when startup begins requiring behavior an older daemon cannot provide.
- Update `DAEMON_SCHEMA_REVISION`, the command/event compatibility maps, and both new-client/old-daemon and old-client/new-daemon tests for every wire change.
- Optional daemon metadata and UI features must degrade locally. They must not prevent the agent, session attachment, or interactive startup from working.
- Never make a new daemon command part of startup without a protocol or capability gate.

## Dependencies

- A 7-day minimum release age applies to all dependency updates: `.npmrc` sets `min-release-age=7` and `.github/dependabot.yml` uses a matching `cooldown`. Never bypass it for routine updates.
- Enforcement requires npm >= 11.10; older npm silently ignores the setting, so use a current npm when updating dependencies.
- For an urgent security patch younger than 7 days, override explicitly: `npm install --min-release-age=0 <pkg>`.

## GitHub Workflow

When creating issues:

- Add `pkg:*` labels to indicate which package(s) the issue affects
  - Available labels: `pkg:agent`, `pkg:ai`, `pkg:coding-agent`, `pkg:tui`
- If an issue spans multiple packages, add all relevant labels

When posting issue/PR comments:

- Write the full comment to a temp file and use `gh issue comment --body-file` or `gh pr comment --body-file`
- Never pass multi-line markdown directly via `--body` in shell commands
- Preview the exact comment text before posting
- Post exactly one final comment unless the user explicitly asks for multiple comments
- If a comment is malformed, delete it immediately, then post one corrected comment
- Keep comments concise, technical, and in the user's tone

When closing issues via commit:

- Include `fixes #<number>` or `closes #<number>` in the commit message
- This automatically closes the issue when the commit is merged

## PR Workflow

- Analyze PRs without pulling locally first
- If the user approves: create a feature branch, pull PR, rebase on main, apply adjustments, commit, merge into main, push, close PR, and leave a comment in the user's tone
- We work in feature branches until everything is according to the user's requirements. Never merge PRs by yourself.

## Testing Prime Agent Interactive Mode with tmux

To test Prime Agent's TUI in a controlled terminal environment:

```bash
# Create tmux session with specific dimensions
tmux new-session -d -s prime-agent-test -x 80 -y 24

# Start Prime Agent from source
tmux send-keys -t prime-agent-test "cd /Users/kevin/pi/prime-agent && ./prime-agent.sh" Enter

# Wait for startup, then capture output
sleep 3 && tmux capture-pane -t prime-agent-test -p

# Send input
tmux send-keys -t prime-agent-test "your prompt here" Enter

# Send special keys
tmux send-keys -t prime-agent-test Escape
tmux send-keys -t prime-agent-test C-o  # ctrl+o

# Cleanup
tmux kill-session -t prime-agent-test
```

You, yourself, are often running into a tmux session, so be careful when killing tmux sessions. Lots of other processes can be running on different tmux sessions/

## Changelog

Location: `packages/<pkg>/.changes/<slug>.md` (one fragment file per PR per touched package)

### Format

Do NOT edit `packages/*/CHANGELOG.md` directly. Instead, add a fragment file `packages/<pkg>/.changes/<slug>.md` (slug = kebab-case, branch- or ticket-derived, e.g. `eng-1234-fix-resize.md`) containing exactly the bullet line(s) for the change. Bullets are plain `- ...` lines with no `### Added` / `### Changed` / `### Fixed` / `### Removed` subsections — one bullet per change, written as a short sentence starting with a past-tense verb (Added, Changed, Fixed, Removed). Keep each bullet to one line; describe the user-visible change, not the implementation. The release script folds fragments into the release section of CHANGELOG.md and deletes them.

Example fragment (`packages/coding-agent/.changes/eng-1234-effort-command.md`):

```markdown
- Added `/effort` to set the reasoning level, with autocomplete for the levels the current model supports.
```

### Rules

- One fragment file per PR per touched package; a fragment may contain multiple bullets
- NEVER modify already-released version sections in CHANGELOG.md (e.g., `## [0.2.1]`) — each is immutable once released
- Purely internal changes may opt out via the `no-changelog` PR label

### Attribution

- **Internal changes (from issues)**: `Fixed foo bar ([#123](https://github.com/PrimeIntellect-ai/prime-agent/issues/123))`
- **External contributions**: `Added feature X ([#456](https://github.com/PrimeIntellect-ai/prime-agent/pull/456) by [@username](https://github.com/username))`

## Adding a New LLM Provider (packages/ai)

Adding a new provider requires changes across multiple files:

### 1. Core Types (`packages/ai/src/types.ts`)

- Add API identifier to `Api` type union (e.g., `"bedrock-converse-stream"`)
- Create options interface extending `StreamOptions`
- Add mapping to `ApiOptionsMap`
- Add provider name to `KnownProvider` type union

### 2. Provider Implementation (`packages/ai/src/providers/`)

Create provider file exporting:

- `stream<Provider>()` function returning `AssistantMessageEventStream`
- `streamSimple<Provider>()` for `SimpleStreamOptions` mapping
- Provider-specific options interface
- Message/tool conversion functions
- Response parsing emitting standardized events (`text`, `tool_call`, `thinking`, `usage`, `stop`)

### 3. Provider Exports and Lazy Registration

- Add a package subpath export in `packages/ai/package.json` pointing at `./dist/providers/<provider>.js`
- Add `export type` re-exports in `packages/ai/src/index.ts` for provider option types that should remain available from the root entry
- Register the provider in `packages/ai/src/providers/register-builtins.ts` via lazy loader wrappers, do not statically import provider implementation modules there
- Add credential detection in `packages/ai/src/env-api-keys.ts`

### 4. Model Generation (`packages/ai/scripts/generate-models.ts`)

- Add logic to fetch/parse models from provider source
- Map to standardized `Model` interface

### 5. Tests (`packages/ai/test/`)

- Always add the provider to `stream.test.ts` with at least one representative model, even if it reuses an existing API implementation such as `openai-completions`.
- Add the provider to the broader provider matrix where applicable: `tokens.test.ts`, `abort.test.ts`, `empty.test.ts`, `context-overflow.test.ts`, `image-limits.test.ts`, `unicode-surrogate.test.ts`, `tool-call-without-result.test.ts`, `image-tool-result.test.ts`, `total-tokens.test.ts`, `cross-provider-handoff.test.ts`.
- For `cross-provider-handoff.test.ts`, add at least one provider/model pair. If the provider exposes multiple model families (for example GPT and Claude), add at least one pair per family.
- For non-standard auth, create utility (e.g., `bedrock-utils.ts`) with credential detection.

### 6. Coding Agent (`packages/coding-agent/`)

- `src/core/model-resolver.ts`: Add default model ID to `defaultModelPerProvider`
- `src/core/provider-display-names.ts`: Add API-key login display name so `/login` and related UI show the provider for built-in API-key auth.
- `src/cli/args.ts`: Add env var documentation
- `README.md`: Add provider setup instructions
- `docs/providers.md`: Add setup instructions, env var, and `auth.json` key

### 7. Documentation

- `packages/ai/README.md`: Add to providers table, document options/auth, add env vars
- `packages/ai/.changes/<slug>.md`: Add a changelog fragment (see Changelog above)

## Releasing

**Lockstep versioning**: All packages always share the same version number. Every release updates all packages together.

**Version semantics** (no major releases):

- `patch`: Bug fixes and new features
- `minor`: API breaking changes

### Steps

1. **Check fragments**: Ensure all changes since last release have fragment files in `packages/<pkg>/.changes/`

2. **Run release script**:
   ```bash
   npm run release:patch    # Fixes and additions
   npm run release:minor    # API breaking changes
   ```

The script handles: version bump, folding `.changes/` fragments into the release section, commit, tag, and publish.

## **CRITICAL** Git Rules for Parallel Agents **CRITICAL**

Multiple agents may work on different files in the same worktree simultaneously. You MUST follow these rules:

### Committing

- **ONLY commit files YOU changed in THIS session**
- ALWAYS include `fixes #<number>` or `closes #<number>` in the commit message when there is a related issue or PR
- NEVER use `git add -A` or `git add .` - these sweep up changes from other agents
- ALWAYS use `git add <specific-file-paths>` listing only files you modified
- Before committing, run `git status` and verify you are only staging YOUR files
- Track which files you created/modified/deleted during the session
- It is always fine to include `packages/ai/src/models.generated.ts` in a commit alongside the actual files you want to commit

### Forbidden Git Operations

These commands can destroy other agents' work:

- `git reset --hard` - destroys uncommitted changes
- `git checkout .` - destroys uncommitted changes
- `git clean -fd` - deletes untracked files
- `git stash` - stashes ALL changes including other agents' work
- `git add -A` / `git add .` - stages other agents' uncommitted work
- `git commit --no-verify` - bypasses required checks and is never allowed

### Safe Workflow

```bash
# 1. Check status first
git status

# 2. Add ONLY your specific files
git add packages/ai/src/providers/transform-messages.ts
git add packages/ai/.changes/eng-1234-fix-resize.md

# 3. Commit
git commit -m "fix(ai): description"

# 4. Push (pull --rebase if needed, but NEVER reset/checkout)
git pull --rebase && git push
```

### If Rebase Conflicts Occur

- Resolve conflicts in YOUR files only
- If conflict is in a file you didn't modify, abort and ask the user
- NEVER force push

### User override

If the user instructions conflict with rules set out here, ask for confirmation that they want to override the rules. Only then execute their instructions.
