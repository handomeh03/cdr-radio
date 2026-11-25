# CDR Central Radio — playout (Liquidsoap 2.4.6).
#
#   NestJS (scheduler)  --GET /internal/stream/next-->  Liquidsoap (player)  -->  Icecast /radio.mp3
#   Liquidsoap          --POST /internal/stream/events--> NestJS (confirmed starts + heartbeat)
#   NestJS              --POST /control/{skip,reload}--> Liquidsoap (token, 127.0.0.1 only)
#
# A local synthetic tone is the safety source whenever there is nothing to play (no playlist,
# OFF_AIR, backend or R2 unreachable). The stream itself never stops.

settings.log.stdout := true
settings.log.file := false
settings.log.level := 3
settings.server.telnet := false

def required_env(name) =
  value = environment.get(name)
  if value == "" then
    log.critical(label="cdr", "#{name} is not set")
    shutdown()
  end
  value
end

icecast_host = environment.get(default="icecast", "ICECAST_HOST")
source_password = required_env("ICECAST_SOURCE_PASSWORD")
api_url = environment.get(default="http://host.docker.internal:4000", "API_INTERNAL_URL")
stream_token = required_env("STREAM_INTERNAL_TOKEN")
control_token = required_env("LIQUIDSOAP_CONTROL_TOKEN")
control_port = string.to_int(default=1234, environment.get(default="1234", "LIQUIDSOAP_CONTROL_PORT"))

api_headers = [("Authorization", "Bearer #{stream_token}"), ("Content-Type", "application/json")]

# Presigned R2 URLs are already correctly encoded; normalizing them only produces log lines that
# would contain the URL (and its signature).
settings.http.normalize_url := false

# "cdr:<presigned url>": downloads the private object to a temporary file (deleted after it is
# played) without Liquidsoap's generic HTTP protocol, which logs full URLs. Logs status only.
def cdr_download(~rlog, ~maxtime, presigned) =
  local_file = file.temp("cdr-track-", ".mp3")
  try
    response = http.get(normalize_url=false, timeout=max(1., maxtime - time()), presigned)
    if response.status_code == 200 then
      written = ref(false)
      file.write(
        data=fun () -> if written() then null else begin written := true; "#{response}" end end,
        local_file
      )
      local_file
    else
      rlog("audio download failed: HTTP #{response.status_code}")
      file.remove(local_file)
      null
    end
  catch err do
    rlog("audio download failed (#{err.kind})")
    file.remove(local_file)
    null
  end
end

protocol.add(
  "cdr",
  cdr_download,
  temporary=true,
  syntax="cdr:<presigned https url>",
  doc="Download a private track through its short-lived presigned URL."
)

# ---------------------------------------------------------------------------------------------
# State (in memory; NestJS keeps the durable record)
# ---------------------------------------------------------------------------------------------

# Playlist item of the last request queued successfully. NestJS returns the item AFTER it, so a
# failed or dropped request never advances the playlist. "" = let NestJS use its last confirmed one.
last_item = ref("")
# Consecutive resolution failures of the same item; after 3 the item is passed over (reported).
failures = ref(0)
# Bumped by /control/reload so a request fetched before the reload is discarded, not queued.
generation = ref(0)
# Seconds before request.dynamic asks again when nothing was returned.
idle_delay = ref(5.)

# What is actually on the output right now (set on every track mark of the final source).
on_air_source = ref("fallback")
on_air_occurrence = ref("")
on_air_item = ref("")
on_air_track = ref("")
on_air_started = ref(time())

# ---------------------------------------------------------------------------------------------
# Reporting to NestJS (bounded timeouts; failures are logged, never fatal)
# ---------------------------------------------------------------------------------------------

def post_event(kind, extra) =
  payload = json.stringify(compact=true, {
    type = kind,
    source = on_air_source(),
    occurrenceId = on_air_occurrence(),
    itemId = on_air_item(),
    trackId = on_air_track(),
    startedAt = on_air_started(),
    detail = extra
  })
  try
    response = http.post(timeout=3., headers=api_headers, data=payload, "#{api_url}/internal/stream/events")
    if response.status_code != 200 then
      log.important(label="cdr", "Event #{kind} rejected: HTTP #{response.status_code}")
    end
  catch err do
    log.important(label="cdr", "Event #{kind} not delivered (#{err.kind})")
  end
end

def report_failure(occurrence, item, track_id, reason) =
  payload = json.stringify(compact=true, {
    type = "request_failed",
    source = "playlist",
    occurrenceId = occurrence,
    itemId = item,
    trackId = track_id,
    startedAt = time(),
    detail = reason
  })
  try
    ignore(http.post(timeout=3., headers=api_headers, data=payload, "#{api_url}/internal/stream/events"))
  catch _ do
    ()
  end
end

# ---------------------------------------------------------------------------------------------
# Playlist source: NestJS decides, Liquidsoap fetches and resolves (downloads) the presigned URL
# ---------------------------------------------------------------------------------------------

def next_request() =
  my_generation = generation()
  idle_delay := 5.
  try
    response = http.get(timeout=5., headers=api_headers, "#{api_url}/internal/stream/next?after=#{last_item()}")
    status = response.status_code
    if status == 204 then
      # Nothing to play (OFF_AIR, no playlist, no READY track): the fallback stays on air.
      idle_delay := 10.
      null
    elsif status != 200 then
      log.important(label="cdr", "Scheduler answered HTTP #{status}")
      null
    else
      let json.parse (item : {
        occurrenceId: string,
        itemId: string,
        trackId: string,
        title: string,
        artist: string,
        uri: string
      }) = response
      # The presigned URL is part of the request: never log `uri`.
      r = request.create(
        "annotate:title=#{string.quote(item.title)},artist=#{string.quote(item.artist)},cdr_occurrence=#{string.quote(item.occurrenceId)},cdr_item=#{string.quote(item.itemId)},cdr_track=#{string.quote(item.trackId)}:cdr:#{item.uri}"
      )
      if not request.resolve(timeout=30., r) then
        request.destroy(r)
        failures := failures() + 1
        log.important(label="cdr", "Could not fetch audio for item #{item.itemId} (attempt #{failures()})")
        report_failure(item.occurrenceId, item.itemId, item.trackId, "resolve failed, attempt #{failures()}")
        if failures() >= 3 then
          log.important(label="cdr", "Passing over item #{item.itemId} after 3 failed attempts")
          last_item := item.itemId
          failures := 0
        end
        null
      elsif my_generation != generation() then
        # A reload happened while this was being fetched: it is based on old settings.
        request.destroy(r)
        idle_delay := 0.5
        null
      else
        failures := 0
        last_item := item.itemId
        log.important(label="cdr", "Queued item #{item.itemId}: #{item.title}")
        r
      end
    end
  catch err do
    log.important(label="cdr", "Scheduler unreachable or bad reply (#{err.kind})")
    null
  end
end

playlist_queue = request.dynamic(
  id="playlist_queue",
  prefetch=1,
  retry_delay=idle_delay,
  next_request
)
# Request logs at level 3 include the resolved URI (a presigned URL): keep them out.
playlist_queue.log.level.set(2)

# ---------------------------------------------------------------------------------------------
# Safety source: original synthetic tone, labelled as standby for listeners
# ---------------------------------------------------------------------------------------------

tone_freqs = [220., 330., 440., 550.]
tone_step = ref(0)
standby = sine(id="standby", amplitude=0.08, {list.nth(tone_freqs, tone_step() mod list.length(tone_freqs))})
thread.run(every=15., fun () -> tone_step := tone_step() + 1)
thread.run(delay=1., fun () -> standby.insert_metadata([("title", "CDR Central Radio - standby"), ("artist", "")]))

# The playlist whenever it has a track ready; otherwise the standby tone. Switching is immediate
# (track_sensitive=false), so the station recovers as soon as NestJS/R2 answer again.
radio = fallback(id="radio", track_sensitive=false, [playlist_queue, standby])

# Every track mark on the final source is what listeners actually get: report it.
radio.on_track(synchronous=true, fun (m) -> begin
  occurrence = m["cdr_occurrence"]
  on_air_started := time()
  if occurrence != "" then
    on_air_source := "playlist"
    on_air_occurrence := occurrence
    on_air_item := m["cdr_item"]
    on_air_track := m["cdr_track"]
  else
    on_air_source := "fallback"
    on_air_occurrence := ""
    on_air_item := ""
    on_air_track := ""
  end
  thread.run(fast=false, fun () -> post_event("track_started", ""))
end)

# Heartbeat: repairs NestJS's view if a track_started event was lost; silence => UNKNOWN there.
thread.run(fast=false, every=15., fun () -> post_event("heartbeat", ""))

# ---------------------------------------------------------------------------------------------
# Private control interface (token; Docker publishes it on 127.0.0.1 only)
# ---------------------------------------------------------------------------------------------

def authorized(req) =
  headers = list.map(fun (h) -> (string.case(lower=true, fst(h)), snd(h)), req.headers)
  list.assoc(default="", "authorization", headers) == "Bearer #{control_token}"
end

def deny(response) =
  response.status_code(401)
  response.json({ok = false, error = "unauthorized"})
end

harbor.http.register(port=control_port, method="POST", "/control/skip", fun (req, response) -> begin
  if not authorized(req) then
    deny(response)
  else
    playing = on_air_source() == "playlist"
    if playing then playlist_queue.skip() end
    log.important(label="cdr", "Control: skip (skipped=#{playing})")
    response.json({ok = true, source = on_air_source(), skipped = playing})
  end
end)

# Drops prefetched requests and fetches the next one from the current settings, so a playlist or
# ON_AIR/OFF_AIR change takes effect at the next track boundary; ?skip=1 also ends the current track.
harbor.http.register(port=control_port, method="POST", "/control/reload", fun (req, response) -> begin
  if not authorized(req) then
    deny(response)
  else
    # Invalidate any fetch already in flight (it was based on the old settings).
    generation := generation() + 1
    # Continue from what is on air now (not from the prefetched item about to be dropped).
    last_item := if on_air_source() == "playlist" then on_air_item() else "" end
    failures := 0

    # Fetch the replacement BEFORE touching the queue: while the old prefetch is still queued the
    # source does not fetch on its own, so no duplicate can be queued in parallel. Then swap the
    # queue in one step and invalidate anything that started in the meantime.
    replacement = next_request()
    dropped = playlist_queue.queue()
    playlist_queue.set_queue(if null.defined(replacement) then [null.get(replacement)] else [] end)
    generation := generation() + 1
    list.iter(request.destroy, dropped)
    queued = null.defined(replacement)

    want_skip = list.assoc(default="", "skip", req.query) == "1"
    skipped = want_skip and on_air_source() == "playlist"
    if skipped then playlist_queue.skip() end
    log.important(label="cdr", "Control: reload (dropped #{list.length(dropped)}, queued #{queued}, skipped #{skipped})")
    response.json({
      ok = true,
      source = on_air_source(),
      flushed = list.length(dropped),
      queued = queued,
      skipped = skipped
    })
  end
end)

# ---------------------------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------------------------

output.icecast(
  %mp3(bitrate=128, samplerate=44100, stereo=true),
  id="icecast_out",
  host=icecast_host,
  port=8000,
  password=source_password,
  mount="radio.mp3",
  name="CDR Central Radio",
  description="Central radio for CDR Group / Ghammas Baladi branches",
  genre="Various",
  public=false,
  radio
)
