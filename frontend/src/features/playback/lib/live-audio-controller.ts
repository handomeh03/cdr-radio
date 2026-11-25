/**
 * Plays the live Icecast stream through one HTMLAudioElement.
 *
 * Rules this class enforces:
 * - Nothing plays before `play()` is called from a user gesture (no autoplay).
 * - Pausing unloads the stream (the connection is closed), and playing again opens a fresh
 *   connection, so the listener always rejoins the live edge instead of stale buffered audio.
 * - While the listener wants audio, failures and sustained stalls are retried with a bounded
 *   backoff. Only one retry can be pending; pause, unmount and a new connection invalidate
 *   everything still in flight.
 * - The audio state reflects real media-element events, not the now-playing metadata.
 */

export type ListenPhase =
  /** The listener has not started, or has paused. Nothing is loaded. */
  | "idle"
  /** Opening the connection; no audio yet. */
  | "connecting"
  /** Audio was playing and is waiting for data. */
  | "buffering"
  /** Audio is playing. */
  | "playing"
  /** The connection failed; waiting to retry. */
  | "reconnecting"
  /** Retries are used up. Manual retry required. */
  | "failed"
  /** The browser refused to start playback. Manual start required. */
  | "blocked";

export interface LiveAudioState {
  phase: ListenPhase;
  /** Retry number in progress (1-based) while reconnecting; 0 otherwise. */
  attempt: number;
  maxAttempts: number;
  /** Milliseconds until the next automatic retry while reconnecting. */
  retryInMs: number | null;
  volume: number;
  muted: boolean;
  /** False where the platform ignores `audio.volume` (iOS): the device buttons control it. */
  volumeSupported: boolean;
}

export interface LiveAudioOptions {
  streamUrl: string | null;
  /** Wait before automatic retry 1, 2, ...; its length is the maximum number of retries. */
  retryDelaysMs?: readonly number[];
  /** No audio this long after opening the connection counts as a failure. */
  connectTimeoutMs?: number;
  /** Still buffering this long after audio stopped counts as a failure. */
  stallTimeoutMs?: number;
  /** Playing continuously this long resets the retry counter. */
  stableAfterMs?: number;
}

export const DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 15_000] as const;

type Listener = () => void;

export class LiveAudioController {
  private readonly streamUrl: string | null;
  private readonly retryDelays: readonly number[];
  private readonly connectTimeoutMs: number;
  private readonly stallTimeoutMs: number;
  private readonly stableAfterMs: number;

  private audio: HTMLAudioElement | null = null;
  private listeners = new Set<Listener>();
  private state: LiveAudioState;

  /** True from play() until pause()/unmount: the only time automatic retries are allowed. */
  private wantsAudio = false;
  private attempt = 0;
  /** Incremented for every new connection or teardown; callbacks from older ones are ignored. */
  private connectionId = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: LiveAudioOptions) {
    this.streamUrl = options.streamUrl;
    this.retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 15_000;
    this.stallTimeoutMs = options.stallTimeoutMs ?? 10_000;
    this.stableAfterMs = options.stableAfterMs ?? 10_000;
    this.state = {
      phase: "idle",
      attempt: 0,
      maxAttempts: this.retryDelays.length,
      retryInMs: null,
      volume: 1,
      muted: false,
      volumeSupported: true,
    };
  }

  // ---- external store contract (useSyncExternalStore) -----------------------------------------

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LiveAudioState => this.state;

  // ---- element lifecycle -------------------------------------------------------------------------

  /** Binds the single audio element. Returns the cleanup that fully releases it. */
  attach = (audio: HTMLAudioElement | null): (() => void) | void => {
    if (!audio) return;
    this.audio = audio;

    // iOS ignores `volume` writes, so detect that instead of showing a slider that does nothing.
    const previous = audio.volume;
    audio.volume = 0.5;
    const volumeSupported = audio.volume === 0.5;
    audio.volume = previous;
    this.patch({ volume: audio.volume, muted: audio.muted, volumeSupported });

    const handlers: Array<[string, EventListener]> = [
      ["playing", this.onPlaying],
      ["waiting", this.onWaiting],
      ["stalled", this.onWaiting],
      ["error", this.onError],
      ["ended", this.onEnded],
      ["pause", this.onPause],
      ["volumechange", this.onVolumeChange],
    ];
    for (const [type, handler] of handlers) audio.addEventListener(type, handler);
    window.addEventListener("online", this.onOnline);

    return () => {
      for (const [type, handler] of handlers) audio.removeEventListener(type, handler);
      window.removeEventListener("online", this.onOnline);
      this.wantsAudio = false;
      this.attempt = 0;
      this.teardown();
      // The page can stay mounted but hidden after navigation; it must not come back claiming "Live".
      this.patch({ phase: "idle", attempt: 0, retryInMs: null });
      this.audio = null;
    };
  };

  // ---- commands ------------------------------------------------------------------------------------

  /** Start (or restart) listening. Call from a click/tap handler so the browser allows audio. */
  play = (): void => {
    if (!this.audio || !this.streamUrl) return;
    this.wantsAudio = true;
    this.attempt = 0;
    this.connect();
  };

  /** Stop listening and unload the stream. Cancels any pending retry. */
  pause = (): void => {
    this.wantsAudio = false;
    this.attempt = 0;
    this.teardown();
    this.patch({ phase: "idle", attempt: 0, retryInMs: null });
  };

  setVolume = (volume: number): void => {
    if (!this.audio) return;
    this.audio.volume = Math.min(1, Math.max(0, volume));
    if (volume > 0 && this.audio.muted) this.audio.muted = false;
  };

  toggleMuted = (): void => {
    if (this.audio) this.audio.muted = !this.audio.muted;
  };

  // ---- connection management ------------------------------------------------------------------

  private connect(): void {
    const audio = this.audio;
    if (!audio || !this.streamUrl) return;
    this.clearTimers();
    const id = ++this.connectionId;
    this.patch({ phase: this.attempt > 0 ? "reconnecting" : "connecting", attempt: this.attempt, retryInMs: null });

    // A fresh URL per connection keeps a browser from serving the earlier response again.
    const url = new URL(this.streamUrl, window.location.href);
    url.searchParams.set("live", String(Date.now()));
    audio.src = url.toString();

    const started = audio.play();
    started?.catch((error: unknown) => {
      if (id !== this.connectionId) return; // superseded by a newer connection or a pause
      const name = error instanceof DOMException ? error.name : "";
      if (name === "AbortError") return; // interrupted by our own teardown or a new source
      if (name === "NotAllowedError") {
        // The browser needs a user gesture. Stop retrying and ask for one.
        this.wantsAudio = false;
        this.teardown();
        this.patch({ phase: "blocked", attempt: 0, retryInMs: null });
        return;
      }
      this.fail();
    });
    this.watchdogTimer = setTimeout(() => {
      if (id === this.connectionId) this.fail();
    }, this.connectTimeoutMs);
  }

  /** Close the connection and cancel everything still in flight for it. */
  private teardown(): void {
    this.connectionId++;
    this.clearTimers();
    const audio = this.audio;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load(); // aborts the download so Icecast sees the listener leave
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.retryTimer = this.watchdogTimer = this.stableTimer = null;
  }

  /** The current connection is unusable: retry with backoff, or give up after the last attempt. */
  private fail(): void {
    if (!this.wantsAudio || this.retryTimer) return; // paused, or a retry is already pending
    this.teardown();
    this.attempt += 1;
    if (this.attempt > this.retryDelays.length) {
      this.wantsAudio = false;
      this.patch({ phase: "failed", attempt: 0, retryInMs: null });
      return;
    }
    const delay = this.retryDelays[this.attempt - 1];
    this.patch({ phase: "reconnecting", attempt: this.attempt, retryInMs: delay });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.wantsAudio) this.connect();
    }, delay);
  }

  // ---- media element events ---------------------------------------------------------------------

  private readonly onPlaying = (): void => {
    if (!this.wantsAudio) return;
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = null;
    this.patch({ phase: "playing", retryInMs: null });
    // Only a connection that stays up resets the counter, so a flapping stream cannot retry forever.
    if (this.attempt > 0 && !this.stableTimer) {
      this.stableTimer = setTimeout(() => {
        this.attempt = 0;
        this.stableTimer = null;
        this.patch({ attempt: 0 });
      }, this.stableAfterMs);
    }
  };

  private readonly onWaiting = (): void => {
    if (!this.wantsAudio || this.state.phase !== "playing") return;
    this.patch({ phase: "buffering" });
    const id = this.connectionId;
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(() => {
      if (id === this.connectionId) this.fail();
    }, this.stallTimeoutMs);
  };

  private readonly onError = (): void => {
    if (!this.audio?.getAttribute("src")) return; // our own teardown, not a stream error
    this.fail();
  };

  private readonly onEnded = (): void => {
    // A live stream never ends on its own: the server dropped the connection.
    if (this.audio?.getAttribute("src")) this.fail();
  };

  private readonly onPause = (): void => {
    // A pause we did not ask for (headset button, OS media controls) is the listener stopping.
    // When a stream ends the browser also fires `pause` (just before `ended`): that is the server
    // closing the connection, which `onEnded` retries, not the listener stopping.
    const audio = this.audio;
    if (this.wantsAudio && audio?.getAttribute("src") && audio.paused && !audio.ended) this.pause();
  };

  private readonly onVolumeChange = (): void => {
    if (this.audio) this.patch({ volume: this.audio.volume, muted: this.audio.muted });
  };

  private readonly onOnline = (): void => {
    // The network came back: do not wait out the rest of the backoff.
    if (this.wantsAudio && this.state.phase === "reconnecting") {
      this.attempt = Math.max(0, this.attempt - 1);
      this.connect();
    }
  };

  // ---- state ----------------------------------------------------------------------------------------

  private patch(partial: Partial<LiveAudioState>): void {
    const next = { ...this.state, ...partial };
    if ((Object.keys(next) as Array<keyof LiveAudioState>).every((key) => next[key] === this.state[key])) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}
