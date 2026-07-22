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

export async function getSignedUploadUrl(key: string, contentType: string) {
  const client = getR2Client();
  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn: SIGNED_URL_EXPIRY_SECONDS });
}

export async function getSignedDownloadUrl(key: string) {
  const client = getR2Client();
  const command = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: key,
  });
  return getSignedUrl(client, command, { expiresIn: SIGNED_URL_EXPIRY_SECONDS });
}
