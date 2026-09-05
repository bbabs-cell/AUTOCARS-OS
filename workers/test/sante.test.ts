import { SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { prepareBase } from './aide';

describe('la pile répond', () => {
  beforeEach(prepareBase);

  it('/api/health interroge vraiment la base', async () => {
    const res = await SELF.fetch('https://api.test/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: { status: 'ok' } });
  });

  it('une adresse inconnue renvoie 404 sans rien révéler', async () => {
    const res = await SELF.fetch('https://api.test/api/nimporte-quoi');
    expect(res.status).toBe(404);
    const corps = (await res.json()) as { success: boolean; message: string };
    expect(corps.success).toBe(false);
    expect(corps.message).not.toMatch(/SQL|D1|stack|\.ts/i);
  });
});
