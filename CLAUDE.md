CLAUDE.md — CDR Central Radio
Project-wide instructions for Claude Code. Read this file before planning or implementing changes.
The developer owns architecture decisions and deployment. Work only on approved phases.

1. Project Goal
Build a single-tenant centralized online radio system for CDR Group / Ghammas Baladi restaurants.
- Authorized admins upload licensed or test audio tracks, create and reorder playlists, select the active playlist, and manage one central radio station.
- Every restaurant branch opens the same listening URL and receives one continuous live stream.
- A branch joining late must receive audio from the current broadcast point, not restart the track from the beginning.
- Broadcasting continues even with zero listeners.
- Listeners should hear approximately the same section of audio; network and player buffering can introduce delays. Measure latency; never claim perfect synchronization.
- An authenticated chatbot that accepts playback commands is optional and last. It must not delay the core radio system.
- Use original, synthetic, test, or appropriately licensed audio. Do not add copyrighted music to the repository or demo without permission.
Assessment deadline and priority
The practical assessment deadline is November 26, 2026. Required submission evidence includes a working public listening link, tests on at least two devices, technical and architecture explanations, an operations guide, challenges/solutions, and documentation of AI usage.

Priority: Working live stream → reliable multi-device demo → essential admin functions → documentation and testing → UI polish → chatbot.

Out of scope: SaaS, multi-tenancy, organizations, billing, subscriptions, independent playlists per restaurant branch, and branch management unless specifically requested.
2. Non-Negotiable Architecture Decisions
1. The root application folders are backend/ and frontend/. Do not create an apps/ directory or rename these folders.
2. During local development, Next.js and NestJS run directly on Windows, not in Docker.
3. Local Docker Compose has exactly two services: liquidsoap and icecast. Do not add PostgreSQL, Next.js, NestJS, FFmpeg, or a third container.
4. PostgreSQL is externally hosted. The developer supplies DATABASE_URL through backend/.env. Never create a local PostgreSQL container or assume localhost is the database host.
5. Processed audio is stored in the private Cloudflare R2 bucket cdr-radio-tracks. PostgreSQL stores metadata/storage keys, not audio blobs.
6. FFmpeg and ffprobe are installed on the Windows host. NestJS invokes them via safe process execution (spawn or execFile with argument arrays). Check their availability rather than assuming they are missing.
7. Socket.IO transports state and metadata events, not audio. The live audio path is Liquidsoap → Icecast → listeners.
8. Keep secrets in environment variables; never include real keys, passwords, cookies, connection strings, or key screenshots in source control, logs, or documentation.
9. Make changes one explicitly approved phase at a time. Verify and report each phase before continuing.
10. Deployment and hosting are developer-owned and out of scope for Claude. Do not select hosting services, discuss hosting prices, configure deployment, create Render infrastructure, or ask deployment-related questions unless the developer explicitly requests that work. Keep application URLs/ports configurable so the developer can deploy it later.
11. Do not introduce VPS provisioning, Nginx, Caddy, Cloudflare Tunnel, or additional infrastructure on your own.
12. Inspect and preserve existing project files and scaffolds before making changes. Avoid unnecessary rewrites.
3. Technology Stack
Layer	Technology
Frontend	Next.js App Router, React, TypeScript, Tailwind CSS, shadcn/ui
Forms	React Hook Form, Zod, zodResolver
API data	One Axios instance, TanStack Query
Frontend auth	Context API (AuthProvider)
Backend	NestJS, TypeScript, REST APIs, DTO validation
Database	Externally hosted PostgreSQL, Prisma ORM
Authentication	JWT, bcrypt, role guards and decorators, HttpOnly cookie
File upload	Multer
Audio processing	FFmpeg and ffprobe
Object storage	Cloudflare R2 using S3-compatible AWS SDK
Playback automation	Liquidsoap
Stream distribution	Icecast
Real-time metadata	Socket.IO
Local infrastructure	Docker Compose: Liquidsoap and Icecast only


Use versions compatible with the actual installed project, not assumptions from older tutorials. Check package compatibility before installation. Respect existing ESM/TypeScript/Next.js conventions.
4. Repository Structure
Use this as the architectural target. Create folders as needed when implementing a feature; do not create unnecessary empty placeholders.
cdr-radio-system/
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── app/                    # App Router routes, layouts, providers
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   │   ├── components/
│   │   │   │   ├── hooks/
│   │   │   │   ├── services/
│   │   │   │   ├── schemas/
│   │   │   │   └── types/
│   │   │   ├── tracks/
│   │   │   ├── playlists/
│   │   │   ├── stations/
│   │   │   ├── playback/
│   │   │   └── chatbot/            # Optional, last
│   │   ├── components/
│   │   │   ├── ui/                 # Shared UI primitives
│   │   │   └── shared/             # Loader, modal, empty/error states
│   │   ├── hooks/                  # Shared hooks ONLY
│   │   ├── store/                  # AuthContext / providers
│   │   ├── config/                 # Axios, TanStack Query, env, Socket.IO
│   │   ├── lib/
│   │   └── types/                  # Shared types ONLY
│   ├── next.config.ts
│   └── .env.example
├── backend/
│   ├── prisma.config.ts
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── models/                 # Multi-file Prisma models
│   │   ├── migrations/
│   │   └── seed.ts
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/               # guards/, decorators/, dto/, etc.
│   │   │   ├── users/
│   │   │   ├── tracks/
│   │   │   ├── playlists/
│   │   │   ├── stations/
│   │   │   ├── playback/
│   │   │   ├── streaming/
│   │   │   ├── realtime/
│   │   │   ├── storage/            # Add only when R2 is implemented
│   │   │   └── chatbot/            # Optional, last
│   │   ├── database/               # Global DatabaseModule, PrismaService
│   │   ├── security/               # SecurityModule, JWT and Hash services
│   │   ├── common/                 # Filters, pipes, interceptors
│   │   ├── config/
│   │   ├── app.module.ts
│   │   └── main.ts
│   └── .env.example
├── streaming/
│   ├── liquidsoap/                 # radio.liq and Docker config
│   └── icecast/                    # Icecast config and Docker config
├── docs/                           # Requirements, architecture, tests, AI log
├── docker-compose.yml              # Exactly liquidsoap + icecast
├── .env.example                    # Streaming Compose vars only
├── .gitignore
├── CLAUDE.md
└── README.md
Repository hygiene
- Preserve the current backend/ and frontend/ scaffolds; inspect before changing code.
- Use one Git repository at project root. If a nested .git exists, inspect it and only remove it with explicit developer approval.
- Ignore all .env and secret-bearing files while allowing .env.example to be tracked.
- Never commit cloudflareKeys.png or any screenshot showing credentials. If exposed credentials are found, tell the developer to rotate them.
- On Windows, ensure shell scripts and Liquidsoap/Icecast configuration use appropriate LF line endings where required.
5. Frontend Rules — Feature-Based Next.js
Feature ownership
- Every feature owns its components/, hooks/, services/, schemas/, and types/ as needed.
- src/hooks/ is for reusable shared hooks, not feature-specific hooks.
- src/components/shared/ is for reusable project components. src/components/ui/ contains UI primitives such as Button, Input, Select, Dialog, and similar shadcn components.
- src/types/ is for shared types, not feature-owned types.
- Keep business logic in hooks/services, not in large page components.
- Use Server Components by default where appropriate; use Client Components for forms, player controls, React hooks, and real-time behavior.
- Respect the installed Next.js version and existing App Router settings. Read relevant local Next.js documentation if the project instructions require it.
Axios, proxy, cookies, and API state
- Use exactly one application Axios instance: frontend/src/config/axios.ts.
- The browser Axios baseURL must be /api, supplied via NEXT_PUBLIC_API_URL=/api.
- Configure a Next.js rewrite from /api/:path* to ${API_PROXY_TARGET}/:path* using a server-only API_PROXY_TARGET (local value: http://localhost:4000).
- Do not expose API_PROXY_TARGET as NEXT_PUBLIC_*.
- Register request/response interceptors once, centrally, not in each feature.
- Use withCredentials where appropriate, and rely on the browser-managed HttpOnly authentication cookie; never read JWT from JavaScript or store it in localStorage/sessionStorage.
- Handle 401 responses without redirect loops; initial /auth/me returning 401 means unauthenticated, not an infinite refresh cycle.
- The /api rewrite is for REST calls; Socket.IO and the audio stream use their separately configured public URLs. Do not assume a Next.js REST rewrite automatically handles WebSocket upgrades.
- Feature services call the shared Axios instance. Feature hooks use TanStack Query for server-state fetching, mutations, cache keys, and invalidation.
- Never duplicate server data in Context when TanStack Query already owns it.
Forms and shared state
- Use React Hook Form with Zod schemas and zodResolver for forms and helpful validation messages.
- Use AuthContext / AuthProvider under src/store/ to expose user, auth status, login, logout, and /auth/me rehydration on refresh.
- Display a loading state while checking the existing session; avoid showing protected pages before verification.
- Use reusable Loader, Modal/ConfirmDialog, EmptyState, ErrorState, Button, Input, and toast components; show clear success/error feedback.
- Keep accessible labels, keyboard interaction, loading states, empty states, and error states.
Public radio player
- The listening page is public and requires no admin login.
- The <audio> element connects to the Icecast live mount, not a direct MP3 from R2.
- Provide a Play control because browsers may block unprompted autoplay.
- On reconnect or resume, rejoin the live stream rather than replaying old buffered content; test actual behavior.
- Show the current track metadata and stream status without exposing private admin controls.
6. Backend Rules — Modular NestJS
Global DatabaseModule
- Create backend/src/database/database.module.ts decorated with @Global().
- Provide and export one PrismaService from the database module.
- Import DatabaseModule once into AppModule; inject PrismaService wherever needed without reimporting the module in every feature.
- Use the externally hosted DATABASE_URL. Never create a PostgreSQL container.
- Implement Prisma initialization/shutdown and adapter configuration for the installed Prisma version. Do not create duplicate Prisma clients.
SecurityModule — two focused services
Create backend/src/security/security.module.ts with:
1. jwt.service.ts → JwtTokenService using the NestJS JWT library for signing and verifying tokens.
2. hash.service.ts → HashService using bcrypt for hashing and verifying passwords.
Export both services for use by AuthModule. Do not duplicate JWT or password-hashing code in other modules. Read issuer, audience, expiration, and hash cost from validated configuration when required.
AuthModule
- Create backend/src/modules/auth/ with controller, service, DTOs, guards/, decorators/, and other necessary files.
- Implement admin login/logout and GET /auth/me.
- Implement JWT authentication guard and role-based authorization using @Roles() and @CurrentUser() decorators.
- Use an HttpOnly cookie as the agreed authentication transport, issued by NestJS and accessed through the Next.js same-origin /api rewrite.
- Set sensible Secure, SameSite, path, expiration, and CORS settings per environment. Since cookies authenticate state-changing requests, provide an appropriate CSRF defense and validate Origin where applicable.
- Protect API endpoints in NestJS; hiding dashboard pages in the frontend is not an authorization boundary.
- Do not invent refresh-token flows unless explicitly requested and tested.
General conventions
- Use one NestJS module per domain feature; controllers handle HTTP transport, services contain business logic, DTOs use class-validator.
- Use dependency injection, clear typed service contracts, and standard NestJS exception classes.
- Enable global ValidationPipe with whitelist, forbidNonWhitelisted, and transform where appropriate.
- Validate required environment variables at startup. Provide safe structured error responses, proper HTTP status codes, and centralized exception handling.
- Configure CORS deliberately; rate-limit login and sensitive administrative operations.
- Do not log credentials, R2 URLs containing signatures, JWTs, cookies, or raw secrets.
- Keep streaming-control endpoints private and authenticated with a shared internal token or another verified secure mechanism.
- Never expose Liquidsoap/Icecast admin/source passwords to the public frontend.
Upload and audio processing
The upload pipeline is:

Admin → NestJS/Multer → ffprobe validation → FFmpeg conversion → private R2 → PostgreSQL metadata
- Check file size, format, and actual audio streams; never trust filename extension alone.
- Invoke FFmpeg/ffprobe using spawn or execFile with fixed argument arrays; never concatenate untrusted shell strings.
- Process with configurable timeout and resource limits; standardize playable audio output (e.g., MP3 at a consistent bitrate).
- Use temporary files only for processing; delete them in success and failure paths.
- Save storageKey, file format, size/duration, status, and relevant metadata in PostgreSQL; do not store the binary file in the DB.
- Keep the R2 bucket private. Use the backend or short-lived presigned URLs for authorized playback sourcing. Never expose signed private object URLs in public logs or responses.
Prisma schema and seed
- Use a multi-file Prisma schema under backend/prisma/models/, with root backend/prisma/schema.prisma and version-appropriate backend/prisma.config.ts pointing at the schema directory.
- Core models: User, Track, Playlist, PlaylistTrack, Station, StationPlayback.
- Add PlaybackHistory when implementing audit/history. Add ChatCommand only when implementing chatbot commands.
- PlaylistTrack is the ordered many-to-many association between playlist and track and must support stable ordering.
- Station stores station identity and selected playlist. StationPlayback stores playback metadata/cursor, not an audio stream.
- Support a single initial station (main), but keep the schema clean enough to support more stations in the future.
- Create backend/prisma/seed.ts for the initial station and admin; make it idempotent where possible. Read seed credentials from environment variables, never hardcode a password.
- Never execute destructive migrations, resets, db push, or seeds against the hosted database without explicit developer approval. Show commands and targeted database before running them.
7. Audio Architecture and Playback Control
 Admin dashboard (Next.js)
       |
       v
 NestJS REST API --------------> PostgreSQL (track/playlist/playback metadata)
       |-----------------------> Cloudflare R2 (processed track objects)
       |-----------------------> Liquidsoap (authenticated playback commands)
       |
       +-----------------------> Socket.IO (now-playing metadata only)

 Liquidsoap (continuous playlist + encoding)
       |
       v
 Icecast (one live streaming mount)
       |
       +-----------------------> Branch A / Branch B / Branch C
Playback rules
- Liquidsoap continuously produces a single audio source and sends it to Icecast.
- Icecast distributes the current live bytes to every connected listener. Late listeners do not restart the MP3 file.
- NestJS controls playlists/track requests through an authenticated private control interface.
- For local development: Liquidsoap and Icecast communicate on their Docker Compose service network. Containers reach the host NestJS API via host.docker.internal:4000 where appropriate; host code reaches specifically published container ports.
- Do not expose Liquidsoap's control API publicly. Bind published control ports to loopback where feasible and require authentication. Any Liquidsoap HTTP control/event API design must be verified against the installed version before implementation.
- A DB update is not proof that audio changed. Confirm the actual playback transition using Liquidsoap events/logs or verified acknowledgments, and handle failures/restarts.
- Preserve playback continuity across listener joins. Use a safe fallback source if the active playlist is empty or external services temporarily fail.
- Prefer a minimal tested next-track mechanism first; do not build advanced prefetch, override, or resume logic until the core stream works.
- When optional chatbot override is implemented, save the current playlist track and offset, play the requested item for all branches, then resume the original playlist near the saved point after the override ends.
- Socket.IO only updates now-playing/status UI. The stream should remain listenable even if Socket.IO disconnects.
- Test how browser buffering affects live-edge joining and synchronization. Never claim zero latency.
8. Environment Variables and Secrets
Create complete, synchronized .env.example files with placeholders. Only include values in the correct scope; actual .env files are local and Git-ignored.
Root .env.example — streaming Docker Compose
ICECAST_PORT=8000
ICECAST_HOSTNAME=localhost
ICECAST_SOURCE_PASSWORD=REPLACE_WITH_STRONG_SECRET
ICECAST_ADMIN_PASSWORD=REPLACE_WITH_STRONG_SECRET
ICECAST_RELAY_PASSWORD=REPLACE_WITH_STRONG_SECRET
LIQUIDSOAP_CONTROL_PORT=1234
API_INTERNAL_URL=http://host.docker.internal:4000
STREAM_INTERNAL_TOKEN=REPLACE_WITH_STRONG_SECRET
LIQUIDSOAP_CONTROL_TOKEN=REPLACE_WITH_STRONG_SECRET
backend/.env.example — NestJS
NODE_ENV=development
PORT=4000
FRONTEND_URL=http://localhost:3000
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require
JWT_SECRET=REPLACE_WITH_LONG_RANDOM_SECRET
JWT_EXPIRES_IN=15m
AUTH_COOKIE_NAME=cdr_access_token
BCRYPT_SALT_ROUNDS=12
SEED_ADMIN_EMAIL=admin@example.test
SEED_ADMIN_PASSWORD=REPLACE_WITH_STRONG_PASSWORD
R2_ACCOUNT_ID=YOUR_ACCOUNT_ID
R2_ACCESS_KEY_ID=YOUR_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY=YOUR_SECRET_ACCESS_KEY
R2_BUCKET_NAME=cdr-radio-tracks
R2_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
AUDIO_TMP_DIR=
AUDIO_UPLOAD_MAX_MB=25
FFMPEG_TIMEOUT_MS=120000
ICECAST_PUBLIC_URL=http://localhost:8000/radio.mp3
LIQUIDSOAP_CONTROL_HOST=127.0.0.1
LIQUIDSOAP_CONTROL_PORT=1234
STREAM_INTERNAL_TOKEN=REPLACE_WITH_SAME_SECRET_AS_ROOT
LIQUIDSOAP_CONTROL_TOKEN=REPLACE_WITH_SAME_SECRET_AS_ROOT
# AI_API_KEY=ONLY_WHEN_CHATBOT_IS_ADDED
DATABASE_URL is illustrative: the developer provides the actual hosted database URL and provider-required SSL/connection parameters. Keep AUDIO_TMP_DIR optional when the operating system temporary folder is used.
frontend/.env.example — Next.js
# Browser REST requests go through the Next.js same-origin /api rewrite.
NEXT_PUBLIC_API_URL=/api
# Server-only rewrite destination, not NEXT_PUBLIC.
API_PROXY_TARGET=http://localhost:4000
# Real-time metadata connection (separate from the REST rewrite).
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
# Public live listening stream, never a direct R2 object URL.
NEXT_PUBLIC_STREAM_URL=http://localhost:8000/radio.mp3
Environment rules
- Generate strong unique values for real secrets. Never reuse placeholder values in production.
- Keep STREAM_INTERNAL_TOKEN and LIQUIDSOAP_CONTROL_TOKEN synchronized between root and backend environments; the actual names/need will be confirmed with the implemented control protocol.
- The NEXT_PUBLIC_* prefix is only for values safe to expose to browsers. Never place secrets or private object URLs there.
- Any newly needed setting must be documented in the appropriate .env.example in the same phase in which it is used.
- Use configured ports/URLs, not hardcoded production endpoints.
- Do not print or commit real .env files or screenshots containing secret values.
9. Deployment Ownership — Not an Implementation Phase
The developer alone decides, configures, and performs deployment and hosting.
- Do not create Render services, hosting accounts, provisioning scripts, domain records, proxy infrastructure, or deployment configurations unless explicitly requested.
- Do not ask about deployment providers, service prices, hosting topology, domains, or HTTPS while developing the core application.
- Keep the application portable: read base URLs and ports from environment variables; avoid dependencies on local-only paths other than documented development tooling.
- When the developer asks for deployment help, explain only the requested setup and verify provider-specific limitations rather than guessing.
- The assessment still requires a publicly reachable listening link, but preparing and deploying that link is the developer's responsibility. Never claim a public URL is ready until it has been verified.
10. Work Process, Phase Gates, and Reporting
Plan Mode
When asked to PLAN ONLY:
1. Read this file and inspect the existing repository.
2. Produce a concise, numbered implementation plan with dependencies, risks, and tests.
3. Do not create, edit, move, or delete project files, install packages, run migrations, or execute implementation commands.
4. Do not reopen architecture decisions already confirmed here.
5. Do not ask deployment questions; deployment is outside Claude's scope.
6. Wait for explicit developer approval before implementation.
Recommended implementation sequence
1. Repository baseline: inspect scaffolds, confirm paths and Git hygiene, verify FFmpeg, protect existing secrets. Obtain approval before deleting nested Git metadata.
2. Streaming proof of concept: Docker Compose with only Liquidsoap and Icecast; synthetic licensed-free test audio; demonstrate ongoing live stream and a late join on two devices.
3. Backend foundation: global DatabaseModule, Prisma models/config, SecurityModule, AuthModule, startup validation, migrations/seed only after approval.
4. Content and playback: Multer → FFmpeg → R2, Tracks/Playlists/Station APIs, Liquidsoap control, verified playback state.
5. Frontend: feature-based dashboard, login/session restoration, public radio player, Axios rewrite, TanStack Query, React Hook Form, Zod.
6. Real-time metadata: Socket.IO now-playing/status updates if time permits; polling is an acceptable MVP fallback.
7. Testing and documentation: prove multi-device playback, listener continuity, track transitions, error handling, and recovery; record README.md, architecture, operations, testing, and AI usage.
8. Optional chatbot last: authorized playback commands and resume behavior, only after the core requirements work.
Deployment is NOT a Claude implementation phase. The developer handles it separately.
Required report after each approved phase
State:
- Files created/modified.
- Exact commands executed and their results.
- What was actually tested, what passed, and what remains unverified.
- Any environment variable additions or changes.
- Blockers or security concerns.
- One minimal recommended next phase; do not implement it automatically.
Maintain docs/AI_USAGE_LOG.md with the actual prompts, AI tools, implementation decisions, failures, and fixes for the assessment. Do not invent testing outcomes or work that was not performed.
Final rule: Follow the developer's instructions, keep the codebase simple, prioritize a real continuous audio stream, and never silently change the agreed architecture.