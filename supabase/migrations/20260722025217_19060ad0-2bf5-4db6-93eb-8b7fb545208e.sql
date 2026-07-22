
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;
ALTER EXTENSION "pgcrypto" SET SCHEMA extensions;
ALTER EXTENSION "vector" SET SCHEMA extensions;
