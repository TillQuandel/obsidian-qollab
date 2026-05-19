import { generateClientId } from '../src/settings';

describe('generateClientId', () => {
  it('returns 8 lowercase hex chars', () => {
    const id = generateClientId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('returns unique values each call', () => {
    const ids = Array.from({ length: 100 }, generateClientId);
    const unique = new Set(ids);
    expect(unique.size).toBe(100);
  });
});
