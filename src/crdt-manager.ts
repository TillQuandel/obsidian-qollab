import * as Y from 'yjs';

export class CrdtManager {
  private docs = new Map<string, Y.Doc>();

  private getOrCreate(filePath: string): Y.Doc {
    if (!this.docs.has(filePath)) {
      this.docs.set(filePath, new Y.Doc());
    }
    return this.docs.get(filePath)!;
  }

  // Bekannte Limitierung (Phase 1): delete+insert zerstört granulare Yjs-History.
  // Bei gleichzeitigen Edits in derselben Zeile entscheidet Yjs-Tie-Breaking.
  // Für Phase 2: durch Diff-basiertes Update ersetzen (z.B. via y-codemirror).
  setContent(filePath: string, content: string): void {
    const doc = this.getOrCreate(filePath);
    const text = doc.getText('content');
    doc.transact(() => {
      text.delete(0, text.length);
      text.insert(0, content);
    });
  }

  getContent(filePath: string): string {
    if (!this.docs.has(filePath)) return '';
    return this.docs.get(filePath)!.getText('content').toString();
  }

  encodeState(filePath: string): Uint8Array {
    return Y.encodeStateAsUpdate(this.getOrCreate(filePath));
  }

  applyUpdate(filePath: string, update: Uint8Array): void {
    Y.applyUpdate(this.getOrCreate(filePath), update);
  }

  mergeAndGet(filePath: string, remoteState: Uint8Array): string {
    this.applyUpdate(filePath, remoteState);
    return this.getContent(filePath);
  }

  disposeDoc(filePath: string): void {
    this.docs.get(filePath)?.destroy();
    this.docs.delete(filePath);
  }

  disposeAll(): void {
    for (const doc of this.docs.values()) doc.destroy();
    this.docs.clear();
  }
}
