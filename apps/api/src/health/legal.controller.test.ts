import { describe, expect, it } from 'vitest';
import { LegalController } from './legal.controller';
import type { Env } from '../config/env';

describe('LegalController (public contact for /privacy)', () => {
  it('returns only the contact fields, null when unset', () => {
    expect(new LegalController({ LEGAL_CONTACT_EMAIL: 'owner@example.com', LEGAL_OPERATOR_NAME: 'ร้านทดสอบ', AUTH_SECRET: 'x'.repeat(40) } as Env).legal()).toEqual({ contactEmail: 'owner@example.com', operatorName: 'ร้านทดสอบ' });
    expect(new LegalController({} as Env).legal()).toEqual({ contactEmail: null, operatorName: null });
  });
});
