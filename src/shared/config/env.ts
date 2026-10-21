import { z } from 'zod';

/**
 * Every environment variable the application reads, validated once at boot.
 * Failing fast here (instead of discovering a missing var mid-request) is
 * the whole point — see docs/DEPLOYMENT.md.
 */
const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // No `.default()` here: whether an unset LOG_LEVEL means 'info' or 'silent'
  // depends on NODE_ENV (see the `.transform` below, which is the single
  // place that decides it) — see src/shared/logger/index.ts.
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),

  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  /** Maximum size of the Prisma connection pool. Defaults to 10 so that
   * containerized deployments with a single vCPU (where Prisma's default
   * `num_physical_cpus * 2 + 1` = 3) don't exhaust the pool under burst
   * traffic (see docs/DEPLOYMENT.md § Database Connection Pooling). */
  DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(10),

  /** Maximum time in seconds to wait for a connection from the pool before
   * Prisma raises P2024. */
  DATABASE_POOL_TIMEOUT: z.coerce.number().int().positive().default(10),

  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  CORS_ORIGIN: z
    .string()
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    )
    .refine((origins) => origins.length > 0, {
      message: 'CORS_ORIGIN must contain at least one origin',
    })
    .refine((origins) => !origins.includes('*'), {
      message:
        'CORS_ORIGIN must not be "*" — this backend always sets credentials: true, and a ' +
        'wildcard origin combined with credentials is an explicitly disallowed configuration ' +
        '(see docs/SECURITY.md § Baseline HTTP Security)',
    })
    .refine(
      (origins) =>
        origins.every((origin) => {
          try {
            return new URL(origin).origin === origin;
          } catch {
            return false;
          }
        }),
      {
        message:
          'Every CORS_ORIGIN entry must be a well-formed scheme+host+optional-port origin ' +
          '(e.g. "https://example.com"), with no path, query, or trailing slash',
      },
    ),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  STELLAR_NETWORK: z.enum(['testnet', 'futurenet', 'mainnet', 'standalone']).default('testnet'),
  SOROBAN_RPC_URL: z.string().url().default('https://soroban-testnet.stellar.org'),
  STELLAR_NETWORK_PASSPHRASE: z.string().default('Test SDF Network ; September 2015'),

  // `SETTLEMENT_CONTRACT_ID` deliberately does not exist here: settlement is
  // an unimplemented on-chain stub with no consuming module (see the same
  // exclusion in src/modules/indexer/index.ts and ROADMAP.md §9) — a config
  // variable with no reader is documentation debt CONTRIBUTING.md prohibits.
  // Re-add it when settlement_contract is actually implemented.
  ESCROW_CONTRACT_ID: z.string().optional(),
  DELIVERY_CONTRACT_ID: z.string().optional(),
  DISPUTE_RESOLUTION_CONTRACT_ID: z.string().optional(),
  FLEET_MANAGEMENT_CONTRACT_ID: z.string().optional(),
  IDENTITY_REPUTATION_CONTRACT_ID: z.string().optional(),
  ALLOWED_PAYMENT_TOKENS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((token) => token.trim())
        .filter((token) => token.length > 0),
    ),

  INDEXER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  INDEXER_LAG_ALERT_LEDGERS: z.coerce.number().int().positive().default(50),
  /** Conservative floor for how many ledgers back a Soroban RPC's getEvents
   * is guaranteed to still serve — used to clamp a stale checkpoint forward
   * instead of requesting a startLedger that's already aged out (RPC error
   * -32600 "startLedger must be within the ledger range"). Default matches
   * the most restrictive commonly-deployed retention (~24h at ~5s/ledger);
   * raise it if SOROBAN_RPC_URL points at a provider with a longer window. */
  INDEXER_EVENT_RETENTION_LEDGERS: z.coerce.number().int().positive().default(17_280),

  /** Local-filesystem root for dispute evidence files — see
   * src/modules/disputes/infrastructure/local-evidence-storage.ts. The
   * relative default resolves against the process working directory and is
   * a development-only convenience; a deployed environment must set this to
   * an absolute path backed by persistent storage (docker-compose.yml's
   * `evidence-data` volume mounts it at /var/lib/fanilab/evidence) or every
   * uploaded file is lost on container recreation. See docs/DEPLOYMENT.md
   * § Evidence Storage. */
  EVIDENCE_STORAGE_DIR: z.string().default('./storage/evidence'),

  /** Maximum size in bytes for evidence file uploads. Base64-encoded payloads
   * are ~33% larger than the decoded file, so the actual file limit is
   * approximately EVIDENCE_MAX_BYTES * 0.75. */
  EVIDENCE_MAX_BYTES: z.coerce.number().int().positive().default(10_485_760),

  /** Selects the Mailer/NotificationSender adapter each composition root
   * wires up (src/modules/auth/index.ts, src/modules/notifications/index.ts).
   * `logger` is the development/test default — it logs instead of sending
   * real mail and is deliberately refused when NODE_ENV=production (see
   * select-mailer.ts / select-notification-sender.ts): a production
   * deployment with no real provider configured should fail loudly at boot,
   * not silently send no mail. `smtp`, `sendgrid`, and `ses` all deliver
   * over the same SMTP relay configured by the SMTP_* variables below
   * (SendGrid: smtp.sendgrid.net with user "apikey"; SES:
   * email-smtp.<region>.amazonaws.com; `smtp`: any RFC 5321 relay) — see
   * src/shared/smtp/smtp-client.ts. Selecting any of them requires
   * SMTP_HOST and SMTP_FROM, enforced at parse time by the refinement
   * below so a misconfiguration fails at boot, not at first send. */
  MAIL_PROVIDER: z.enum(['logger', 'smtp', 'sendgrid', 'ses']).default('logger'),
  NOTIFICATION_PROVIDER: z.enum(['logger', 'smtp', 'sendgrid', 'ses']).default('logger'),

  /** SMTP relay settings used whenever MAIL_PROVIDER or NOTIFICATION_PROVIDER
   * is not `logger`. SMTP_USER/SMTP_PASSWORD are optional: some relays
   * (local dev relay, platform-internal relay) authenticate implicitly —
   * when either is set, both must be, and AUTH is attempted. SMTP_TLS_CA_PATH
   * points at a PEM CA bundle for relays whose certificate chains to a
   * private CA rather than a public one. */
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().min(1).optional(),
  SMTP_TLS_CA_PATH: z.string().min(1).optional(),

  /** How long `actor_activities` rows are kept before the scheduled cleanup
   * job deletes them (src/modules/fraud-detection/infrastructure/cleanup-
   * queue.ts). Default is well above the widest current rule window (24h,
   * DISPUTE_RAISE_VELOCITY) to leave room for future longer-window rules
   * and for forensic/manual review of recent flagged activity. */
  FRAUD_ACTIVITY_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

  /** Velocity-rule thresholds and windows for the fraud-detection module
   * (src/modules/fraud-detection/application/assess-actor.ts). Defaults
   * mirror the previously hardcoded RULES constants so behaviour is
   * unchanged when nothing is configured; operators can tune them per
   * environment (local dev, testnet staging, high-traffic production)
   * without a rebuild. Thresholds are the number of matching activities
   * within the window that trigger a flag; windows are in hours. */
  FRAUD_DELIVERY_VELOCITY_THRESHOLD: z.coerce.number().int().positive().default(10),
  FRAUD_DELIVERY_VELOCITY_WINDOW_HOURS: z.coerce.number().int().positive().default(1),
  FRAUD_ESCROW_VELOCITY_THRESHOLD: z.coerce.number().int().positive().default(10),
  FRAUD_ESCROW_VELOCITY_WINDOW_HOURS: z.coerce.number().int().positive().default(1),
  FRAUD_DISPUTE_VELOCITY_THRESHOLD: z.coerce.number().int().positive().default(3),
  FRAUD_DISPUTE_VELOCITY_WINDOW_HOURS: z.coerce.number().int().positive().default(24),

  /** Short-TTL cache for the ADMIN-only analytics endpoints
   * (src/modules/analytics/infrastructure/cached-anal

/* … truncated 3243 chars — edit only what you need near the top … */
