-- Backup and unbind script for user: Tshepo Raselabe
-- Usage: psql "postgresql://user:pass@host:port/dbname" -v ON_ERROR_STOP=1 -f ops/unbind_tshepo.sql
-- NOTE: This script creates a server-side backup table `backup_users_tshepo` and then removes the
-- 'boundClientId' key from matching rows in `users`.

BEGIN;

-- Print matching user rows (case-insensitive match on data->>'user')
SELECT id, data FROM users WHERE LOWER(COALESCE(data->>'user','')) = 'tshepo raselabe';

-- Create a backup table if it doesn't already exist (structure copies 'users')
CREATE TABLE IF NOT EXISTS backup_users_tshepo (LIKE users INCLUDING ALL);

-- Insert matching rows into the backup table
INSERT INTO backup_users_tshepo
SELECT * FROM users WHERE LOWER(COALESCE(data->>'user','')) = 'tshepo raselabe';

-- Remove the 'boundClientId' key from the JSONB `data` column for the user
UPDATE users
SET data = data - 'boundClientId'
WHERE LOWER(COALESCE(data->>'user','')) = 'tshepo raselabe';

-- Verify the change
SELECT id, data->>'boundClientId' AS boundClientId FROM users WHERE LOWER(COALESCE(data->>'user','')) = 'tshepo raselabe';

COMMIT;
