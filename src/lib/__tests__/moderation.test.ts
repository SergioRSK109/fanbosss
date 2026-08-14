import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Anthropic SDK is never called for real in tests -- same discipline
// as cinetpay.test.ts's own stub-always-throws test and every other
// external-API boundary in this project.
const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  // A plain arrow function can't be used with `new` -- moderatePublication()
  // does `new Anthropic({...})`, so this has to be a real constructor
  // function, not `vi.fn().mockImplementation(() => ({...}))`.
  default: vi.fn(function AnthropicMock(this: { messages: { create: typeof mockCreate } }) {
    this.messages = { create: mockCreate };
  }),
}));

import { moderatePublication } from "@/lib/moderation";

function mockAnthropicResponse(
  classification: string,
  raison = "",
  stopReason: string = "end_turn",
) {
  mockCreate.mockResolvedValue({
    stop_reason: stopReason,
    content: [{ type: "text", text: JSON.stringify({ classification, raison }) }],
  });
}

describe("moderatePublication", () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockReset();
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  });

  it("classifies a clearly problematic fixture as violation_claire", async () => {
    mockAnthropicResponse("violation_claire", "contenu sexuel explicite");

    const result = await moderatePublication({ texte: "..." });

    expect(result).toEqual({ classification: "violation_claire", raison: "contenu sexuel explicite" });
  });

  it("classifies an ambiguous fixture as ambigu", async () => {
    mockAnthropicResponse("ambigu", "ton potentiellement agressif");

    const result = await moderatePublication({ texte: "..." });

    expect(result).toEqual({ classification: "ambigu", raison: "ton potentiellement agressif" });
  });

  it("classifies a clean fixture as ok", async () => {
    mockAnthropicResponse("ok", "");

    const result = await moderatePublication({ texte: "Bonjour tout le monde !" });

    expect(result).toEqual({ classification: "ok", raison: "" });
  });

  it("falls back to ok, never a block, when the API call throws (network/timeout)", async () => {
    mockCreate.mockRejectedValue(new Error("network error"));

    const result = await moderatePublication({ texte: "..." });

    expect(result).toEqual({ classification: "ok", raison: "" });
  });

  it("falls back to ok, without ever calling the API, when ANTHROPIC_API_KEY is not configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const result = await moderatePublication({ texte: "..." });

    expect(result).toEqual({ classification: "ok", raison: "" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("falls back to ok when the model itself refuses (stop_reason: refusal)", async () => {
    mockCreate.mockResolvedValue({ stop_reason: "refusal", content: [] });

    const result = await moderatePublication({ texte: "..." });

    expect(result).toEqual({ classification: "ok", raison: "" });
  });

  it("falls back to ok on an unparseable response body", async () => {
    mockCreate.mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "not valid json" }],
    });

    const result = await moderatePublication({ texte: "..." });

    expect(result).toEqual({ classification: "ok", raison: "" });
  });

  it("falls back to ok on an unrecognized classification value", async () => {
    mockAnthropicResponse("something_else_entirely", "x");

    const result = await moderatePublication({ texte: "..." });

    expect(result).toEqual({ classification: "ok", raison: "" });
  });

  it("falls back to ok when the response has no text block at all", async () => {
    mockCreate.mockResolvedValue({ stop_reason: "end_turn", content: [] });

    const result = await moderatePublication({ texte: "..." });

    expect(result).toEqual({ classification: "ok", raison: "" });
  });

  it("sends the image and video-frame content blocks plus a trailing text block", async () => {
    mockAnthropicResponse("ok", "");

    await moderatePublication({
      texte: "légende",
      imageBase64: { data: "img-base64", mediaType: "image/jpeg" },
      framesBase64: [
        { data: "frame-1", mediaType: "image/jpeg" },
        { data: "frame-2", mediaType: "image/jpeg" },
      ],
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const call = mockCreate.mock.calls[0][0];
    expect(call.model).toBe("claude-haiku-4-5");
    const content = call.messages[0].content;
    expect(content).toHaveLength(4);
    expect(content[0]).toMatchObject({ type: "image", source: { type: "base64", data: "img-base64" } });
    expect(content[1]).toMatchObject({ type: "image", source: { type: "base64", data: "frame-1" } });
    expect(content[2]).toMatchObject({ type: "image", source: { type: "base64", data: "frame-2" } });
    expect(content[3]).toMatchObject({ type: "text", text: "légende" });
  });

  it("sends a placeholder text block when no texte is given at all", async () => {
    mockAnthropicResponse("ok", "");

    await moderatePublication({ imageBase64: { data: "img-base64", mediaType: "image/jpeg" } });

    const call = mockCreate.mock.calls[0][0];
    const content = call.messages[0].content;
    expect(content[content.length - 1].text).toMatch(/aucun texte/i);
  });

  it("requests structured output via output_config.format, never a free-text prompt to parse blindly", async () => {
    mockAnthropicResponse("ok", "");

    await moderatePublication({ texte: "..." });

    const call = mockCreate.mock.calls[0][0];
    expect(call.output_config.format.type).toBe("json_schema");
    expect(call.output_config.format.schema.required).toEqual(["classification", "raison"]);
  });

  it("passes a real request timeout, distinct from the SDK's own default", async () => {
    mockAnthropicResponse("ok", "");

    await moderatePublication({ texte: "..." });

    const options = mockCreate.mock.calls[0][1];
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.timeout).toBeLessThan(60_000);
  });
});
