-- IM-RP-003 / Issue #23: remediate Provider Result values written by V6002.
-- The upgrade scans existing Receipt and Observation facts, removes raw
-- identifiers and unknown values, repairs Observation hashes, and restores
-- the append-only/write guards before the migration commits.

SET ROLE release_publication_owner;

CREATE FUNCTION release_publication.provider_result_upgrade(p_provider_result jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $fn$
DECLARE
    item record;
    value_text text;
    result jsonb := '{}'::jsonb;
    marker constant jsonb := '{"redacted": true, "reasonCode": "PROVIDER_RESULT_FIELD_REDACTED"}'::jsonb;
BEGIN
    IF p_provider_result IS NULL OR jsonb_typeof(p_provider_result) <> 'object' THEN
        RETURN marker;
    END IF;
    IF p_provider_result = marker THEN
        RETURN marker;
    END IF;

    FOR item IN SELECT key, value FROM jsonb_each(p_provider_result)
    LOOP
        value_text := item.value #>> '{}';
        IF item.key = 'providerCode' THEN
            IF jsonb_typeof(item.value) = 'string' AND value_text = 'feishu.channel' THEN
                result := result || jsonb_build_object(item.key, value_text);
            END IF;
        ELSIF item.key IN ('status', 'providerStatus') THEN
            IF item.value = marker THEN
                result := result || jsonb_build_object(item.key, marker);
            ELSIF jsonb_typeof(item.value) = 'string'
                  AND lower(value_text) IN ('accepted', 'delivered', 'failed', 'pending',
                                             'queued', 'rejected', 'unknown') THEN
                result := result || jsonb_build_object(item.key, upper(value_text));
            ELSE
                result := result || jsonb_build_object(item.key, marker);
            END IF;
        ELSIF item.key = 'outcome' THEN
            IF item.value = marker THEN
                result := result || jsonb_build_object(item.key, marker);
            ELSIF jsonb_typeof(item.value) = 'string' AND lower(value_text) IN ('failed') THEN
                result := result || jsonb_build_object(item.key, 'FAILED');
            ELSIF jsonb_typeof(item.value) = 'string'
                  AND lower(value_text) IN ('success', 'succeeded') THEN
                result := result || jsonb_build_object(item.key, 'SUCCEEDED');
            ELSIF jsonb_typeof(item.value) = 'string'
                  AND lower(value_text) IN ('timeout', 'unknown') THEN
                result := result || jsonb_build_object(item.key, 'UNKNOWN');
            ELSE
                result := result || jsonb_build_object(item.key, marker);
            END IF;
        ELSIF item.key = 'errorCode' THEN
            IF item.value = marker THEN
                result := result || jsonb_build_object(item.key, marker);
            ELSIF jsonb_typeof(item.value) = 'string'
                  AND upper(value_text) IN ('ADAPTER_ERROR', 'INVALID_REQUEST',
                                             'PERMANENT_FAILURE', 'RATE_LIMITED',
                                             'TEMPORARY_FAILURE', 'UNKNOWN') THEN
                result := result || jsonb_build_object(item.key, upper(value_text));
            ELSE
                result := result || jsonb_build_object(item.key, marker);
            END IF;
        ELSIF item.key = 'reasonCode' THEN
            IF item.value = marker THEN
                result := result || jsonb_build_object(item.key, marker);
            ELSIF jsonb_typeof(item.value) = 'string'
                  AND upper(value_text) IN ('DELIVERY_REJECTED', 'PROVIDER_ERROR',
                                             'TIMEOUT', 'UNKNOWN') THEN
                result := result || jsonb_build_object(item.key, upper(value_text));
            ELSE
                result := result || jsonb_build_object(item.key, marker);
            END IF;
        ELSIF item.key = 'attemptNumber' THEN
            IF jsonb_typeof(item.value) = 'number' AND value_text ~ '^[1-9][0-9]*$' THEN
                result := result || jsonb_build_object(item.key, item.value);
            END IF;
        ELSIF item.key = 'retryable' THEN
            IF jsonb_typeof(item.value) = 'boolean' THEN
                result := result || jsonb_build_object(item.key, item.value);
            END IF;
        END IF;
    END LOOP;
    RETURN result;
END
$fn$;

-- PostgreSQL 18 provides sha256(bytea); this local canonicalizer mirrors the
-- shared-kernel rules for the sanitized Observation JSON without enabling
-- pgcrypto. The upgraded payloads contain only JSON values accepted by the
-- canonical contract, so unsafe non-integer numbers fail the transaction.
CREATE FUNCTION release_publication.canonical_jsonb_text(p_value jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $fn$
DECLARE
    item record;
    kind text;
    result text;
    separator text := '';
    number_value numeric;
BEGIN
    kind := jsonb_typeof(p_value);
    IF kind = 'object' THEN
        result := '{';
        FOR item IN
            SELECT key, value
              FROM jsonb_each(p_value)
             ORDER BY encode(convert_to(normalize(key, NFC), 'UTF8'), 'hex')
        LOOP
            result := result
                || separator
                || to_jsonb(normalize(item.key, NFC))::text
                || ':'
                || release_publication.canonical_jsonb_text(item.value);
            separator := ',';
        END LOOP;
        RETURN result || '}';
    ELSIF kind = 'array' THEN
        result := '[';
        FOR item IN
            SELECT value
              FROM jsonb_array_elements(p_value) WITH ORDINALITY AS elements(value, ordinal)
             ORDER BY ordinal
        LOOP
            result := result
                || separator
                || release_publication.canonical_jsonb_text(item.value);
            separator := ',';
        END LOOP;
        RETURN result || ']';
    ELSIF kind = 'string' THEN
        RETURN to_jsonb(normalize(p_value #>> '{}', NFC))::text;
    ELSIF kind = 'number' THEN
        number_value := (p_value #>> '{}')::numeric;
        IF number_value <> trunc(number_value)
           OR abs(number_value) > 9007199254740991::numeric THEN
            RAISE EXCEPTION 'canonical JSON number is not a safe integer'
                USING ERRCODE = '22023';
        END IF;
        RETURN trunc(number_value)::text;
    ELSIF kind = 'boolean' THEN
        RETURN p_value #>> '{}';
    ELSIF kind = 'null' THEN
        RETURN 'null';
    END IF;
    RAISE EXCEPTION 'unsupported JSON value in canonical payload'
        USING ERRCODE = '22023';
END
$fn$;

REVOKE ALL ON FUNCTION release_publication.provider_result_upgrade(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_publication.canonical_jsonb_text(jsonb) FROM PUBLIC;

-- V6002 facts are immutable at runtime. A migration-owned maintenance window
-- is the only place that may rewrite their provider-result projection; all
-- guards are restored before this transaction is allowed to commit.
ALTER TABLE release_publication.publication_receipt
    DISABLE TRIGGER publication_receipt_provider_result_guard;
ALTER TABLE release_publication.publication_receipt
    DISABLE TRIGGER publication_receipt_immutable_guard;
ALTER TABLE release_publication.publication_observation
    DISABLE TRIGGER publication_observation_immutable_guard;

UPDATE release_publication.publication_receipt
   SET provider_result = release_publication.provider_result_upgrade(provider_result)
 WHERE provider_result IS DISTINCT FROM
       release_publication.provider_result_upgrade(provider_result);

WITH normalized AS (
    SELECT observation_id,
           jsonb_set(
               observation_payload,
               ARRAY['providerResult'],
               release_publication.provider_result_upgrade(observation_payload -> 'providerResult'),
               false) AS payload
      FROM release_publication.publication_observation
     WHERE observation_payload ? 'providerResult'
), hashed AS (
    SELECT observation_id,
           payload,
           sha256(convert_to(release_publication.canonical_jsonb_text(payload), 'UTF8')) AS payload_hash
      FROM normalized
)
UPDATE release_publication.publication_observation observation
   SET observation_payload = hashed.payload,
       observation_payload_hash = hashed.payload_hash
  FROM hashed
 WHERE observation.observation_id = hashed.observation_id
   AND (observation.observation_payload IS DISTINCT FROM hashed.payload
        OR observation.observation_payload_hash IS DISTINCT FROM hashed.payload_hash);

ALTER TABLE release_publication.publication_observation
    ENABLE TRIGGER publication_observation_immutable_guard;
ALTER TABLE release_publication.publication_receipt
    ENABLE TRIGGER publication_receipt_immutable_guard;
ALTER TABLE release_publication.publication_receipt
    ENABLE TRIGGER publication_receipt_provider_result_guard;

DO $check$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM release_publication.publication_receipt
         WHERE NOT release_publication.provider_result_is_safe(provider_result)) THEN
        RAISE EXCEPTION 'historical publication Receipt provider_result remediation incomplete'
            USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM release_publication.publication_observation
         WHERE observation_payload ? 'providerResult'
           AND NOT release_publication.provider_result_is_safe(observation_payload -> 'providerResult')) THEN
        RAISE EXCEPTION 'historical publication Observation provider_result remediation incomplete'
            USING ERRCODE = '23514';
    END IF;
END
$check$;

DROP FUNCTION release_publication.provider_result_upgrade(jsonb);
DROP FUNCTION release_publication.canonical_jsonb_text(jsonb);

RESET ROLE;
