-- IM-02 WI-01: platform bootstrap.
-- Creates the single Core Database schema topology only: seven owning schemas
-- plus the rebuildable projection schema (PG-002). Business tables, roles and
-- RLS policies are owned by later work items (#30, #31, #32 ...).
-- This migration must not create business objects and must stay forward-only.

CREATE SCHEMA IF NOT EXISTS identity_policy;
CREATE SCHEMA IF NOT EXISTS enterprise_project;
CREATE SCHEMA IF NOT EXISTS task_execution;
CREATE SCHEMA IF NOT EXISTS artifact;
CREATE SCHEMA IF NOT EXISTS quality_governance;
CREATE SCHEMA IF NOT EXISTS release_publication;
CREATE SCHEMA IF NOT EXISTS integration_gateway;
CREATE SCHEMA IF NOT EXISTS projection;
