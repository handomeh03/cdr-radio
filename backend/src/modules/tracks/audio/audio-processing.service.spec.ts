/** Uses the real host FFmpeg/ffprobe (FFMPEG_PATH / FFPROBE_PATH or PATH). */
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import {
  createAudioFixtures,
  FFMPEG,
  FFPROBE,
  type AudioFixtures,
} from '../../../../test/support/audio-fixtures.js';
import {
  AudioProcessingError,
  AudioProcessingService,
  cleanTag,
} from './audio-processing.service.js';
import { runProcess } from './run-process.js';

function makeService(root: string, overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    FFMPEG_PATH: FFMPEG,
    FFPROBE_PATH: FFPROBE,
    FFMPEG_TIMEOUT_MS: 60_000,
    AUDIO_TMP_DIR: root,
    ...overrides,
  };
  return new AudioProcessingService({
    get: (key: string) => values[key],
  } as unknown as ConfigService<never, true>);
}

async function probeJson(path: string) {
  const { stdout } = await runProcess(
    FFPROBE,
    [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      path,
    ],
    { timeoutMs: 30_000 },
  );
  return JSON.parse(stdout) as {
    format: {
      format_name: string;
      duration: string;
      bit_rate: string;
      tags?: object;
    };
    streams: Array<{
      codec_name: string;
      sample_rate: string;
      channels: number;
    }>;
  };
}

describe('AudioProcessingService (real FFmpeg)', () => {
  let root: string;
  let fixtures: AudioFixtures;
  let service: AudioProcessingService;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'cdr-audio-spec-'));
    fixtures = await createAudioFixtures(join(root, 'fixtures'));
    service = makeService(root);
    await service.onModuleInit();
  }, 60_000);

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it.each([
    ['wav', 'wav'],
    ['flacTagged', 'flac'],
    ['m4a', 'm4a'],
    ['ogg', 'ogg'],
    ['mp3', 'mp3'],
  ] as const)(
    'accepts %s and reports its real format',
    async (name, format) => {
      const probed = await service.probeUpload(fixtures[name]);
      expect(probed.format).toBe(format);
      expect(probed.durationMs).toBeGreaterThan(2_900);
      expect(probed.durationMs).toBeLessThan(3_200);
    },
  );

  it('reads title/artist tags', async () => {
    const probed = await service.probeUpload(fixtures.flacTagged);
    expect(probed).toMatchObject({
      title: 'Fixture Title',
      artist: 'Fixture Artist',
    });
  });

  it.each([
    ['textAsMp3', /^INVALID_AUDIO$/],
    ['videoMp4', /^UNSUPPORTED_FORMAT$/],
    // FFmpeg itself refuses an HLS playlist named .mp3; if it ever parsed it, the
    // container allow-list would reject "hls". Either way it must not be accepted.
    ['hlsPlaylist', /^(INVALID_AUDIO|UNSUPPORTED_FORMAT)$/],
    ['shortWav', /^INVALID_AUDIO$/],
  ] as const)('rejects %s regardless of extension', async (name, code) => {
    const error = await service
      .probeUpload(fixtures[name])
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AudioProcessingError);
    expect((error as AudioProcessingError).code).toMatch(code);
  });

  it('transcodes to MP3 128 kbps / 44.1 kHz / stereo and strips source metadata', async () => {
    const probed = await service.probeUpload(fixtures.flacTagged);
    const out = service.newOutputPath();
    const result = await service.transcodeToMp3(
      fixtures.flacTagged,
      probed,
      out,
    );

    const info = await probeJson(out);
    expect(info.format.format_name).toBe('mp3');
    expect(info.streams[0]).toMatchObject({
      codec_name: 'mp3',
      sample_rate: '44100',
      channels: 2,
    });
    expect(Number(info.format.bit_rate)).toBeGreaterThan(120_000);
    expect(Number(info.format.bit_rate)).toBeLessThan(136_000);
    expect(info.format.tags ?? {}).not.toHaveProperty('title');
    expect(result.durationMs).toBeGreaterThan(2_900);
    expect(result.durationMs).toBeLessThan(3_200);
    expect(result.sizeBytes).toBeGreaterThan(40_000);
    await service.removeTempFiles(out);
  });

  it('kills FFmpeg at the timeout and reports TIMEOUT', async () => {
    const slow = makeService(root, { FFMPEG_TIMEOUT_MS: 1 });
    const probed = await service.probeUpload(fixtures.wav);
    await expect(
      slow.transcodeToMp3(fixtures.wav, probed, slow.newOutputPath()),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('reports UNAVAILABLE (without the path) when the executable is missing', async () => {
    const missing = makeService(root, {
      FFPROBE_PATH: 'definitely-not-ffprobe-xyz',
    });
    const error = await missing
      .probeUpload(fixtures.wav)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AudioProcessingError);
    expect(error).toMatchObject({ code: 'UNAVAILABLE' });
    expect((error as Error).message).not.toMatch(/definitely-not|[\\/]/);
  });

  it('on startup removes only its own leftover temp files', async () => {
    const own = join(
      service.workDir,
      'upload-00000000-0000-4000-8000-000000000000',
    );
    const foreign = join(service.workDir, 'keep-me.txt');
    await writeFile(own, 'x');
    await writeFile(foreign, 'x');
    await makeService(root).onModuleInit();
    const left = await readdir(service.workDir);
    expect(left).toContain('keep-me.txt');
    expect(left).not.toContain('upload-00000000-0000-4000-8000-000000000000');
    await rm(foreign);
  });

  it('cleanTag strips control characters and limits length', () => {
    expect(cleanTag(' a\u0000b‮c\n ')).toBe('a b c');
    expect(cleanTag('x'.repeat(300))).toHaveLength(200);
    expect(cleanTag('   ')).toBeNull();
  });
});
