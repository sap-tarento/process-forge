Grant the `admin` role to the existing user `sanjeev.chandrasekaran@tarento.com`.

Steps:
1. Look up the user's `id` in `auth.users` by email.
2. Insert `(user_id, 'admin')` into `public.user_roles` (idempotent via existing unique constraint on `user_id, role`).

Executed as a one-off data operation via the insert tool — no schema changes, no code changes.