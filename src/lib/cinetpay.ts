import { createHmac, timingSafeEqual } from "crypto";

/**
 * CinetPay notify_url HMAC verification.
 *
 * Per CinetPay's official documentation
 * (docs.cinetpay.com/api/1.0-en/checkout/hmac and .../checkout/notification),
 * the `x-token` request header carries an HMAC-SHA256 digest of the
 * notification's fields, concatenated in this exact order, keyed with the
 * merchant's secret key (distinct from the API key):
 *
 *   cpm_site_id + cpm_trans_id + cpm_trans_date + cpm_amount + cpm_currency +
 *   signature + payment_method + cel_phone_num + cpm_phone_prefixe +
 *   cpm_language + cpm_version + cpm_payment_config + cpm_page_action +
 *   cpm_custom + cpm_designation + cpm_error_message
 *
 * Brief 0.1 requirement: this must fail closed. If the header is missing,
 * malformed, or CINETPAY_SECRET_KEY isn't configured, verification must
 * return false -- never true by default. There is no "trust it in dev"
 * escape hatch.
 */

const HMAC_FIELDS = [
  "cpm_site_id",
  "cpm_trans_id",
  "cpm_trans_date",
  "cpm_amount",
  "cpm_currency",
  "signature",
  "payment_method",
  "cel_phone_num",
  "cpm_phone_prefixe",
  "cpm_language",
  "cpm_version",
  "cpm_payment_config",
  "cpm_page_action",
  "cpm_custom",
  "cpm_designation",
  "cpm_error_message",
] as const;

export type CinetPayNotification = Record<(typeof HMAC_FIELDS)[number], string> &
  Record<string, unknown>;

export function computeCinetPayToken(
  notification: Record<string, unknown>,
  secretKey: string,
): string {
  const data = HMAC_FIELDS.map((field) => {
    const value = notification[field];
    return value === undefined || value === null ? "" : String(value);
  }).join("");

  return createHmac("sha256", secretKey).update(data).digest("hex");
}

/**
 * Verifies the `x-token` header against a freshly computed HMAC. Returns
 * false (reject) for every failure mode: missing header, missing/invalid
 * secret key configuration, malformed hex, or a mismatched digest.
 */
export function verifyCinetPaySignature(
  notification: Record<string, unknown>,
  receivedToken: string | null | undefined,
  secretKey: string | undefined,
): boolean {
  if (!secretKey) {
    return false;
  }

  if (!receivedToken || typeof receivedToken !== "string") {
    return false;
  }

  const expectedToken = computeCinetPayToken(notification, secretKey);

  const expectedBuffer = Buffer.from(expectedToken, "hex");
  const receivedBuffer = Buffer.from(receivedToken, "hex");

  if (
    expectedBuffer.length === 0 ||
    receivedBuffer.length !== expectedBuffer.length
  ) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

export interface InitiateCinetPayPaymentParams {
  transactionId: string;
  amount: number;
  currency?: string;
  description: string;
  customerId: string;
  custom: Record<string, unknown>;
}

interface CinetPayInitResponse {
  code: string;
  message: string;
  description?: string;
  data?: {
    payment_url: string;
    payment_token: string;
  };
}

/**
 * Calls CinetPay's checkout initialization API
 * (docs.cinetpay.com/api/1.0-en/checkout/initialisation) to obtain a
 * payment_url the fan is redirected to. notify_url/return_url point back at
 * this app; notify_url is where the signed webhook lands.
 */
export async function initiateCinetPayPayment(
  params: InitiateCinetPayPaymentParams,
): Promise<string> {
  const apiKey = process.env.CINETPAY_API_KEY;
  const siteId = process.env.CINETPAY_SITE_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!apiKey || !siteId || !appUrl) {
    throw new Error(
      "CINETPAY_API_KEY, CINETPAY_SITE_ID and NEXT_PUBLIC_APP_URL must be configured",
    );
  }

  const response = await fetch("https://api-checkout.cinetpay.com/v2/payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey: apiKey,
      site_id: siteId,
      transaction_id: params.transactionId,
      amount: params.amount,
      currency: params.currency ?? "USD",
      description: params.description,
      customer_id: params.customerId,
      notify_url: `${appUrl}/api/webhooks/cinetpay`,
      return_url: `${appUrl}/paiement/retour`,
      channels: "ALL",
      custom: JSON.stringify(params.custom),
    }),
  });

  const body = (await response.json()) as CinetPayInitResponse;

  if (body.code !== "201" || !body.data?.payment_url) {
    throw new Error(
      `CinetPay payment initialization failed: ${body.message ?? "unknown error"}`,
    );
  }

  return body.data.payment_url;
}
