## Root cause

The admin row exists in `user_roles` for `sanjeev.chandrasekaran@tarento.com`, but every client request that touches role-gated data fails with:

```
permission denied for function has_role
```

The RLS policies on `user_roles` (and elsewhere) call `public.has_role(...)`, but `has_role` and `has_any_role` have **no EXECUTE grants** to `authenticated` / `anon`. Without EXECUTE, PostgREST rejects the request before RLS is even evaluated, so the app can never confirm the user is admin.

## Fix

Run one migration that grants EXECUTE on both security-definer role-check functions:

```sql
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) TO authenticated;
```

No other changes. After the migration, the user signs out and back in (or just refreshes) and admin access works.
