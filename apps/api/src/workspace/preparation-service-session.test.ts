import { describe, it, expect } from 'vitest';
import { createPreparationServiceSessions } from './preparation-service-session.js';

describe('bounded internal preparation service sessions', () => {
  it('refreshes before expiry while preserving already-issued unexpired sessions', () => {
    let time = Date.now();
    const sessions = createPreparationServiceSessions('service', () => new Date(time));
    const original = sessions.current();
    expect(Date.parse(original.expiresAt) - time).toBe(300000);
    time += 240000;
    const fresh = sessions.current();
    expect(fresh.authenticationContextHash).not.toEqual(original.authenticationContextHash);
    expect(() => {
      sessions.verify(original);
    }).not.toThrow();
    expect(() => {
      sessions.verify(fresh);
    }).not.toThrow();
    time += 60000;
    expect(() => {
      sessions.verify(original);
    }).toThrow('AUTHORIZATION_DENIED');
    expect(() => {
      sessions.verify(fresh);
    }).not.toThrow();
    expect(original.expiresAt).not.toBe(fresh.expiresAt);
  });
  it('rejects forged or extended sessions and cannot restore expired authority', () => {
    let time = Date.now();
    const sessions = createPreparationServiceSessions('service', () => new Date(time));
    const session = sessions.current();
    expect(() => {
      sessions.verify({ ...session, principalId: 'different' });
    }).toThrow('AUTHORIZATION_DENIED');
    expect(() => {
      sessions.verify({ ...session, expiresAt: new Date(time + 3600000).toISOString() });
    }).toThrow('AUTHORIZATION_DENIED');
    time += 300000;
    sessions.current();
    expect(() => {
      sessions.verify(session);
    }).toThrow('AUTHORIZATION_DENIED');
  });
});
