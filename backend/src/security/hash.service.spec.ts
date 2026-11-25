import type { ConfigService } from '@nestjs/config';
import { HashService } from './hash.service.js';

describe('HashService', () => {
  const config = { get: () => 10 } as unknown as ConfigService<never, true>;
  const service = new HashService(config);

  it('hashes with bcrypt at the configured cost and never returns the plain text', async () => {
    const hash = await service.hash('correct horse battery staple');
    expect(hash).toMatch(/^\$2[aby]\$10\$/);
    expect(hash).not.toContain('correct horse');
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await service.hash('s3cret-password!');
    await expect(service.verify('s3cret-password!', hash)).resolves.toBe(true);
    await expect(service.verify('wrong-password', hash)).resolves.toBe(false);
  });

  it('salts every hash differently', async () => {
    const [a, b] = await Promise.all([
      service.hash('same'),
      service.hash('same'),
    ]);
    expect(a).not.toBe(b);
  });

  it('returns false instead of throwing for a malformed hash', async () => {
    await expect(service.verify('anything', 'not-a-bcrypt-hash')).resolves.toBe(
      false,
    );
  });
});
