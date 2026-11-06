#!/usr/bin/env bash
# Generator for the prime-agent runtime environment outside the vendor dir.
# Creates ~/.prime/agent/ with tiered dist/ (current/bak/stable) and per-tier
# pnpm-managed node_modules.
#
# Architecture:
#   ~/.prime/agent/bin/prime-agent     ← runner (on PATH)
#   ~/.prime/agent/dist/current/       ← active build
#     package.json                     ← project root
#     dist/                            ← copied from vendor packages/coding-agent/dist/
#       bundle/
#       modes/
#       assets/
#       skills/
#       prime-agent-runtime/
#     node_modules/                    ← pnpm-managed externals
#   ~/.prime/agent/dist/bak/           ← previous build
#   ~/.prime/agent/dist/stable/        ← pinned known-good
#
# Usage: bash scripts/generate-runtime.sh

set -euo pipefail

VENDOR_DIR="${VENDOR_DIR:-$HOME/vendor/prime-agent}"
RUNTIME_DIR="${RUNTIME_DIR:-$HOME/.prime/agent}"
BIN_DIR="$RUNTIME_DIR/bin"
DIST_DIR="$RUNTIME_DIR/dist"
VENDOR_DIST="$VENDOR_DIR/packages/coding-agent/dist"

echo "=== Prime Agent Runtime Generator ==="
echo "Vendor:  $VENDOR_DIR"
echo "Runtime: $RUNTIME_DIR"
echo ""

# Verify dist output exists
if [[ ! -d "$VENDOR_DIST/bundle" ]]; then
  echo "ERROR: Bundle not found at $VENDOR_DIST/bundle"
  echo "Run 'mise run build' first."
  exit 1
fi

# Create directories
mkdir -p "$BIN_DIR" "$DIST_DIR"/{current,bak,stable}

# --- Generate runtime mise.toml (self-contained pnpm) ---
cat > "$RUNTIME_DIR/.mise.toml" << 'MISE_EOF'
[tools]
pnpm = "latest"
MISE_EOF
echo "Generated: $RUNTIME_DIR/.mise.toml"

# --- Generate runner script ---
cat > "$BIN_DIR/prime-agent" << 'RUNNER_EOF'
#!/usr/bin/env bash
# Prime Agent runtime runner
# Tries dist tiers: current → bak → stable
# Falls back to vendor source build if no runtime tiers exist.
# Each tier resolves its own node_modules relative to cli.js.

set -euo pipefail

RUNTIME_DIR="${HOME}/.prime/agent"
DIST_DIR="$RUNTIME_DIR/dist"
VENDOR_DIR="${HOME}/vendor/prime-agent"

# Find the first available tier
tier=""
for t in current bak stable; do
  if [[ -f "$DIST_DIR/$t/dist/bundle/cli.js" ]]; then
    tier="$t"
    break
  fi
done

if [[ -n "$tier" ]]; then
  exec node "$DIST_DIR/$tier/dist/bundle/cli.js" "$@"
fi

# Fallback: vendor source (dev mode via tsx)
TSX_BIN="$VENDOR_DIR/node_modules/.bin/tsx"
if [[ -x "$TSX_BIN" ]]; then
  echo "WARNING: No runtime bundle found. Falling back to vendor source mode." >&2
  exec "$TSX_BIN" "$VENDOR_DIR/packages/coding-agent/src/cli.ts" "$@"
fi

echo "ERROR: No runtime bundle found and vendor source is unavailable." >&2
echo "Run 'mise run build && mise run swap' from the vendor directory." >&2
exit 1
RUNNER_EOF

chmod +x "$BIN_DIR/prime-agent"
echo "Generated: $BIN_DIR/prime-agent"

# --- Generate runtime AGENTS.md ---
cat > "$RUNTIME_DIR/AGENTS.md" << 'AGENTS_EOF'
# Prime Agent Runtime

This is the self-contained runtime for Prime Agent. It is separate from the
vendored source directory (`~/vendor/prime-agent/`) and survives even if that
directory is deleted.

## Structure

```
~/.prime/agent/
  bin/prime-agent         ← Runner on PATH
  dist/current/           ← Active build
    dist/bundle/cli.js    ← Entry point
    dist/modes/           ← Themes, assets, skills
    node_modules/         ← pnpm-managed externals (per-tier)
    package.json          ← Exact dependency versions
  dist/bak/               ← Previous build (rollback target)
  dist/stable/            ← Pinned known-good (manual setup)
  models.json             ← Custom providers
  auth.json               ← API keys (if using /login)
```

## Tier Fallback

The runner (`bin/prime-agent`) tries tiers in order:
1. `current/` — active build
2. `bak/` — previous build (auto-created on swap)
3. `stable/` — pinned known-good (manual via `mise run setup-stable`)
4. Vendor source fallback (if vendor dir exists)

## Recovery

If a build breaks and `prime-agent` won't start:

```bash
# Option 1: Rollback to previous build
cd ~/vendor/prime-agent
mise run swap-back

# Option 2: If vendor source is still working, rebuild
cd ~/vendor/prime-agent
mise run build
mise run smoke-test
mise run swap

# Option 3: Manual tier management
rm -rf ~/.prime/agent/dist/current
mv ~/.prime/agent/dist/bak ~/.prime/agent/dist/current
```

## Regenerating from Vendor

If you need to recreate this runtime from the vendor source:

```bash
cd ~/vendor/prime-agent
mise run build
bash scripts/generate-runtime.sh
```

Or after initial setup, use `mise run swap` to update.

## pnpm

Each tier has its own `node_modules` managed by pnpm. The actual package content
is stored in the global pnpm store (`~/Library/pnpm/store/`), so each tier's
`node_modules` is mostly symlinks (~5-10MB per tier).

To inspect or repair a tier's dependencies:

```bash
cd ~/.prime/agent/dist/current
mise exec -- pnpm install        # reinstall
mise exec -- pnpm rebuild        # rebuild native addons
```
AGENTS_EOF
echo "Generated: $RUNTIME_DIR/AGENTS.md"

# --- Helper: copy full dist + generate package.json + pnpm install ---
setup_tier() {
  local target="$1"
  echo "Setting up tier: $target"
  rm -rf "$target"/*

  # Copy vendor dist/ into tier's dist/ subdirectory
  mkdir -p "$target/dist"
  cp -r "$VENDOR_DIST"/* "$target/dist/"

  # Generate package.json at tier root
  node "$VENDOR_DIR/scripts/generate-runtime-package-json.cjs" \
    "$VENDOR_DIR/package-lock.json" \
    "$target/package.json"

  # Install externals via pnpm (ignore scripts initially, rebuild after approval)
  cd "$target" && mise exec -- pnpm install --ignore-scripts

  # Approve and run native builds
  cd "$target" && mise exec -- pnpm approve-builds koffi zeromq >/dev/null 2>&1 || true
  cd "$target" && mise exec -- pnpm rebuild koffi zeromq >/dev/null 2>&1 || true

  echo "  → $target ready ($(du -sh "$target" | cut -f1))"
}

# If current is empty, populate it from the vendor build
if [[ ! -f "$DIST_DIR/current/dist/bundle/cli.js" ]]; then
  setup_tier "$DIST_DIR/current"
fi

echo ""
echo "=== Done ==="
echo "Add to PATH: export PATH=\"$BIN_DIR:\$PATH\""
echo ""
echo "Tiers:"
for t in current bak stable; do
  if [[ -f "$DIST_DIR/$t/dist/bundle/cli.js" ]]; then
    echo "  $t: $(du -sh "$DIST_DIR/$t" | cut -f1) ✓"
  else
    echo "  $t: empty"
  fi
done
