export interface Env {
  BUCKET: R2Bucket;

  // R2 S3-compatible credentials — used to sign presigned GET/PUT URLs.
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;

  /** Canonical public-format base, e.g. https://pub-xxxx.r2.dev — still the
   *  identity of every stored URL even after the bucket goes private. */
  R2_PUBLIC_URL: string;

  /** e.g. https://ashapp.atlasai-agents.com */
  ALLOWED_ORIGIN: string;

  // Auth (see auth.ts)
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SERVICE_SECRET: string;
}
