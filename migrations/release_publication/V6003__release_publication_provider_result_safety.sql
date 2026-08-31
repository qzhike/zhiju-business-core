-- IM-RP-003 / Issue #23: reject unnormalized Provider Results at the
-- PostgreSQL persistence boundary. V6002 is already applied and remains
-- unchanged; this migration adds a forward-only write guard. Historical data
-- remediation is performed by V6004 before this guard is left active.

SET ROLE release_publication_owner;

CREATE FUNCTION release_publication.provider_result_is_safe(p_provider_result jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $fn$
DECLARE
    item record;
    value_text text;
BEGIN
    IF jsonb_typeof(p_provider_result) <> 'object' THEN
        RETURN false;
    END IF;
    IF p_provider_result =
       '{"redacted": true, "reasonCode": "PROVIDER_RESULT_FIELD_REDACTED"}'::jsonb THEN
        RETURN true;
    END IF;

    FOR item IN SELECT key, value FROM jsonb_each(p_provider_result)
    LOOP
        value_text := item.value #>> '{}';
        IF item.key = 'providerCode' THEN
            IF jsonb_typeof(item.value) <> 'string' OR value_text <> 'feishu.channel' THEN
                RETURN false;
            END IF;
        ELSIF item.key IN ('status', 'providerStatus') THEN
            IF item.value =
               '{"redacted": true, "reasonCode": "PROVIDER_RESULT_FIELD_REDACTED"}'::jsonb THEN
                CONTINUE;
            END IF;
            IF jsonb_typeof(item.value) <> 'string'
               OR value_text NOT IN ('ACCEPTED', 'DELIVERED', 'FAILED', 'PENDING',
                                     'QUEUED', 'REJECTED', 'UNKNOWN') THEN
                RETURN false;
            END IF;
        ELSIF item.key = 'outcome' THEN
            IF item.value =
               '{"redacted": true, "reasonCode": "PROVIDER_RESULT_FIELD_REDACTED"}'::jsonb THEN
                CONTINUE;
            END IF;
            IF jsonb_typeof(item.value) <> 'string'
               OR value_text NOT IN ('FAILED', 'SUCCEEDED', 'UNKNOWN') THEN
                RETURN false;
            END IF;
        ELSIF item.key = 'errorCode' THEN
            IF item.value =
               '{"redacted": true, "reasonCode": "PROVIDER_RESULT_FIELD_REDACTED"}'::jsonb THEN
                CONTINUE;
            END IF;
            IF jsonb_typeof(item.value) <> 'string'
               OR value_text NOT IN ('ADAPTER_ERROR', 'INVALID_REQUEST',
                                     'PERMANENT_FAILURE', 'RATE_LIMITED',
                                     'TEMPORARY_FAILURE', 'UNKNOWN') THEN
                RETURN false;
            END IF;
        ELSIF item.key = 'reasonCode' THEN
            IF item.value =
               '{"redacted": true, "reasonCode": "PROVIDER_RESULT_FIELD_REDACTED"}'::jsonb THEN
                CONTINUE;
            END IF;
            IF jsonb_typeof(item.value) <> 'string'
               OR value_text NOT IN ('DELIVERY_REJECTED', 'PROVIDER_ERROR', 'TIMEOUT', 'UNKNOWN') THEN
                RETURN false;
            END IF;
        ELSIF item.key = 'attemptNumber' THEN
            IF jsonb_typeof(item.value) <> 'number'
               OR value_text !~ '^[1-9][0-9]*$' THEN
                RETURN false;
            END IF;
        ELSIF item.key = 'retryable' THEN
            IF jsonb_typeof(item.value) <> 'boolean' THEN
                RETURN false;
            END IF;
        ELSE
            RETURN false;
        END IF;
    END LOOP;
    RETURN true;
END
$fn$;

CREATE FUNCTION release_publication.guard_provider_result_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
    IF NEW.provider_result IS NULL
       OR NOT release_publication.provider_result_is_safe(NEW.provider_result) THEN
        RAISE EXCEPTION 'provider_result must be normalized before persistence'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$fn$;

CREATE TRIGGER publication_receipt_provider_result_guard
    BEFORE INSERT OR UPDATE OF provider_result
    ON release_publication.publication_receipt
    FOR EACH ROW
    EXECUTE FUNCTION release_publication.guard_provider_result_write();

REVOKE ALL ON FUNCTION release_publication.provider_result_is_safe(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_publication.guard_provider_result_write() FROM PUBLIC;

RESET ROLE;
