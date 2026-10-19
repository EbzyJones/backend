import { readFileSync } from 'node:fs';
import { connect as connectTcp, isIP, type Socket } from 'node:net';
import { connect as connectTls } from 'node:tls';
import { hostname } from 'node:os';
import { logger } from '../logger/index.js';

const log = logger.child({ module: 'smtp' });

/** Relay connection settings assembled from SMTP_* env vars — see
 * `smtpSettingsFromEnv` and src/shared/config/env.ts. */
export interface SmtpSettings {
  host: string;
  port: number;
  /** Omit together with `password` for a relay that needs no AUTH. */
  user?: string | undefined;
  /** Omit together with `user` for a relay that needs no AUTH. */
  password?: string | undefined;
  /** Envelope sender — either `addr@example.com` or `Name <addr@example.com>`. */
  from: string;
  /** PEM CA bundle for a relay presenting a certificate signed by a private
   * CA. Read once at client construction, so a bad path fails at boot
   * rather than at first send. */
  caPath?: string | undefined;
}

export interface SmtpMailMessage {
  to: string;
  subject: string;
  text: string;
}

interface SmtpReply {
  code: number;
  lines: string[];
}

const CONNECT_TIMEOUT_MS = 15_000;

/** Strips an optional `Display Name <` wrapper down to the bare address the
 * SMTP envelope commands require. */
function envelopeAddress(value: string): string {
  const angled = /<([^>]+)>/.exec(value);
  const target = angled?.[1] ?? value;
  return target.trim();
}

/** RFC 2047 encoded-word, only when the header value actually needs it —
 * plain ASCII subjects stay byte-for-byte readable on the wire. */
function encodeHeaderValue(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** Base64 bodies wrapped at 76 chars per RFC 2045 §4.2.2. */
function wrapBase64(base64: string): string {
  return base64.replace(/(.{76})/g, '$1\r\n').replace(/\r\n$/, '');
}

/** Builds the DATA payload: headers + base64 body, CRLF line endings, with
 * dot-stuffing applied (a line beginning with "." would otherwise be read as
 * the end-of-data marker by the relay). */
function encodeMessage(settings: SmtpSettings, message: SmtpMailMessage): string {
  const lines = [
    `From: ${encodeHeaderValue(settings.from)}`,
    `To: ${encodeHeaderValue(message.to)}`,
    `Subject: ${encodeHeaderValue(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(Buffer.from(message.text, 'utf8').toString('base64')),
  ];
  return lines.map((line) => (line.startsWith('.') ? `.${line}` : line)).join('\r\n');
}

/**
 * One SMTP conversation: multiline-aware response parsing, command/reply
 * exchange, and timeout/connection-failure propagation. Owned by a single
 * send call — connections are never pooled or reused.
 */
class SmtpConnection {
  private buffer = '';
  private readonly waiters: Array<{
    resolve: (reply: SmtpReply) => void;
    reject: (error: Error) => void;
  }> = [];
  private fatal: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error) => this.fail(error));
    socket.on('timeout', () => this.fail(new Error('SMTP connection timed out')));
    socket.on('close', () => this.fail(new Error('SMTP connection closed unexpectedly')));
  }

  /** Stops this connection's listeners so the same socket can be handed to
   * a TLS socket mid-conversation (STARTTLS upgrade). */
  detach(): void {
    for (const event of ['data', 'error', 'close', 'timeout'] as const) {
      this.socket.removeAllListeners(event);
    }
    this.fail(new Error('SMTP connection detached'));
  }

  read(): Promise<SmtpReply> {
    if (this.fatal) return Promise.reject(this.fatal);
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.drain();
    });
  }

  /** Writes one command and checks its reply against the expected codes. */
  async command(command: string, expected: number[]): Promise<SmtpReply> {
    if (this.fatal) throw this.fatal;
    this.socket.write(`${command}\r\n`);
    return this.reply(expected);
  }

  /** Checks the next reply (e.g. after a raw multi-line write such as DATA). */
  async reply(expected: number[]): Promise<SmtpReply> {
    const reply = await this.read();
    if (!expected.includes(reply.code)) {
      throw new Error(
        `SMTP reply ${reply.code} not in [${expected.join(', ')}]: ${reply.lines.join(' | ')}`,
      );
    }
    return reply;
  }

  write(data: string): void {
    this.socket.write(data);
  }

  /** Tears the connection down. Called after the final reply was already
   * read (or on any failure), so destroying rather than half-closing is
   * safe — nothing further needs to be flushed. */
  end(): void {
    this.socket.destroy();
  }

  /** Resolves as many queued waiters as complete replies have buffered. Only
   * newline-terminated lines count, so a reply split across TCP chunks can
   * never be mistaken for a complete one. */
  private drain(): void {
    while (this.waiters.length > 0) {
      const reply = this.tryParseReply();
      if (!reply) return;
      this.waiters.shift()!.resolve(reply);
    }
  }

  private tryParseReply(): SmtpReply | null {
    let cursor = 0;
    const lines: string[] = [];
    for (;;) {
      const newlineAt = this.buffer.indexOf('\n', cursor);
      if (newlineAt === -1) return null;
      const line = this.buffer.slice(cursor, newlineAt).replace(/\r$/, '');
      cursor = newlineAt + 1;
      lines.push(line);
      // Continuation lines end with "-", the final line of a reply ends with
      // a space (or nothing) — RFC 5321 §4.2.1.
      if (/^\d{3}(?: |$)/.test(line)) {
        this.buffer = this.buffer.slice(cursor);
        return { code: Number.parseInt(line.slice(0, 3), 10), lines };
      }
    }
  }

  private fail(error: Error): void {
    this.fatal ??= error;
    while (this.waiters.length > 0) {
      this.waiters.shift()!.reject(this.fatal);
    }
  }
}

/** Opens a TCP/TLS socket and resolves once connected (or rejects on
 * error/handshake timeout). */
function openSocket(socket: Socket, event: 'connect' | 'secureConnect'): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      socket.removeListener('error', onError);
      socket.destroy();
      reject(new Error('SMTP connection timed out while connecting'));
    }, CONNECT_TIMEOUT_MS);
    socket.once('error', onError);
    socket.once(event, () => {
      clearTimeout(timer);
      socket.removeListener('error', onError);
      resolve(socket);
    });
  });
}

/** Capabilities advertised in an EHLO reply (RFC 5321 §4.1.4.1). */
function parseCapabilities(reply: SmtpReply): { keywords: Set<string>; authMechanisms: string[] } {
  const keywords = new Set<string>();
  const authMechanisms: string[] = [];
  for (const line of reply.lines.slice(1)) {
    const parts = line.replace(/^\d{3}[- ]/, '').split(' ');
    const keyword = parts[0]?.toUpperCase();
    if (!keyword) continue;
    keywords.add(keyword);
    if (keyword === 'AUTH') {
      authMechanisms.push(...parts.slice(1).map((mechanism) => mechanism.toUpperCase()));
    }
  }
  return { keywords, authMechanisms };
}

/** EHLO argument: the local hostname sanitized to a bare label, per common
 * client practice — relays reject malformed domain arguments. */
function ehloDomain(): string {
  const sanitized = hostname().replace(/[^\w.-]/g, '');
  return sanitized.length > 0 ? sanitized : 'localhost';
}

async function authenticate(
  connection: SmtpConnection,
  mechanisms: string[],
  user: string,
  password: string,
): Promise<void> {
  if (mechanisms.includes('PLAIN')) {
    const initialResponse = Buffer.from(`\0${user}\0${password}`).toString('base64');
    await connection.command(`AUTH PLAIN ${initialResponse}`, [235]);
    return;
  }
  if (mechanisms.includes('LOGIN')) {
    await connection.command('AUTH LOGIN', [334]);
    await connection.command(Buffer.from(user).toString('base64'), [334]);
    await connection.command(Buffer.from(password).toString('base64'), [235]);
    return;
  }
  throw new Error(
    `SMTP relay advertises no supported AUTH mechanism (offered: ${mechanisms.join(', ') || 'none'})`,
  );
}

/** One end-to-end delivery: connect (implicit TLS on 465, plain otherwise),
 * greet, upgrade via STARTTLS when offered, authenticate, envelope, DATA. */
async function deliver(
  settings: SmtpSettings,
  message: SmtpMailMessage,
  ca: string | undefined,
): Promise<void> {
  if (Boolean(settings.user) !== Boolean(settings.password)) {
    throw new Error(
      'SMTP_USER and SMTP_PASSWORD must be set together (or both omitted for a relay that needs no AUTH)',
    );
  }

  const implicitTls = settings.port === 465;
  const tlsOptions = {
    servername: isIP(settings.host) ? undefined : settings.host,
    rejectUnauthorized: true,
    ...(ca ? { ca } : {}),
  };

  const socket: Socket = implicitTls
    ? await openSocket(
        connectTls({ host: settings.host, port: settings.port, ...tlsOptions }),
        'secureConnect',
      )
    : await openSocket(connectTcp({ host: settings.host, port: settings.port }), 'connect');

  let connection = new SmtpConnection(socket);
  let usingTls = implicitTls;

  try {
    await connection.reply([220]);
    let capabilities = await (async () => {
      const reply = await connection.command(`EHLO ${ehloDomain()}`, [250]);
      return parseCapabilities(reply);
    })();

    if (!implicitTls && capabilities.keywords.has('STARTTLS')) {
      await connection.command('STARTTLS', [220]);
      connection.detach();
      connection = new SmtpConnection(
        await openSocket(connectTls({ socket, ...tlsOptions }), 'secureConnect'),
      );
      usingTls = true;
      const reply = await connection.command(`EHLO ${ehloDomain()}`, [250]);
      capabilities = parseCapabilities(reply);
    }

    if (settings.user && settings.password) {
      if (!usingTls) {
        log.warn(
          { host: settings.host, port: settings.port },
          'Authenticating to SMTP relay over plaintext (relay advertises no STARTTLS)',
        );
      }
      await authenticate(connection, capabilities.authMechanisms, settings.user, settings.password);
    }

    await connection.command(`MAIL FROM:<${envelopeAddress(settings.from)}>`, [250]);
    await connection.command(`RCPT TO:<${envelopeAddress(message.to)}>`, [250, 251]);
    await connection.command('DATA', [354]);
    connection.write(`${encodeMessage(settings, message)}\r\n.\r\n`);
    await connection.reply([250]);
    await connection.command('QUIT', [221]);
  } finally {
    connection.end();
  }
}

/** Minimal dependency-free SMTP sender (RFC 5321): plain, STARTTLS, and
 * implicit-TLS (port 465) relays, AUTH PLAIN/LOGIN. Throwing on any
 * failure is deliberate — callers (auth's `Mailer`, notifications'
 * `NotificationSender`) document that a send failure must surface, never
 * silently pretend success. */
export function createSmtpClient(settings: SmtpSettings): {
  send(message: SmtpMailMessage): Promise<void>;
} {
  // Read eagerly so a bad CA path fails at boot, not at first send.
  const ca = settings.caPath ? readFileSync(settings.caPath, 'utf8') : undefined;
  return {
    async send(message: SmtpMailMessage): Promise<void> {
      await deliver(settings, message, ca);
    },
  };
}
