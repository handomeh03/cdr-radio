/** Synthetic test audio generated with the host FFmpeg (no copyrighted material). */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runProcess } from '../../src/modules/tracks/audio/run-process.js';

export const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
export const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';

async function ffmpeg(args: string[]): Promise<void> {
  await runProcess(FFMPEG, ['-hide_banner', '-v', 'error', '-y', ...args], {
    timeoutMs: 60_000,
  });
}

const tone = (seconds: number, freq = 440) => [
  '-f',
  'lavfi',
  '-i',
  `sine=frequency=${freq}:duration=${seconds}:sample_rate=48000`,
];

export interface AudioFixtures {
  wav: string;
  flacTagged: string;
  m4a: string;
  ogg: string;
  mp3: string;
  shortWav: string;
  textAsMp3: string;
  videoMp4: string;
  hlsPlaylist: string;
}

/** Durations: 3 s for valid files; shortWav is 0.4 s (below the 1 s minimum). */
export async function createAudioFixtures(dir: string): Promise<AudioFixtures> {
  await mkdir(dir, { recursive: true });
  const f = (name: string) => join(dir, name);
  const fixtures: AudioFixtures = {
    wav: f('tone.wav'),
    flacTagged: f('tagged.flac'),
    m4a: f('tone.m4a'),
    ogg: f('tone.ogg'),
    mp3: f('tone.mp3'),
    shortWav: f('short.wav'),
    textAsMp3: f('not-audio.mp3'),
    videoMp4: f('video.mp4'),
    hlsPlaylist: f('playlist.mp3'),
  };

  await ffmpeg([...tone(3), '-ac', '1', fixtures.wav]);
  // prettier-ignore
  await ffmpeg([...tone(3, 330), '-metadata', 'title=Fixture Title', '-metadata', 'artist=Fixture Artist', fixtures.flacTagged]);
  await ffmpeg([...tone(3, 550), '-c:a', 'aac', '-b:a', '96k', fixtures.m4a]);
  await ffmpeg([...tone(3, 660), '-c:a', 'libvorbis', fixtures.ogg]);
  await ffmpeg([
    ...tone(3, 770),
    '-c:a',
    'libmp3lame',
    '-b:a',
    '192k',
    fixtures.mp3,
  ]);
  await ffmpeg([...tone(0.4), fixtures.shortWav]);
  // prettier-ignore
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10:duration=3', ...tone(3), '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', fixtures.videoMp4]);
  await writeFile(
    fixtures.textAsMp3,
    'This is plain text, not audio.\n'.repeat(500),
  );
  // An HLS playlist disguised as .mp3 that points at another local file.
  await writeFile(
    fixtures.hlsPlaylist,
    `#EXTM3U\n#EXT-X-TARGETDURATION:3\n#EXTINF:3,\n${fixtures.wav}\n#EXT-X-ENDLIST\n`,
  );
  return fixtures;
}
