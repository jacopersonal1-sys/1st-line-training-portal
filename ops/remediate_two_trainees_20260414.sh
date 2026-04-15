#!/usr/bin/env bash
set -euo pipefail

# Runs targeted remediation for:
# - Nompumelelo Dzingwa
# - Sichumile Makaula
#
# Usage:
#   bash ops/remediate_two_trainees_20260414.sh "postgresql://user:pass@host:port/dbname"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$SCRIPT_DIR/remediate_two_trainees_20260414.sql"

if [ $# -lt 1 ]; then
  echo "Usage: $0 \"postgresql://user:pass@host:port/dbname\""
  exit 2
fi

CONN="$1"

echo "About to run targeted lifecycle remediation for:"
echo " - Nompumelelo Dzingwa"
echo " - Sichumile Makaula"
echo
echo "This will BACK UP rows, append retrain archive entries, and delete stale old-attempt lifecycle rows."
echo "Current roster/group placement is preserved."
echo
read -r -p "Type EXACTLY: I authorize targeted remediation for two trainees: " CONFIRM
if [ "$CONFIRM" != "I authorize targeted remediation for two trainees" ]; then
  echo "Confirmation mismatch — aborting."
  exit 3
fi

psql "$CONN" -v ON_ERROR_STOP=1 -f "$SQL_FILE"
