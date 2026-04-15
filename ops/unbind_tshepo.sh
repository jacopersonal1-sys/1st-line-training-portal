#!/usr/bin/env bash
set -euo pipefail

# Helper to run the SQL that backs up and unbinds Tshepo Raselabe
# Usage: ./unbind_tshepo.sh "postgresql://user:pass@host:port/dbname"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$SCRIPT_DIR/unbind_tshepo.sql"

if [ $# -lt 1 ]; then
  echo "Usage: $0 \"postgresql://user:pass@host:port/dbname\""
  exit 2
fi

CONN="$1"

echo "About to run backup + unbind for Tshepo Raselabe. Ensure you have admin rights and an external backup."
read -p "Type EXACTLY: I authorize a one-row backup and unbind for Tshepo Raselabe: " CONFIRM
if [ "$CONFIRM" != "I authorize a one-row backup and unbind for Tshepo Raselabe" ]; then
  echo "Confirmation mismatch — aborting."
  exit 3
fi

psql "$CONN" -v ON_ERROR_STOP=1 -f "$SQL_FILE"
