#!/bin/bash

# RLS Audit Script Loader
# Loads environment variables from .env.local and runs RLS compliance check
# This replaces hardcoded credentials in package.json scripts

# Find the root directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

# Load environment variables from .env.local if it exists
if [ -f "$ROOT_DIR/.env.local" ]; then
  set -a  # Export all variables
  source "$ROOT_DIR/.env.local"
  set +a  # Stop exporting
fi

# Verify required environment variables
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "Error: Required environment variables not set"
  echo "Please ensure .env.local contains SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
  exit 1
fi

# Run the RLS compliance check
node "$ROOT_DIR/scripts/check-rls-compliance.js"
