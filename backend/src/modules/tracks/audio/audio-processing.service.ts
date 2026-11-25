import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../../config/env.validation.js';
import { ProcessError, runProcess } from './run-process.js';

export type AudioErrorCode =
  | 'UNSUPPORTED_FORMAT'
  | 'INVALID_AUDIO'
  | 'TOO_LONG'
  | 'TIMEOUT'
  | 'TRANSCODE_FAILED'
  | 'UNAVAILABLE';

const PUBLIC_MESSAGES: Record<AudioErrorCode, string> = {
  UNSUPPORTED_FORMAT:
    'Unsupported file: upload MP3, WAV, M4A/AAC, OGG or FLAC audio',
  INVALID_AUDIO: 'The file could not be read as audio',
  TOO_LONG: 'Audio is too long (maximum 3 hours)',
  TIMEOUT: 'Audio processing took too long',
  TRANSCODE_FAILED: 'Audio conversion failed',
  UNAVAILABLE: 'Audio processing is temporarily unavailable',
};

/** Safe to show to API clients: never contains paths, commands or tool output. */
export class AudioProcessingError extends Error {
  constructor(readonly code: AudioErrorCode) {
    super(PUBLIC_MESSAGES[code]);
    this.name = 'AudioProcessingError';
  }
}

/** ffprobe container name -> forced demuxer + short label. Anything else is rejected. */
const SUPPORTED_CONTAINERS: Record<string, { demuxer: string; label: string }> =
  {
    mp3: { demuxer: 'mp3', label: 'mp3' },
    wav: { demuxer: 'wav', label: 'wav' },
    flac: { demuxer: 'flac', label: 'flac' },
    ogg: { demuxer: 'ogg', label: 'ogg' },
    aac: { demuxer: 'aac', label: 'aac' },
    'mov,mp4,m4a,3gp,3g2,mj2': { demuxer: 'mov', label: 'm4a' },
  };
const SUPPORTED_CODECS = /^(mp3|aac|alac|flac|vorbis|opus|pcm_[a-z0-9]+)$/;

const MIN_DURATION_S = 1;
const MAX_DURATION_S = 3 * 60 * 60;

/** Output format for every track (matches the Liquidsoap stream). */
export const OUTPUT = {
  bitrate: '128k',
  sampleRate: 44_100,
  channels: 2,
} as const;

/**
 * Single-pass EBU R128 loudness normalisation to -16 LUFS / -1.5 dBTP, so tracks
 * play at similar volume. Single pass is fast but can slightly alter dynamics;
 * a two-pass (measure + linear) run would be more transparent at ~2x the time.
 */
const LOUDNORM_FILTER = 'loudnorm=I=-16:TP=-1.5:LRA=11';

export interface ProbedAudio {
  /** Short source label, e.g. "flac". */
  format: string;
  demuxer: string;
  durationMs: number;
  title: string | null;
  artist: string | null;
}

export interface TranscodedAudio {
  durationMs: number;
  sizeBytes: number;
}

interface FfprobeOutput {
  format?: {
    format_name?: string;
    duration?: string;
    tags?: Record<string, string>;
  };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    sample_rate?: string;
    channels?: number;
    bit_rate?: string;
    disposition?: { attached_pic?: number };
    tags?: Record<string, string>;
  }>;
}

/** Temp files we create: upload-<uuid> (Multer) and out-<uuid>.mp3. */
const TEMP_FILE = /^(upload|out)-[0-9a-f-]{36}(\.mp3)?$/;

export function resolveAudioWorkDir(
  config: ConfigService<EnvironmentVariables, true>,
): string {
  return join(
    config.get('AUDIO_TMP_DIR', { infer: true }) ?? tmpdir(),
    'cdr-radio-audio',
  );
}

export function newUploadFileName(): string {
  return `upload-${randomUUID()}`;
}

@Injectable()
export class AudioProcessingService implements OnModuleInit {
  private readonly logger = new Logger(AudioProcessingService.name);
  private readonly ffmpeg: string;
  private readonly ffprobe: string;
  private readonly timeoutMs: number;
  readonly workDir: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.ffmpeg = config.get('FFMPEG_PATH', { infer: true });
    this.ffprobe = config.get('FFPROBE_PATH', { infer: true });
    this.timeoutMs = config.get('FFMPEG_TIMEOUT_MS', { infer: true });
    this.workDir = resolveAudioWorkDir(config);
  }

  /** Creates the work dir and removes files left over by a previous crash (only our own file names). */
  async onModuleInit(): Promise<void> {
    await mkdir(this.workDir, { recursive: true });
    const leftovers = (await readdir(this.workDir)).filter((name) =>
      TEMP_FILE.test(name),
    );
    await this.removeTempFiles(
      ...leftovers.map((name) => join(this.workDir, name)),
    );
    if (leftovers.length > 0) {
      this.logger.warn(
        `Removed ${leftovers.length} leftover temporary audio file(s)`,
      );
    }
  }

  newOutputPath(): string {
    return join(this.workDir, `out-${randomUUID()}.mp3`);
  }

  async removeTempFiles(...paths: Array<string | undefined>): Promise<void> {
    await Promise.all(
      paths
        .filter((p): p is string => !!p)
        .map((p) => rm(p, { force: true }).catch(() => {})),
    );
  }

  /** Validates the real content (not the extension or MIME type) of an uploaded file. */
  async probeUpload(inputPath: string): Promise<ProbedAudio> {
    const info = await this.probe(inputPath);
    const container = SUPPORTED_CONTAINERS[info.format?.format_name ?? ''];
    if (!container) throw new AudioProcessingError('UNSUPPORTED_FORMAT');

    const streams = info.streams ?? [];
    const audio = streams.find((s) => s.codec_type === 'audio');
    const hasVideo = streams.some(
      (s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1,
    );
    if (!audio || hasVideo)
      throw new AudioProcessingError('UNSUPPORTED_FORMAT');
    if (!SUPPORTED_CODECS.test(audio.codec_name ?? '')) {
      throw new AudioProcessingError('UNSUPPORTED_FORMAT');
    }
    if (!(Number(audio.sample_rate) > 0) || !((audio.channels ?? 0) > 0)) {
      throw new AudioProcessingError('INVALID_AUDIO');
    }

    const durationS = Number(info.format?.duration);
    if (!Number.isFinite(durationS) || durationS < MIN_DURATION_S) {
      throw new AudioProcessingError('INVALID_AUDIO');
    }
    if (durationS > MAX_DURATION_S) throw new AudioProcessingError('TOO_LONG');

    const tags = { ...lowerKeys(audio.tags), ...lowerKeys(info.format?.tags) };
    return {
      format: container.label,
      demuxer: container.demuxer,
      durationMs: Math.round(durationS * 1000),
      title: cleanTag(tags.title),
      artist: cleanTag(tags.artist),
    };
  }

  /** Transcodes to MP3 128 kbps / 44.1 kHz / stereo, normalised, without source metadata. */
  async transcodeToMp3(
    inputPath: string,
    probed: ProbedAudio,
    outputPath: string,
  ): Promise<TranscodedAudio> {
    // prettier-ignore
    const args = [
      '-hide_banner', '-nostdin', '-v', 'error', '-y',
      '-protocol_whitelist', 'file',
      '-f', probed.demuxer, '-i', `file:${inputPath}`,
      '-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1',
      '-af', LOUDNORM_FILTER,
      '-ar', String(OUTPUT.sampleRate), '-ac', String(OUTPUT.channels),
      '-c:a', 'libmp3lame', '-b:a', OUTPUT.bitrate,
      '-threads', '1',
      '-f', 'mp3', `file:${outputPath}`,
    ];
    await this.exec(this.ffmpeg, args, 'TRANSCODE_FAILED');

    // Verify what was actually produced rather than trusting the exit code.
    const out = await this.probe(outputPath);
    const stream = out.streams?.find((s) => s.codec_type === 'audio');
    const durationS = Number(out.format?.duration);
    const ok =
      out.format?.format_name === 'mp3' &&
      stream?.codec_name === 'mp3' &&
      Number(stream.sample_rate) === OUTPUT.sampleRate &&
      stream.channels === OUTPUT.channels &&
      Number.isFinite(durationS) &&
      durationS >= MIN_DURATION_S;
    if (!ok) throw new AudioProcessingError('TRANSCODE_FAILED');

    const { size } = await stat(outputPath);
    return { durationMs: Math.round(durationS * 1000), sizeBytes: size };
  }

  private async probe(path: string): Promise<FfprobeOutput> {
    // prettier-ignore
    const args = [
      '-hide_banner', '-v', 'error',
      '-protocol_whitelist', 'file',
      '-print_format', 'json', '-show_format', '-show_streams',
      `file:${path}`,
    ];
    const { stdout } = await this.exec(this.ffprobe, args, 'INVALID_AUDIO');
    try {
      return JSON.parse(stdout) as FfprobeOutput;
    } catch {
      throw new AudioProcessingError('INVALID_AUDIO');
    }
  }

  private async exec(command: string, args: string[], failure: AudioErrorCode) {
    try {
      return await runProcess(command, args, { timeoutMs: this.timeoutMs });
    } catch (error) {
      if (!(error instanceof ProcessError)) throw error;
      if (error.kind === 'not_found') {
        this.logger.error(
          'FFmpeg/ffprobe executable not found (check FFMPEG_PATH / FFPROBE_PATH)',
        );
        throw new AudioProcessingError('UNAVAILABLE');
      }
      if (error.kind === 'timeout') {
        this.logger.warn(`Audio tool timed out after ${this.timeoutMs} ms`);
        throw new AudioProcessingError('TIMEOUT');
      }
      // Tool output stays in server logs (debug level) and is never returned to clients.
      this.logger.debug(
        `Audio tool failed (exit ${error.exitCode}): ${error.stderrTail}`,
      );
      throw new AudioProcessingError(failure);
    }
  }
}

function lowerKeys(
  tags: Record<string, string> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tags ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
}

/** Strips control characters and trims to the column size. */
export function cleanTag(value: string | undefined): string | null {
  const cleaned = value
    ?.replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return cleaned ? cleaned : null;
}
