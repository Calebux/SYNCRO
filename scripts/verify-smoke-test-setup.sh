#!/bin/bash

# Smoke Test Setup Verification Script
# Verifies that smoke test infrastructure is properly configured
# Run from the SYNCRO root directory: bash scripts/verify-smoke-test-setup.sh

# Note: no set -e — arithmetic increments return 1 when result is 0

# Resolve the SYNCRO root (directory containing this script's parent)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

echo "🔍 Verifying Smoke Test Setup..."
echo "   Root: $ROOT"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASSED=0
FAILED=0
WARNINGS=0

pass() { echo -e "${GREEN}✓${NC} $1"; PASSED=$((PASSED+1)); }
fail() { echo -e "${RED}✗${NC} $1"; FAILED=$((FAILED+1)); }
warn() { echo -e "${YELLOW}⚠${NC} $1"; WARNINGS=$((WARNINGS+1)); }

check_file() {
  if [ -f "$ROOT/$1" ]; then
    pass "$1 exists"
  else
    fail "$1 MISSING"
  fi
}

# ── 1. File structure ─────────────────────────────────────────────────────────
echo "📁 Checking file structure..."
check_file "backend/tests/smoke/smoke-tests.test.ts"
check_file "backend/tests/smoke/jest.smoke.config.js"
check_file "backend/tests/smoke/setup.ts"
check_file "backend/tests/smoke/README.md"
check_file "scripts/setup-smoke-test-user.ts"
check_file "docs/SMOKE_TESTS.md"
check_file "docs/SMOKE_TESTS_QUICK_REFERENCE.md"
check_file ".github/workflows/post-deploy-health-check.yml"
echo ""

# ── 2. package.json scripts ───────────────────────────────────────────────────
echo "📦 Checking backend/package.json scripts..."
PKG="$ROOT/backend/package.json"
if [ -f "$PKG" ]; then
  grep -q '"test:smoke"' "$PKG"         && pass "test:smoke script present"         || fail "test:smoke script MISSING"
  grep -q '"test:smoke:verbose"' "$PKG" && pass "test:smoke:verbose script present" || fail "test:smoke:verbose script MISSING"
  grep -q '"setup:smoke-user"' "$PKG"   && pass "setup:smoke-user script present"   || fail "setup:smoke-user script MISSING"
else
  fail "backend/package.json not found"
fi
echo ""

# ── 3. Workflow configuration ─────────────────────────────────────────────────
echo "⚙️  Checking GitHub workflow..."
WF="$ROOT/.github/workflows/post-deploy-health-check.yml"
if [ -f "$WF" ]; then
  grep -q "smoke" "$WF"                    && pass "Workflow references smoke tests"          || fail "Workflow missing smoke test step"
  grep -q "SMOKE_TEST_USER_EMAIL" "$WF"    && pass "Workflow has SMOKE_TEST_USER_EMAIL env"   || fail "Workflow missing SMOKE_TEST_USER_EMAIL"
  grep -q "workflow_dispatch" "$WF"        && pass "Workflow supports manual trigger"         || fail "Workflow missing workflow_dispatch trigger"
  grep -q "upload-artifact" "$WF"          && pass "Workflow uploads test artifacts"          || fail "Workflow missing artifact upload"
  grep -q "createComment\|createIssue\|issues.create" "$WF" \
                                           && pass "Workflow has failure notifications"       || fail "Workflow missing failure notifications"
else
  fail ".github/workflows/post-deploy-health-check.yml not found"
fi
echo ""

# ── 4. Test content checks ────────────────────────────────────────────────────
echo "🧪 Checking smoke test content..."
ST="$ROOT/backend/tests/smoke/smoke-tests.test.ts"
if [ -f "$ST" ]; then
  grep -q "Authentication"   "$ST" && pass "Authentication tests present"   || fail "Authentication tests MISSING"
  grep -q "Subscription"     "$ST" && pass "Subscription tests present"     || fail "Subscription tests MISSING"
  grep -q "Payment\|Billing\|exchange-rates\|gift-card" "$ST" \
                                   && pass "Payment/billing tests present"  || fail "Payment/billing tests MISSING"
  grep -q "signInWithPassword\|signIn" "$ST" \
                                   && pass "Login flow tested"              || fail "Login flow test MISSING"
  grep -q "/api/health\|/health"   "$ST" && pass "Health endpoint tested"   || fail "Health endpoint test MISSING"
  grep -q "401"                    "$ST" && pass "Auth enforcement tested"  || fail "Auth enforcement test MISSING"
else
  fail "smoke-tests.test.ts not found"
fi
echo ""

# ── 5. Environment variables (optional for local) ─────────────────────────────
echo "🔐 Checking environment variables (optional locally)..."
[ -n "$NEXT_PUBLIC_SUPABASE_URL" ]      && pass "NEXT_PUBLIC_SUPABASE_URL set"      || warn "NEXT_PUBLIC_SUPABASE_URL not set (required in CI)"
[ -n "$NEXT_PUBLIC_SUPABASE_ANON_KEY" ] && pass "NEXT_PUBLIC_SUPABASE_ANON_KEY set" || warn "NEXT_PUBLIC_SUPABASE_ANON_KEY not set (required in CI)"
[ -n "$SMOKE_TEST_USER_EMAIL" ]         && pass "SMOKE_TEST_USER_EMAIL set"         || warn "SMOKE_TEST_USER_EMAIL not set (required in CI)"
[ -n "$SMOKE_TEST_USER_PASSWORD" ]      && pass "SMOKE_TEST_USER_PASSWORD not set"  || warn "SMOKE_TEST_USER_PASSWORD not set (required in CI)"
echo ""

# ── 6. Dependencies ───────────────────────────────────────────────────────────
echo "📚 Checking backend dependencies..."
PKG="$ROOT/backend/package.json"
if [ -f "$PKG" ]; then
  grep -q '"@supabase/supabase-js"' "$PKG" && pass "@supabase/supabase-js present" || fail "@supabase/supabase-js MISSING"
  grep -q '"supertest"'             "$PKG" && pass "supertest present"             || fail "supertest MISSING"
  grep -q '"jest"'                  "$PKG" && pass "jest present"                  || fail "jest MISSING"
  grep -q '"ts-jest"'               "$PKG" && pass "ts-jest present"               || fail "ts-jest MISSING"
else
  fail "backend/package.json not found"
fi
echo ""

# ── Summary ───────────────────────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Verification Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}Passed:${NC}   $PASSED"
echo -e "${RED}Failed:${NC}   $FAILED"
echo -e "${YELLOW}Warnings:${NC} $WARNINGS"
echo ""

if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}✅ All checks passed! Smoke test setup is complete.${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. Install deps:      cd SYNCRO/backend && npm ci"
  echo "  2. Setup test user:   npm run setup:smoke-user"
  echo "  3. Run smoke tests:   npm run test:smoke"
  echo ""
  exit 0
else
  echo -e "${RED}❌ $FAILED check(s) failed. Please fix the errors above.${NC}"
  echo ""
  exit 1
fi
