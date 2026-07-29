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

// Task 15 Fix C: runAll nimmt mehrere Keys in EINEM Schritt. Der rename-Handler
// braucht das, weil verschachtelte run-Aufrufe den zweiten Key erst beim
// Body-Start belegen — ein dazwischen eingereihter Task zieht dann vorbei.
describe('PathQueue.runAll (Mehrfach-Key)', () => {
  it('belegt alle Keys sofort: ein danach eingereihter Task wartet, obwohl der Body noch nicht lief', async () => {
    const q = new PathQueue();
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => {
      releaseA = r;
    });

    const order: string[] = [];

    // Task auf 'a' parken — runAll kommt damit gar nicht erst zum Body.
    const parked = q.run('a', async () => {
      order.push('parked');
      await gateA;
    });

    const both = q.runAll(['a', 'b'], async () => {
      order.push('runAll');
    });

    // Später auf 'b' eingereiht. 'b' ist faktisch frei (runAll-Body läuft nicht),
    // muss aber trotzdem hinter runAll warten.
    const onB = q.run('b', async () => {
      order.push('b-danach');
    });

    releaseA();
    await Promise.all([parked, both, onB]);

    expect(order).toEqual(['parked', 'runAll', 'b-danach']);
  });

  it('dedupliziert doppelte Keys (kein Selbst-Deadlock) und räumt alle Keys auf', async () => {
    const q = new PathQueue();

    await q.runAll(['a', 'a'], async () => {});
    await q.runAll(['b', 'a'], async () => {});

    await tick();
    expect(q.size).toBe(0);
  });
});
