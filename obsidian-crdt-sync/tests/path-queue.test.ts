import { PathQueue } from '../src/path-queue';

// Echter Makrotask-Tick: garantiert, dass ein „vorheriger" Aufruf wirklich
// vollständig durchläuft, bevor der nächste anfangen darf.
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('PathQueue', () => {
  it('run gibt das fn-Ergebnis zurück', async () => {
    const q = new PathQueue();
    await expect(q.run('k', async () => 42)).resolves.toBe(42);
  });

  it('gleicher Key läuft strikt nacheinander (FIFO)', async () => {
    const q = new PathQueue();
    const log: string[] = [];

    const p1 = q.run('k', async () => {
      log.push('a-start');
      await tick();
      log.push('a-end');
    });
    const p2 = q.run('k', async () => {
      log.push('b-start');
      await tick();
      log.push('b-end');
    });

    await Promise.all([p1, p2]);
    // b darf erst starten, wenn a komplett fertig ist.
    expect(log).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('verschiedene Keys laufen parallel', async () => {
    const q = new PathQueue();
    const log: string[] = [];

    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => {
      releaseA = r;
    });

    const pA = q.run('a', async () => {
      log.push('a-start');
      await gateA;
      log.push('a-end');
    });
    const pB = q.run('b', async () => {
      log.push('b-start');
    });

    // b läuft durch, obwohl a noch hängt → Keys blockieren sich nicht.
    await pB;
    expect(log).toEqual(['a-start', 'b-start']);

    releaseA();
    await pA;
    expect(log).toEqual(['a-start', 'b-start', 'a-end']);
  });

  it('ein rejecteter fn blockiert nachfolgende gleiche Keys nicht', async () => {
    const q = new PathQueue();
    const ran: string[] = [];

    const p1 = q.run('k', async () => {
      await tick();
      throw new Error('boom');
    });
    const p2 = q.run('k', async () => {
      ran.push('ran');
      return 'ok';
    });

    await expect(p1).rejects.toThrow('boom');
    await expect(p2).resolves.toBe('ok');
    expect(ran).toEqual(['ran']);
  });

  it('Map ist nach Abschluss leer (kein Leak)', async () => {
    const q = new PathQueue();

    await q.run('a', async () => {});
    await q.run('b', async () => {});
    await q.run('a', async () => {});

    // Cleanup läuft in einem nachgelagerten Microtask nach dem Tail-Settle.
    await tick();
    expect(q.size).toBe(0);
  });

  it('Map bleibt während laufender Arbeit belegt, räumt danach auf', async () => {
    const q = new PathQueue();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });

    const p = q.run('a', async () => {
      await gate;
    });
    expect(q.size).toBe(1);

    release();
    await p;
    await tick();
    expect(q.size).toBe(0);
  });
});
