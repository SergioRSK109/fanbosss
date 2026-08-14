import Anthropic from "@anthropic-ai/sdk";

// Automatic moderation of publications (texte + image + video frames) via
// the Claude API, real vision support in the same call -- no second
// provider needed. Two levels only, never a single one, mirroring what
// Meta's and the OSCE/ONU's own post-mortems on over-automated moderation
// settled on (see CLAUDE.md for the full rationale): a clear, severe
// violation blocks the publication outright before it's ever created;
// anything merely ambiguous is published normally and flagged for a human
// via the existing signalement queue -- never auto-masked.
const MODEL = "claude-haiku-4-5";

// Real timeout, distinct from the SDK's own 10-minute default -- this
// call sits in the middle of a publish request a real user is waiting
// on, and the "fail open on any API trouble" requirement below covers a
// slow/hanging call too, not just an outright error.
const REQUEST_TIMEOUT_MS = 15_000;

export type SupportedImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

// The brief's own five categories (read verbatim from the task spec,
// not a literal CGU quote) -- this codebase ships no CGU document
// anywhere (confirmed by grep before writing this; CLAUDE.md only ever
// references specific articles by number in prose, never the full
// text), so "reprenant exactement les règles déjà posées dans les CGU
// (article 8.1)" is satisfied by these five categories -- the ones the
// brief itself names -- rather than a fabricated legal quote. Flagged
// here the same way this project already flags an unverifiable external
// source (the CinetPay refund API research, the GoTrue wrapper-text
// guess) instead of silently inventing text and presenting it as the
// real CGU.
const SYSTEM_PROMPT = `Tu es un modérateur de contenu pour FanBoss, une plateforme de monétisation entre créateurs et fans basée à Kinshasa, RDC.

Analyse le texte et/ou l'image ou les images fournies (une image classique, ou des trames extraites d'une vidéo) d'une publication qu'un utilisateur s'apprête à poster, et classe-la selon les règles de contenu de la plateforme (CGU article 8.1) :
- contenu sexuel explicite
- incitation à la haine, à la violence ou à la discrimination
- harcèlement
- usurpation d'identité
- activité frauduleuse

Réponds uniquement avec la classification structurée demandée :
- "violation_claire" : violation évidente et grave de l'une de ces règles, en particulier du contenu sexuel explicite -- la ligne la plus dure des CGU. Ne réserve cette classification qu'aux cas sans ambiguïté réelle.
- "ambigu" : ton potentiellement agressif, contenu à la limite, ou cas que tu ne peux pas trancher avec certitude.
- "ok" : contenu qui ne pose aucun problème.

En cas de doute entre "violation_claire" et "ambigu", choisis toujours "ambigu" -- une publication ambiguë est simplement signalée pour révision humaine, jamais bloquée ou masquée automatiquement.`;

const MODERATION_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    classification: {
      type: "string",
      enum: ["ok", "violation_claire", "ambigu"],
    },
    raison: {
      type: "string",
      description: "Explication brève (une phrase) de la classification donnée.",
    },
  },
  required: ["classification", "raison"],
  additionalProperties: false,
};

export type ModerationClassification = "ok" | "violation_claire" | "ambigu";

export interface ModerationResult {
  classification: ModerationClassification;
  raison: string;
}

export interface ModerationImage {
  data: string; // base64, no "data:" prefix
  mediaType: SupportedImageMediaType;
}

export interface ModerationInput {
  texte?: string | null;
  imageBase64?: ModerationImage | null;
  // 2-3 JPEG frames extracted client-side from a video
  // (src/lib/videoDuration.ts) -- never a whole video, and never
  // processed server-side at all (no ffmpeg in this deployment target,
  // see CLAUDE.md).
  framesBase64?: ModerationImage[] | null;
}

const FAIL_OPEN_RESULT: ModerationResult = { classification: "ok", raison: "" };

function isValidClassification(value: unknown): value is ModerationClassification {
  return value === "ok" || value === "violation_claire" || value === "ambigu";
}

// The one function this whole feature is built around. Deliberately
// catches everything -- a timeout, a network error, a missing
// ANTHROPIC_API_KEY, a malformed response -- and falls back to "ok"
// rather than ever blocking a publication because the moderation layer
// itself is unavailable. Automatic moderation is an additional layer on
// top of the existing manual signalement/masquage system, never a new
// single point of failure for the core publishing feature.
export async function moderatePublication(input: ModerationInput): Promise<ModerationResult> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return FAIL_OPEN_RESULT;
    }

    const client = new Anthropic({ apiKey });

    const content: Anthropic.ImageBlockParam[] = [];
    if (input.imageBase64) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: input.imageBase64.mediaType, data: input.imageBase64.data },
      });
    }
    for (const frame of input.framesBase64 ?? []) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: frame.mediaType, data: frame.data },
      });
    }

    const texte = input.texte?.trim();

    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        output_config: { format: { type: "json_schema", schema: MODERATION_OUTPUT_SCHEMA } },
        messages: [
          {
            role: "user",
            content: [
              ...content,
              { type: "text", text: texte ? texte : "(aucun texte, contenu image/vidéo uniquement)" },
            ],
          },
        ],
      },
      { timeout: REQUEST_TIMEOUT_MS },
    );

    if (response.stop_reason === "refusal") {
      return FAIL_OPEN_RESULT;
    }

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return FAIL_OPEN_RESULT;
    }

    const parsed = JSON.parse(textBlock.text) as { classification?: unknown; raison?: unknown };
    if (!isValidClassification(parsed.classification)) {
      return FAIL_OPEN_RESULT;
    }

    return {
      classification: parsed.classification,
      raison: typeof parsed.raison === "string" ? parsed.raison : "",
    };
  } catch {
    return FAIL_OPEN_RESULT;
  }
}
