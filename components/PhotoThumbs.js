"use client";

import { useEffect, useRef, useState } from "react";
import { getSignedUrls } from "../lib/photos";
import PhotoLightbox from "./PhotoLightbox";

// Read-only thumbnails for photos already uploaded to the private bucket.
// Signed URLs are only requested once the strip scrolls into view, and the
// images themselves use loading="lazy". Tapping one opens the lightbox.
// photos: [{ id, storage_path }]
export default function PhotoThumbs({ photos }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [urls, setUrls] = useState(null);
  const [error, setError] = useState("");
  const [openAt, setOpenAt] = useState(null);
  const paths = (photos || []).map((p) => p.storage_path);
  const key = paths.join("|");

  useEffect(() => {
    if (visible || !ref.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: "200px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || !paths.length) return;
    let cancelled = false;
    setError("");
    getSignedUrls(paths)
      .then((map) => { if (!cancelled) setUrls(paths.map((p) => map[p] || null)); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, key]);

  if (!paths.length) return null;

  return (
    <div ref={ref}>
      <div className="photo-grid">
        {paths.map((p, i) => (
          <button key={p} type="button" className="photo-thumb" onClick={() => urls?.[i] && setOpenAt(i)} aria-label={`View photo ${i + 1}`}>
            {urls?.[i] && <img src={urls[i]} alt="" loading="lazy" />}
          </button>
        ))}
      </div>
      {error && <div className="note" style={{ color: "var(--danger)", margin: "0 0 8px" }}>{error}</div>}
      {openAt !== null && urls && (
        <PhotoLightbox
          urls={urls.filter(Boolean)}
          startIndex={urls.slice(0, openAt).filter(Boolean).length}
          onClose={() => setOpenAt(null)}
        />
      )}
    </div>
  );
}
