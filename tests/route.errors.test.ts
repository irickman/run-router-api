import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app } from '../src/app';

describe('route error responses', () => {
  it('returns structured missing-field error', async () => {
    const res = await request(app).post('/api/route').send({}).expect(400);
    expect(res.body.error).toMatch(/Missing required field: query/);
    expect(res.body.code).toBe('MISSING_FIELD');
  });

  it('returns structured not-found error for route retrieval', async () => {
    const res = await request(app)
      .get('/api/route/00000000-0000-0000-0000-000000000000/11111111-1111-1111-1111-111111111111')
      .expect(404);

    expect(res.body.error).toBe('Route not found');
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns structured not-found error for route refinement target', async () => {
    const res = await request(app)
      .post('/api/route/00000000-0000-0000-0000-000000000000/11111111-1111-1111-1111-111111111111/refine')
      .send({ instruction: 'extend by 1 mile' })
      .expect(404);

    expect(res.body.error).toBe('Route not found');
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
