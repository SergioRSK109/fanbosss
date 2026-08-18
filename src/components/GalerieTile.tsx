import { MusicNoteIcon, PlayIcon } from "@/components/ui/icons";
import type { GalerieItemView } from "@/components/GalerieContent";

// Fan gallery (Phase 3): one square tile in the grid, "vignettes carrées"
// per the brief -- same aspect-square/object-cover treatment as
// PublicationTile's own grid, just square instead of that one's 4:5.
//
// image: the real photo -- already resolved server-side (page.tsx via
// getGalerieFan, see src/lib/galerie.ts), never a per-tile client fetch.
// video/audio: a generic icon on a neutral background, per the brief --
// this project has no video-thumbnail generation anywhere (server-side
// video processing is explicitly out of scope), so there is no real
// thumbnail to show for either. Their real signed URL is only ever
// requested on demand, at open time (GalerieViewer) -- nothing here ever
// calls video-url/content-url.
export function GalerieTile({
  item,
  ariaLabel,
  onOpen,
}: {
  item: GalerieItemView;
  ariaLabel: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={ariaLabel}
      className="aspect-square w-full overflow-hidden rounded-sm bg-surface-muted"
    >
      {item.mediaType === "image" ? (
        item.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
        )
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-500 via-brand-600 to-accent-500 text-white">
          {item.mediaType === "audio" ? (
            <MusicNoteIcon className="h-8 w-8" />
          ) : (
            <PlayIcon className="h-8 w-8" />
          )}
        </div>
      )}
    </button>
  );
}
