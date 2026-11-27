import crypto from 'node:crypto';

export function hashEvent(prevHash: string, event: unknown): string {
  return crypto.createHash('sha256').update(prevHash + JSON.stringify(event)).digest('hex');
}

export function verifyChain(events: unknown[], hashes: string[]): boolean {
  let prev = 'GENESIS';
  for (let i = 0; i < events.length; i++) {
    const h = hashEvent(prev, events[i]);
    if (h !== hashes[i]) return false;
    prev = h;
  }
  return true;
}
