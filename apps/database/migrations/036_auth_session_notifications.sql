CREATE FUNCTION public.notify_auth_session_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
    scope text;
    target text;
BEGIN
    IF TG_TABLE_NAME = 'users' THEN
        scope := 'user';
        target := OLD.id::text;
    ELSIF TG_TABLE_NAME = 'auth_sessions' THEN
        scope := 'device';
        target := OLD.id::text;
    ELSE
        scope := 'access';
        target := NEW.jti;
    END IF;
    PERFORM pg_notify('playtime_auth_session_changes', json_build_array(scope, target)::text);
    RETURN NULL;
END
$$;

CREATE TRIGGER notify_auth_account_update
AFTER UPDATE OF auth_version, is_blocked, guest_archived_at ON public.users
FOR EACH ROW
WHEN (OLD.auth_version IS DISTINCT FROM NEW.auth_version
    OR (NOT OLD.is_blocked AND NEW.is_blocked)
    OR (OLD.guest_archived_at IS NULL AND NEW.guest_archived_at IS NOT NULL))
EXECUTE FUNCTION public.notify_auth_session_change();

CREATE TRIGGER notify_auth_account_delete AFTER DELETE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.notify_auth_session_change();

CREATE TRIGGER notify_auth_device_update
AFTER UPDATE OF revoked_at, expires_at, session_version ON public.auth_sessions
FOR EACH ROW
WHEN ((OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
    OR NEW.expires_at < OLD.expires_at
    OR NEW.session_version IS DISTINCT FROM OLD.session_version)
EXECUTE FUNCTION public.notify_auth_session_change();

CREATE TRIGGER notify_auth_device_delete AFTER DELETE ON public.auth_sessions
FOR EACH ROW WHEN (OLD.revoked_at IS NULL)
EXECUTE FUNCTION public.notify_auth_session_change();

CREATE TRIGGER notify_auth_access_revoked AFTER INSERT OR UPDATE OF expires_at ON public.revoked_access_tokens
FOR EACH ROW EXECUTE FUNCTION public.notify_auth_session_change();
