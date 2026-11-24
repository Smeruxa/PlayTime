ALTER TABLE rooms ADD COLUMN key_epoch integer NOT NULL DEFAULT 0 CHECK (key_epoch >= 0);
ALTER TABLE room_members ADD COLUMN visible_after_id integer NOT NULL DEFAULT 0 CHECK (visible_after_id >= 0);

UPDATE room_members AS m
SET visible_after_id = COALESCE(
    (SELECT w.e2ee_visible_after_id FROM room_e2ee_wraps w WHERE w.room_id = m.room_id AND w.user_id = m.user_id),
    (SELECT max(msg.id) FROM messages msg WHERE msg.room_id = m.room_id), 0
);

CREATE TABLE room_key_history (
    room_id integer NOT NULL,
    user_id integer NOT NULL,
    epoch integer NOT NULL CHECK (epoch >= 0),
    wrapper_user_id integer,
    wrapper_public_key text NOT NULL,
    ciphertext text NOT NULL,
    PRIMARY KEY (room_id, user_id, epoch),
    FOREIGN KEY (room_id, user_id) REFERENCES room_members(room_id, user_id) ON DELETE CASCADE
);

CREATE FUNCTION public.rotate_room_membership_key() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    room integer;
    previous_epoch integer;
BEGIN
    IF TG_OP = 'DELETE' THEN
        room := OLD.room_id;
    ELSE
        room := NEW.room_id;
    END IF;
    SELECT key_epoch INTO previous_epoch FROM public.rooms WHERE id = room FOR UPDATE;
    IF FOUND THEN
        IF EXISTS (SELECT FROM public.room_e2ee_wraps WHERE room_id = room)
            OR EXISTS (SELECT FROM public.messages WHERE room_id = room) THEN
            INSERT INTO public.room_key_history(room_id, user_id, epoch, wrapper_user_id, wrapper_public_key, ciphertext)
            SELECT w.room_id, w.user_id, previous_epoch, w.wrapper_user_id, w.wrapper_public_key, w.ciphertext
            FROM public.room_e2ee_wraps w
            JOIN public.room_members m ON m.room_id = w.room_id AND m.user_id = w.user_id
            WHERE w.room_id = room AND w.wrapper_public_key IS NOT NULL;
            UPDATE public.room_members m SET visible_after_id = w.e2ee_visible_after_id
            FROM public.room_e2ee_wraps w WHERE m.room_id = room AND w.room_id = room
                AND w.user_id = m.user_id AND m.visible_after_id < w.e2ee_visible_after_id
                AND (TG_OP = 'INSERT' OR m.user_id <> OLD.user_id);
            DELETE FROM public.room_e2ee_wraps WHERE room_id = room;
            UPDATE public.rooms SET key_epoch = key_epoch + 1 WHERE id = room;
        END IF;
        IF TG_OP = 'INSERT' THEN
            SELECT COALESCE(max(id), 0) INTO NEW.visible_after_id FROM public.messages WHERE room_id = room;
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.rotate_room_membership_key() FROM PUBLIC;
CREATE TRIGGER rotate_room_membership_key BEFORE INSERT OR DELETE ON public.room_members
FOR EACH ROW EXECUTE FUNCTION public.rotate_room_membership_key();

CREATE FUNCTION public.check_room_message_epoch() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
    active_epoch integer;
    message_epoch integer;
BEGIN
    IF NEW.room_id IS NULL OR left(NEW.content, 5) <> 'R2E1:' THEN RETURN NEW; END IF;
    SELECT key_epoch INTO active_epoch FROM public.rooms WHERE id = NEW.room_id FOR SHARE;
    IF NOT EXISTS (SELECT FROM public.room_members WHERE room_id = NEW.room_id AND user_id = NEW.sender_id) THEN
        RAISE EXCEPTION 'Нет доступа к комнате' USING ERRCODE = '42501';
    END IF;
    message_epoch := COALESCE((substr(NEW.content, 6)::jsonb ->> 'e')::integer, 0);
    IF active_epoch <> message_epoch THEN
        RAISE EXCEPTION 'Ключ комнаты изменился. Обновите приложение и повторите отправку.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER check_room_message_epoch BEFORE INSERT OR UPDATE OF content ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.check_room_message_epoch();
