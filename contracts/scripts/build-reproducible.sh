#!/usr/bin/env bash
# contracts/scripts/build-reproducible.sh
#
# Reproducible WASM build for guardians
# ──────────────────────────────────────
# This script lets any guardian independently verify that the WASM hashes in
# build-manifest.json match the source at a given commit.
#
# USAGE
#   # From the repo root — reproduce the build for the current working tree:
#   bash contracts/scripts/build-reproducible.sh
#
#   # Verify against a specific tagged release (checks out the tag first):
#   bash contracts/scripts/build-reproducible.sh v1.2.3
#
# REQUIREMENTS
#   - rustup  (https://rustup.rs)
#   - git
#   - sha256sum (coreutils; on macOS use `brew install coreutils`)
#
# The script installs the pinned toolchain from contracts/rust-toolchain.toml
# automatically via rustup.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTRACTS_DIR="$REPO_ROOT/contracts"
TAG="${1:-}"

# ── Optional: check out a specific tag ──────────────────────────────────────
if [ -n "$TAG" ]; then
  echo "==> Checking out tag: $TAG"
  git -C "$REPO_ROOT" fetch --tags
  git -C "$REPO_ROOT" checkout "tags/$TAG"
fi

# ── Print environment ────────────────────────────────────────────────────────
echo ""
echo "==> Build environment"
echo "  Repo root : $REPO_ROOT"
echo "  Commit    : $(git -C "$REPO_ROOT" rev-parse HEAD)"
echo "  Toolchain : $(grep 'channel' "$CONTRACTS_DIR/rust-toolchain.toml" | sed 's/.*= *"\(.*\)"/\1/')"
echo ""

# ── Ensure the pinned toolchain is installed ────────────────────────────────
# rustup reads rust-toolchain.toml automatically when we cd into contracts/
pushd "$CONTRACTS_DIR" > /dev/null
echo "==> Installing pinned toolchain (rustup reads rust-toolchain.toml) ..."
rustup show active-toolchain || rustup toolchain install
echo ""

# ── Clean previous WASM output ──────────────────────────────────────────────
echo "==> Cleaning previous WASM output ..."
rm -f target/wasm32-unknown-unknown/release/*.wasm

# ── Build ────────────────────────────────────────────────────────────────────
echo "==> Building contracts (release, locked) ..."
cargo build --target wasm32-unknown-unknown --release --locked
echo ""

# ── Compute hashes ───────────────────────────────────────────────────────────
WASM_DIR="target/wasm32-unknown-unknown/release"
HASH_FILE="$CONTRACTS_DIR/local-wasm-hashes.txt"

echo "==> SHA-256 hashes of produced WASM files:"
echo ""
> "$HASH_FILE"
for f in "$WASM_DIR"/*.wasm; do
  name=$(basename "$f")
  hash=$(sha256sum "$f" | awk '{print $1}')
  echo "  ${hash}  ${name}" | tee -a "$HASH_FILE"
done
echo ""
echo "Hashes saved to: $HASH_FILE"

# ── Compare against build-manifest.json (if populated) ───────────────────────
MANIFEST="$CONTRACTS_DIR/build-manifest.json"
if command -v jq &>/dev/null && [ -f "$MANIFEST" ]; then
  manifest_commit=$(jq -r '.commit // empty' "$MANIFEST")
  if [ -n "$manifest_commit" ]; then
    echo ""
    echo "==> Comparing against build-manifest.json (commit: ${manifest_commit}) ..."
    mismatch=0
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      local_hash=$(echo "$line" | awk '{print $1}')
      wasm_file=$(echo  "$line" | awk '{print $2}')
      contract=$(echo "$wasm_file" | sed 's/\.wasm$//')
      manifest_hash=$(jq -r \
        --arg c "$contract" \
        '.contracts[] | select(.contract == $c) | .sha256' \
        "$MANIFEST" || true)
      if [ -z "$manifest_hash" ]; then
        echo "  SKIP (not in manifest): $wasm_file"
      elif [ "$local_hash" = "$manifest_hash" ]; then
        echo "  OK  : $wasm_file"
      else
        echo "  FAIL: $wasm_file"
        echo "        local   : $local_hash"
        echo "        manifest: $manifest_hash"
        mismatch=1
      fi
    done < "$HASH_FILE"

    if [ "$mismatch" -eq 1 ]; then
      echo ""
      echo "ERROR: Hash mismatch! The local build does not reproduce the published manifest."
      echo "Ensure you are on commit ${manifest_commit} and using the pinned toolchain."
      popd > /dev/null
      exit 1
    else
      echo ""
      echo "All hashes match the published build-manifest.json. ✓"
    fi
  else
    echo ""
    echo "build-manifest.json has no commit field yet (pre-release). Skipping manifest comparison."
  fi
else
  echo ""
  echo "jq not found or build-manifest.json missing — skipping manifest comparison."
fi

popd > /dev/null
echo ""
echo "Done."
