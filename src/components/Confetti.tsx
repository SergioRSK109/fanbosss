"use client";

import { useEffect, useState } from "react";

// Brand palette only (no red/black) -- same "stay neutral" guard-rail as
// the rest of this app's design (see CLAUDE.md's Product judgment calls).
const COLORS = ["#7c3aed", "#b393ff", "#ff7a45", "#ffbb99", "#22c55e"];
const PIECE_COUNT = 18;

interface Piece {
  id: number;
  left: number;
  color: string;
  duration: number;
  delay: number;
  size: number;
}

function buildPieces(): Piece[] {
  return Array.from({ length: PIECE_COUNT }, (_, id) => ({
    id,
    left: Math.random() * 100,
    color: COLORS[id % COLORS.length],
    duration: 1.6 + Math.random() * 0.8,
    delay: Math.random() * 0.4,
    size: 6 + Math.random() * 4,
  }));
}

// Discreet celebration effect for /paiement/retour -- a brief burst of
// falling pieces, not a full-screen takeover: pointer-events-none
// throughout (never blocks the page underneath) and self-removes after
// ~2.5s so it never lingers.
export function Confetti() {
  const [pieces] = useState(buildPieces);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timeout = setTimeout(() => setVisible(false), 2500);
    return () => clearTimeout(timeout);
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {pieces.map((piece) => (
        <span
          key={piece.id}
          className="absolute top-0 rounded-sm"
          style={{
            left: `${piece.left}%`,
            width: piece.size,
            height: piece.size,
            backgroundColor: piece.color,
            animation: `confetti-fall ${piece.duration}s ease-in ${piece.delay}s forwards`,
          }}
        />
      ))}
    </div>
  );
}
