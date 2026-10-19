import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createDisputeRoutes } from './routes';
import type { DisputeService } from '../application/dispute-service';

const EVIDENCE_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

function buildService(contentType: string): DisputeService {
  return {
    getEvidence: async () => ({
      id: EVIDENCE_ID,
      contentType,
    }),
    readEvidenceBytes: async () => Buffer.from('evidence-bytes'),
  } as unknown as DisputeService;
}

describe('GET /disputes/evidence/:evidenceId/download', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  async function setup(contentType: string): Promise<void> {
    app = Fastify();
    await app.register(createDisputeRoutes(buildService(contentType)));
    await app.ready();
  }

  it('appends .jpg for image/jpeg evidence', async () => {
    await setup('image/jpeg');
    const response = await app.inject({
      method: 'GET',
      url: `/disputes/evidence/${EVIDENCE_ID}/download`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="${EVIDENCE_ID}.jpg"`,
    );
    expect(response.headers['content-disposition']).toMatch(/\.jpg"$/);
  });

  it('appends .png for image/png evidence', async () => {
    await setup('image/png');
    const response = await app.inject({
      method: 'GET',
      url: `/disputes/evidence/${EVIDENCE_ID}/download`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toMatch(/\.png"$/);
  });

  it('appends .pdf for application/pdf evidence', async () => {
    await setup('application/pdf');
    const response = await app.inject({
      method: 'GET',
      url: `/disputes/evidence/${EVIDENCE_ID}/download`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toMatch(/\.pdf"$/);
  });

  it('appends .mp4 for video/mp4 evidence', async () => {
    await setup('video/mp4');
    const response = await app.inject({
      method: 'GET',
      url: `/disputes/evidence/${EVIDENCE_ID}/download`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toMatch(/\.mp4"$/);
  });

  it('defaults to .bin for unrecognized MIME types', async () => {
    await setup('application/x-unknown');
    const response = await app.inject({
      method: 'GET',
      url: `/disputes/evidence/${EVIDENCE_ID}/download`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toMatch(/\.bin"$/);
  });
});
