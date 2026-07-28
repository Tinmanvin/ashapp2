/**
 * sign.ts — presigned R2 URL generation.
 *
 * Presigned rather than proxied on purpose: the Worker signs a string and gets
 * out of the way, so media bytes still travel direct from R2's edge to the
 * client. Range requests and video seeking behave exactly as they did when the
 * bucket was public. Putting the Worker in the byte path would have been
 * simpler to reason about and would have cost streaming performance.
 */

import { AwsClient } from 'aws4fetch';
import type { Env } from './env';

export type SignMethod = 'GET' | 'PUT';

export function r2Client(env: Env): AwsClient {
  return new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
}

export async function presign(
  client: AwsClient,
  env: Env,
  key: string,
  method: SignMethod,
  expiresIn: number,
  contentType?: string,
): Promise<string> {
  const endpoint = new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/` +
      `${env.R2_BUCKET_NAME}/${key.split('/').map(encodeURIComponent).join('/')}`,
  );

  // aws4fetch has no `expiresIn` option — it reads X-Amz-Expires off the URL and
  // silently defaults to 86400 (24h) when it is absent. Setting it here is the
  // only thing that actually bounds the lifetime of a signed URL.
  endpoint.searchParams.set('X-Amz-Expires', String(expiresIn));

  const signed = await client.sign(
    new Request(endpoint.toString(), {
      method,
      ...(contentType ? { headers: { 'Content-Type': contentType } } : {}),
    }),
    { aws: { signQuery: true, allHeaders: true, appendSessionToken: false } },
  );

  return signed.url;
}
