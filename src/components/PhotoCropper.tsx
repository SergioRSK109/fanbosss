"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import {
  clampOffsetFrac,
  computeDrawGeometry,
  drawCropToCanvas,
  CROP_EXPORT_SIZE,
  CROP_MAX_ZOOM,
  CROP_MIN_ZOOM,
  INITIAL_CROP_STATE,
  type CropState,
} from "@/lib/imageCrop";

const PREVIEW_SIZE = 288;
// Generous but not unbounded -- a multi-hundred-MB file would hang the
// browser trying to decode it into an <img> before the crop step even
// gets a chance to shrink it down.
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const EXPORT_QUALITY = 0.9;

// Instagram-style square crop, entirely client-side (product brief):
// forces every profile photo through the same pipeline -- pan/zoom/
// rotate, then re-encode to a fixed CROP_EXPORT_SIZE JPEG -- regardless
// of the source file's format or dimensions. This is also a likely fix
// for the mobile upload bug: phone photos are often HEIC or several MB,
// and the presigned R2 PUT is signed for the exact Content-Type sent at
// upload time (src/lib/r2.ts) -- an empty/unusual MIME type from a phone
// camera could sign-and-send a mismatched header. Cropping always
// produces a real, consistent "image/jpeg" blob.
export function PhotoCropper({
  file,
  onCancel,
  onConfirm,
}: {
  file: File;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}) {
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number; startOffsetXFrac: number; startOffsetYFrac: number } | null>(null);

  const fileTooLarge = file.size > MAX_SOURCE_BYTES;

  const [cropState, setCropState] = useState<CropState>(INITIAL_CROP_STATE);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const error = fileTooLarge
    ? "Cette image est trop volumineuse. Choisis une photo plus légère."
    : loadError || exportError;

  useEffect(() => {
    if (fileTooLarge) {
      return;
    }

    // React (Strict Mode, dev) runs an effect, its cleanup, then the
    // effect again on mount -- without this guard, the FIRST Image's
    // onerror can fire after its own objectUrl was already revoked by
    // that first cleanup, showing a false "unsupported format" error
    // even though the second, real attempt loaded fine. Confirmed live:
    // reproduced exactly this by driving the component in a real
    // browser, not just from reading the code.
    let cancelled = false;
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (cancelled) {
        return;
      }
      imageRef.current = img;
      setImageLoaded(true);
    };
    img.onerror = () => {
      if (cancelled) {
        return;
      }
      setLoadError(
        "Ce format d'image n'est pas pris en charge par ton navigateur. Essaie une photo JPEG ou PNG.",
      );
    };
    img.src = objectUrl;

    return () => {
      cancelled = true;
      URL.revokeObjectURL(objectUrl);
    };
  }, [file, fileTooLarge]);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || !imageLoaded) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    drawCropToCanvas(ctx, img, img.naturalWidth, img.naturalHeight, PREVIEW_SIZE, cropState);
  }, [cropState, imageLoaded]);

  function updateCropState(partial: Partial<CropState>) {
    setCropState((current) => {
      const next = { ...current, ...partial };
      const img = imageRef.current;
      if (!img) {
        return next;
      }
      const { effWidth, effHeight } = computeDrawGeometry(
        img.naturalWidth,
        img.naturalHeight,
        PREVIEW_SIZE,
        next.zoom,
        next.rotationDeg,
      );
      const clamped = clampOffsetFrac(
        next.offsetXFrac,
        next.offsetYFrac,
        effWidth,
        effHeight,
        PREVIEW_SIZE,
      );
      return { ...next, ...clamped };
    });
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!imageLoaded) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffsetXFrac: cropState.offsetXFrac,
      startOffsetYFrac: cropState.offsetYFrac,
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const deltaXFrac = (event.clientX - drag.startX) / PREVIEW_SIZE;
    const deltaYFrac = (event.clientY - drag.startY) / PREVIEW_SIZE;
    updateCropState({
      offsetXFrac: drag.startOffsetXFrac + deltaXFrac,
      offsetYFrac: drag.startOffsetYFrac + deltaYFrac,
    });
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
    }
  }

  function handleRotate() {
    const nextRotation = ((cropState.rotationDeg + 90) % 360) as CropState["rotationDeg"];
    updateCropState({ rotationDeg: nextRotation });
  }

  async function handleConfirm() {
    const img = imageRef.current;
    if (!img) {
      return;
    }
    setExporting(true);
    setExportError("");

    try {
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = CROP_EXPORT_SIZE;
      exportCanvas.height = CROP_EXPORT_SIZE;
      const ctx = exportCanvas.getContext("2d");
      if (!ctx) {
        throw new Error("le recadrage n'est pas disponible sur ce navigateur");
      }
      drawCropToCanvas(
        ctx,
        img,
        img.naturalWidth,
        img.naturalHeight,
        CROP_EXPORT_SIZE,
        cropState,
      );

      const blob = await new Promise<Blob | null>((resolve) => {
        exportCanvas.toBlob(resolve, "image/jpeg", EXPORT_QUALITY);
      });
      if (!blob) {
        throw new Error("échec de la génération de l'image recadrée");
      }

      onConfirm(blob);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "erreur inconnue");
      setExporting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Recadrer la photo de profil"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    >
      <div className="card flex w-full max-w-sm flex-col gap-4 p-4">
        <p className="text-sm font-semibold">Recadrer la photo</p>

        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="mx-auto touch-none overflow-hidden rounded-2xl bg-surface-muted"
          style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE, cursor: imageLoaded ? "grab" : "default" }}
        >
          <canvas
            ref={previewCanvasRef}
            width={PREVIEW_SIZE}
            height={PREVIEW_SIZE}
            className="h-full w-full select-none"
          />
        </div>

        {error && <p className="text-sm text-danger-600">{error}</p>}

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-foreground-muted">Zoom</span>
          <input
            type="range"
            min={CROP_MIN_ZOOM}
            max={CROP_MAX_ZOOM}
            step={0.01}
            value={cropState.zoom}
            disabled={!imageLoaded}
            onChange={(event) => updateCropState({ zoom: Number(event.target.value) })}
            className="accent-brand-500"
          />
        </label>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleRotate}
            disabled={!imageLoaded}
            className={buttonClass("outline", "sm")}
          >
            ↻ Pivoter
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className={buttonClass("ghost", "sm")}>
              Annuler
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!imageLoaded || exporting}
              className={buttonClass("primary", "sm")}
            >
              {exporting ? "..." : "Valider"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
