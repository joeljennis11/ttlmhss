import { ErrorCode, SchoolBrandingSchema } from '@ttlmhss/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, INVALID_RESPONSE, NETWORK_ERROR, apiRequest } from '../src/lib/api-client';

function respond(status: number, body: unknown): typeof fetch {
  return vi.fn(
    async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
}

const branding = {
  shortName: 'TTLMHSS',
  fullName: 'Thiruthangal Lions Matriculation Higher Secondary School',
  primaryColor: '#003300',
  logoUrl: null,
};

describe('api client', () => {
  it('calls the versioned API and returns validated data', async () => {
    const fetchImpl = respond(200, { data: branding });
    await expect(
      apiRequest('/school/branding', { schema: SchoolBrandingSchema }, fetchImpl),
    ).resolves.toEqual(branding);
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/school/branding',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('turns the error envelope into an ApiClientError with the server message', async () => {
    const fetchImpl = respond(400, {
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Some of the submitted information is invalid.',
        details: [{ path: 'body.name', message: 'Name is required' }],
        requestId: 'r-1',
      },
    });
    const error = await apiRequest('/x', {}, fetchImpl).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      status: 400,
      details: [{ path: 'body.name', message: 'Name is required' }],
      requestId: 'r-1',
    });
  });

  it('reports network failures without leaking internals', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed: ECONNREFUSED 127.0.0.1:3000');
    }) as unknown as typeof fetch;
    const error = await apiRequest('/x', {}, fetchImpl).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: NETWORK_ERROR, status: 0 });
    expect((error as Error).message).not.toContain('ECONNREFUSED');
  });

  it('rejects payloads that do not match the expected shape', async () => {
    const fetchImpl = respond(200, { data: { shortName: 1 } });
    await expect(
      apiRequest('/school/branding', { schema: SchoolBrandingSchema }, fetchImpl),
    ).rejects.toMatchObject({
      code: INVALID_RESPONSE,
    });
    await expect(apiRequest('/x', {}, respond(200, 'not json'))).rejects.toMatchObject({
      code: INVALID_RESPONSE,
    });
  });

  it('returns the data of a non-2xx response that still carries data (health 503)', async () => {
    const fetchImpl = respond(503, { data: { status: 'degraded', database: 'down', time: 't' } });
    await expect(apiRequest('/health', {}, fetchImpl)).resolves.toMatchObject({ database: 'down' });
  });
});
