import CrdtSyncPlugin from '../src/main';

// Smoke-Test: prüft nur, dass src/main.ts mit dem Obsidian-Stub
// überhaupt importierbar ist und die Plugin-Klasse existiert.
// Keine Instanziierung nötig.
describe('CrdtSyncPlugin (main)', () => {
  it('ist importierbar und als Klasse definiert', () => {
    expect(CrdtSyncPlugin).toBeDefined();
    expect(typeof CrdtSyncPlugin).toBe('function');
  });
});
