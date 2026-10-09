"use client";

import { useEffect, useState } from "react";

// Full-screen in-page photo viewer: prev/next, close, Esc/arrow keys.
// urls: array of image URLs (signed), startIndex: which one to open on.
export default function PhotoLightbox({ urls, startIndex = 0, onClose }) {
  const [index, setIndex] = useState(startIndex);
  const count = urls.length;

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setIndex((i) => Math.min(count - 1, i + 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, onClose]);

  if (!count) return null;

  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-label="Photo viewer">
      <img src={urls[index]} alt={`Photo ${index + 1} of ${count}`} onClick={(e) => e.stopPropagation()} />
      <button className="lightbox-btn" style={{ top: 14, right: 14 }} onClick={onClose} aria-label="Close">✕</button>
      {count > 1 && (
        <>
          <button
            className="lightbox-btn" style={{ left: 12, top: "50%", transform: "translateY(-50%)" }}
            disabled={index === 0}
            onClick={(e) => { e.stopPropagation(); setIndex(index - 1); }}
            aria-label="Previous photo"
          >
            ‹
          </button>
          <button
            className="lightbox-btn" style={{ right: 12, top: "50%", transform: "translateY(-50%)" }}
            disabled={index === count - 1}
            onClick={(e) => { e.stopPropagation(); setIndex(index + 1); }}
            aria-label="Next photo"
          >
            ›
          </button>
        </>
      )}
      <div className="lightbox-count">{index + 1} / {count}</div>
    </div>
  );
}
