import type { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { R2StorageService, StorageError } from './r2-storage.service.js';

const SECRET = 'super-secret-r2-key-value';

function makeService() {
  const values: Record<string, unknown> = {
    R2_BUCKET_NAME: 'cdr-radio-tracks',
    R2_PRESIGN_TTL_SECONDS: 300,
    R2_ENDPOINT: 'https://acc123.r2.cloudflarestorage.com',
    R2_ACCESS_KEY_ID: 'AKIDEXAMPLE',
    R2_SECRET_ACCESS_KEY: SECRET,
  };
  return new R2StorageService({
    get: (key: string) => values[key],
  } as unknown as ConfigService<never, true>);
}

const s3Error = (name: string, status: number) =>
  new S3ServiceException({
    name,
    $fault: 'client',
    $metadata: { httpStatusCode: status },
    message: `${name} with details ${SECRET}`,
  });

describe('R2StorageService', () => {
  let send: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    send = vi.spyOn(S3Client.prototype, 'send');
  });
  afterEach(() => vi.restoreAllMocks());

  it('uploads privately (no ACL) to the configured bucket and key', async () => {
    send.mockResolvedValue({} as never);
    await makeService().uploadFile(
      'tracks/abc-123.mp3',
      __filename,
      'audio/mpeg',
      10,
    );

    const command = send.mock.calls[0][0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'cdr-radio-tracks',
      Key: 'tracks/abc-123.mp3',
      ContentType: 'audio/mpeg',
      ContentLength: 10,
    });
    expect(command.input).not.toHaveProperty('ACL');
  });

  it.each([
    '../etc/passwd',
    '/tracks/a.mp3',
    'tracks/My Song.mp3',
    'tracks/a.mp3?x=1',
    '',
  ])('refuses unsafe key %j without calling R2', async (key) => {
    await expect(makeService().deleteObject(key)).rejects.toBeInstanceOf(
      StorageError,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('wraps R2 errors without leaking their message', async () => {
    send.mockRejectedValue(s3Error('AccessDenied', 403) as never);
    const error = await makeService()
      .uploadFile('tracks/a.mp3', __filename, 'audio/mpeg', 1)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageError);
    expect((error as Error).message).toBe(
      'Storage upload failed (AccessDenied, HTTP 403)',
    );
    expect((error as Error).message).not.toContain(SECRET);
  });

  it('headObject returns metadata, or null for a missing object', async () => {
    send.mockResolvedValueOnce({
      ContentLength: 42,
      ContentType: 'audio/mpeg',
    } as never);
    await expect(makeService().headObject('tracks/a.mp3')).resolves.toEqual({
      sizeBytes: 42,
      contentType: 'audio/mpeg',
    });
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);

    send.mockRejectedValueOnce(s3Error('NotFound', 404) as never);
    await expect(makeService().headObject('tracks/a.mp3')).resolves.toBeNull();
  });

  it('deleteObject sends DeleteObject', async () => {
    send.mockResolvedValue({} as never);
    await makeService().deleteObject('tracks/a.mp3');
    expect(send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it('presigns a GET capped at the configured TTL, without exposing the secret', async () => {
    const { url, expiresAt } = await makeService().getPresignedGetUrl(
      'tracks/a.mp3',
      9999,
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(parsed.searchParams.get('X-Amz-Signature')).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(url).not.toContain(SECRET);
    expect(parsed.pathname).toContain('tracks/a.mp3');
    expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(300_000);
  });
});
