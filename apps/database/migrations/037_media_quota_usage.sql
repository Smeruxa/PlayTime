ALTER TABLE public.media_objects ADD COLUMN quota_group TEXT;

UPDATE public.media_objects o SET quota_group = COALESCE((
    SELECT CASE WHEN u.is_guest THEN 'guest' WHEN s.plan_slug IN ('medium', 'pro', 'enterprise') THEN 'paid' ELSE 'free' END
    FROM public.users u LEFT JOIN public.user_subscriptions s ON s.user_id = u.id WHERE u.id = o.user_id
), 'free');

ALTER TABLE public.media_objects
    ALTER COLUMN quota_group SET NOT NULL,
    ADD CHECK (quota_group IN ('guest', 'free', 'paid'));

CREATE TABLE public.media_quota_usage (
    scope TEXT NOT NULL,
    user_id INTEGER NOT NULL DEFAULT 0,
    size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
    attachments INTEGER NOT NULL DEFAULT 0 CHECK (attachments >= 0),
    voices INTEGER NOT NULL DEFAULT 0 CHECK (voices >= 0),
    PRIMARY KEY (scope, user_id),
    CHECK ((scope = 'user' AND user_id > 0) OR (scope IN ('all', 'guest', 'free', 'paid') AND user_id = 0))
);

INSERT INTO public.media_quota_usage(scope, size_bytes)
SELECT 'all', COALESCE(SUM(size_bytes), 0) FROM public.media_objects;

INSERT INTO public.media_quota_usage(scope, size_bytes)
SELECT groups.scope, COALESCE(SUM(o.size_bytes), 0)
FROM (VALUES ('guest'), ('free'), ('paid')) groups(scope)
LEFT JOIN public.media_objects o ON o.quota_group = groups.scope
GROUP BY groups.scope;

INSERT INTO public.media_quota_usage(scope, user_id, size_bytes, attachments, voices)
SELECT 'user', user_id, SUM(size_bytes), COUNT(*) FILTER (WHERE kind = 'attachment'), COUNT(*) FILTER (WHERE kind = 'voice')
FROM public.media_objects GROUP BY user_id;

CREATE FUNCTION public.playtime_classify_media_quota() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
BEGIN
    IF EXISTS (SELECT 1 FROM public.users WHERE id = NEW.user_id AND is_guest) THEN
        NEW.quota_group := 'guest';
    ELSIF NEW.quota_group IS NULL THEN
        NEW.quota_group := CASE WHEN EXISTS (
            SELECT 1 FROM public.user_subscriptions WHERE user_id = NEW.user_id AND plan_slug IN ('medium', 'pro', 'enterprise')
        ) THEN 'paid' ELSE 'free' END;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE TRIGGER playtime_classify_media_quota
BEFORE INSERT ON public.media_objects FOR EACH ROW EXECUTE FUNCTION public.playtime_classify_media_quota();

CREATE FUNCTION public.playtime_count_media_quota() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
DECLARE
    media public.media_objects;
    byte_delta BIGINT;
    count_delta INTEGER;
    attachment_delta INTEGER;
    voice_delta INTEGER;
BEGIN
    IF TG_OP = 'INSERT' THEN
        media := NEW;
        byte_delta := media.size_bytes;
        count_delta := 1;
    ELSIF TG_OP = 'DELETE' THEN
        media := OLD;
        byte_delta := -media.size_bytes;
        count_delta := -1;
    ELSE
        IF (NEW.user_id, NEW.kind, NEW.quota_group) IS DISTINCT FROM (OLD.user_id, OLD.kind, OLD.quota_group) THEN
            RAISE EXCEPTION 'Media ownership and quota group are immutable';
        END IF;
        media := NEW;
        byte_delta := NEW.size_bytes - OLD.size_bytes;
        count_delta := 0;
        IF byte_delta = 0 THEN RETURN NULL; END IF;
    END IF;

    attachment_delta := CASE WHEN media.kind = 'attachment' THEN count_delta ELSE 0 END;
    voice_delta := CASE WHEN media.kind = 'voice' THEN count_delta ELSE 0 END;

    UPDATE public.media_quota_usage SET size_bytes = size_bytes + byte_delta WHERE scope = 'all' AND user_id = 0;
    UPDATE public.media_quota_usage SET size_bytes = size_bytes + byte_delta WHERE scope = media.quota_group AND user_id = 0;

    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.media_quota_usage AS usage(scope, user_id, size_bytes, attachments, voices)
        VALUES ('user', media.user_id, byte_delta, attachment_delta, voice_delta)
        ON CONFLICT (scope, user_id) DO UPDATE SET
            size_bytes = usage.size_bytes + EXCLUDED.size_bytes,
            attachments = usage.attachments + EXCLUDED.attachments,
            voices = usage.voices + EXCLUDED.voices;
    ELSE
        UPDATE public.media_quota_usage SET
            size_bytes = size_bytes + byte_delta,
            attachments = attachments + attachment_delta,
            voices = voices + voice_delta
        WHERE scope = 'user' AND user_id = media.user_id;
        DELETE FROM public.media_quota_usage WHERE scope = 'user' AND user_id = media.user_id AND attachments = 0 AND voices = 0;
    END IF;
    RETURN NULL;
END;
$function$;

CREATE TRIGGER playtime_count_media_quota
AFTER INSERT OR UPDATE OR DELETE ON public.media_objects FOR EACH ROW EXECUTE FUNCTION public.playtime_count_media_quota();

REVOKE ALL ON FUNCTION public.playtime_classify_media_quota(), public.playtime_count_media_quota() FROM PUBLIC;
