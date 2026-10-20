import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createFraudDetectionRoutes } from './routes.js';

const requireRoleMock = vi.fn();
const authenticateMock = vi.fn();

vi.mock('../../auth/interface/middleware.js', () => ({
  authenticate: authenticateMock,
  requireRole: (role: string) => {
    requireRoleMock(role);
    return async (request: any, reply: any) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      if (request.user.role !== role) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
    };
  },
}));

const fraudServiceMock = {
  getActorRisk: vi.fn(),
};

vi.mock('../application/fraud-detection.service.js', () => ({
  FraudDetectionService: vi.fn().mockImplementation(() => fraudServiceMock),
}));

describe('fraud-detection routes auth lifecycle', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    authenticateMock.mockImplementation(async (request: any, reply: any) => {
      const header = request.headers.authorization;
      if (!header) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      request.user = { id: 'user-1', role: header.includes('admin') ? 'ADMIN' : 'USER' };
    });

    app = Fastify();
    await app.register(createFraudDetectionRoutes, { prefix: '/fraud' });
    await app.ready();
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/fraud/actors/0xabc' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for authenticated non-admin requests', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/fraud/actors/0xabc',
      headers: { authorization: 'Bearer user-token' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 200 for authenticated admin requests', async () => {
    fraudServiceMock.getActorRisk.mockResolvedValue({ address: '0xabc', riskScore: 10 });
    const res = await app.inject({
      method: 'GET',
      url: '/fraud/actors/0xabc',
      headers: { authorization: 'Bearer admin-token' },
    });
    expect(res.statusCode).toBe(200);
  });
});
