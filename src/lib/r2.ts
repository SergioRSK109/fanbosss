import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Brief 0.5: the R2 bucket must NOT be public. Every read goes through a
// presigned GET URL, minted on demand behind an authenticated route that
// re-checks ownership + delivery status first. There is no
// NEXT_PUBLIC_R2_PUBLIC_URL anywhere in this codebase, intentionally.
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60; // 1h, per brief

function getR2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 credentials are not configured");
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getBucketName(): string {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) {
    throw new Error("R2_BUCKET_NAME is not configured");
  }
  return bucket;
}

// Security audit fix: getSignedUploadUrl() used to sign no size limit at
// all -- a caller could request a URL for a tiny declared ContentType and
// then PUT an arbitrarily large file. Every upload in this app is either
// an image (profile photo, publication image) or a video (offer
// video/shoutout delivery); contenu_debloque accepts an arbitrary
// ContentType (it's a créateur-supplied unlockable file, not necessarily
// either), so it falls back to the more permissive video-sized cap rather
// than the tighter image one.
export const MAX_UPLOAD_SIZE_BYTES = {
  image: 10 * 1024 * 1024, // 10 MB
  video: 200 * 1024 * 1024, // 200 MB
} as const;

export function maxUploadSizeBytes(contentType: string): number {
  return contentType.startsWith("image/")
    ? MAX_UPLOAD_SIZE_BYTES.image
    : MAX_UPLOAD_SIZE_BYTES.video;
}

export interface UploadSizeCheck {
  ok: boolean;
  maxBytes: number;
}

// Pure, called by every upload-url route before ever minting a signed
// URL -- the real server-side rejection this fix is about, not just the
// client-side duration/size checks a caller can simply skip by hitting
// the API directly.
export function checkUploadSize(size: number, contentType: string): UploadSizeCheck {
  const maxBytes = maxUploadSizeBytes(contentType);
  return { ok: Number.isFinite(size) && size > 0 && size <= maxBytes, maxBytes };
}

// `contentLength` is baked into the signed request the same way
// `contentType` already was (see CLAUDE.md's "Mobile upload bug" section
// -- a ContentType mismatch between what was signed and what's actually
// PUT is already confirmed, empirically, to make R2 reject the request).
// This is what makes the size cap a REAL server-side guarantee rather
// than a client-side-only check: a caller can declare a small size to
// pass the route's own checkUploadSize() gate, but the actual PUT's
// Content-Length (set automatically by the browser from the real file
// being sent, not something a caller can override via fetch) then has to
// match this exact signed value -- uploading anything else fails R2's
// own signature verification, independent of any application code.
export async function getSignedUploadUrl(key: string, contentType: string, contentLength: number) {
  const client = getR2Client();
  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  return getSignedUrl(client, command, { expiresIn: SIGNED_URL_EXPIRY_SECONDS });
}

export async function getSignedDownloadUrl(
  key: string,
  expiresInSeconds: number = SIGNED_URL_EXPIRY_SECONDS,
) {
  const client = getR2Client();
  const command = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: key,
  });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

// Automatic publication moderation (src/lib/moderation.ts) is the first
// place in this codebase that needs the actual object bytes server-side
// -- every other read path (delivery routes) only ever mints a signed
// URL for the browser to fetch directly, R2 is otherwise never touched
// from application code after upload. `ContentType` set at upload time
// (getSignedUploadUrl above) is what the moderation route trusts for the
// image's media type, since nothing else in this pipeline records it.
export async function getObjectBase64(key: string): Promise<{ data: string; contentType: string | undefined }> {
  const client = getR2Client();
  const command = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: key,
  });
  const response = await client.send(command);
  if (!response.Body) {
    throw new Error("R2 object has no body");
  }
  const bytes = await response.Body.transformToByteArray();
  return { data: Buffer.from(bytes).toString("base64"), contentType: response.ContentType };
}
