import { spawn } from 'node:child_process';

export interface ProcessResult {
  stdout: string;
  /** Last few KB of stderr, for server-side logs only. */
  stderrTail: string;
}

export class ProcessError extends Error {
  constructor(
    readonly kind: 'not_found' | 'timeout' | 'exit' | 'output_too_large',
    readonly exitCode: number | null,
    readonly stderrTail: string,
  ) {
    super(`process failed: ${kind}`);
    this.name = 'ProcessError';
  }
}

const STDERR_TAIL_BYTES = 4_096;

/**
 * Runs an executable with an argument array (no shell, so no interpolation or injection),
 * a hard timeout and a cap on captured stdout.
 */
export function runProcess(
  command: string,
  args: readonly string[],
  options: { timeoutMs: number; maxStdoutBytes?: number },
): Promise<ProcessResult> {
  const maxStdout = options.maxStdoutBytes ?? 2 * 1024 * 1024;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrTail = '';
    let failure: ProcessError | null = null;

    const timer = setTimeout(() => {
      failure = new ProcessError('timeout', null, stderrTail);
      child.kill('SIGKILL');
    }, options.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdout) {
        failure ??= new ProcessError('output_too_large', null, stderrTail);
        child.kill('SIGKILL');
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(
        -STDERR_TAIL_BYTES,
      );
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        new ProcessError(
          error.code === 'ENOENT' ? 'not_found' : 'exit',
          null,
          stderrTail,
        ),
      );
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      if (code !== 0) return reject(new ProcessError('exit', code, stderrTail));
      resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderrTail });
    });
  });
}
