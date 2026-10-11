"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { captureVideoFrame, MAX_PHOTOS } from "../lib/photos";

// In-page camera for staff photo evidence on phones and tablets.
//
// A file input with `capture` only *asks* the browser to open the camera —
// phones may still offer the gallery. This component instead opens the camera
// stream itself (getUserMedia) and takes still frames from it, so there is
// no file picker at all and every photo is taken live, on the spot.
//
// Needs HTTPS (or localhost) and the person's permission to use the camera.
// It stays off when either is missing: see pickCaptureMode().

// Touch-first devices (phones, tablets) are the ones held to the camera-only
// rule; desktops keep a normal file picker.
export function isTouchDevice() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
}

export function liveCameraSupported() {
  return typeof window !== "undefined" && window.isSecureContext === true && !!navigator.mediaDevices?.getUserMedia;
}

// "live"        phone/tablet with a usable camera stream -> this component
// "phone-file"  phone/tablet that can't stream (old browser, plain http, some
//               in-app browsers) -> file input that asks for the camera (a hint)
// "file"        desktop -> normal file picker
export function pickCaptureMode() {
  if (!isTouchDevice()) return "file";
  return liveCameraSupported() ? "live" : "phone-file";
}

function cameraErrorMessage(err) {
  switch (err?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera access is blocked. Allow the camera for this website in your browser settings, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera was found on this device.";
    case "NotReadableError":
    case "AbortError":
      return "The camera is being used by another app. Close it and try again.";
    default:
      return "Couldn't open the camera. Please try again.";
  }
}

// Full-screen live camera. `count` photos are already attached; `onShot(blob)`
// receives each new JPEG; `onClose()` ends the camera (also called by itself
// once MAX_PHOTOS have been taken).
export default function CameraCapture({ count, lastUrl, onShot, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [state, setState] = useState("starting"); // "starting" | "live" | "error"
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play().catch(() => {}); // autoplay normally handles it
        if (!cancelled) setState("live");
      } catch (err) {
        if (!cancelled) {
          setError(cameraErrorMessage(err));
          setState("error");
        }
      }
    })();
    // Always switch the camera off (and its indicator light) when this closes.
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // Stop automatically once the photo limit is reached.
  useEffect(() => {
    if (count >= MAX_PHOTOS) onClose();
  }, [count, onClose]);

  async function shoot() {
    if (busy || state !== "live" || count >= MAX_PHOTOS) return;
    setBusy(true);
    setNotice("");
    try {
      const blob = await captureVideoFrame(videoRef.current);
      setFlash(true);
      setTimeout(() => setFlash(false), 120);
      onShot(blob);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="camera-overlay" role="dialog" aria-modal="true" aria-label="Take photos" onClick={(e) => e.stopPropagation()}>
      <video ref={videoRef} className="camera-video" playsInline muted autoPlay />
      {flash && <div className="camera-flash" />}

      <div className="camera-top">{count} of {MAX_PHOTOS} photos taken</div>

      {state === "starting" && <div className="camera-msg">Opening camera…</div>}
      {state === "error" && (
        <div className="camera-msg">
          <p>{error}</p>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      )}
      {notice && <div className="camera-notice" role="alert">{notice}</div>}

      <div className="camera-bar">
        <div className="camera-side">
          {lastUrl && <img src={lastUrl} alt="Last photo taken" className="camera-last" />}
        </div>
        {state !== "error" && (
          <button
            type="button" className="camera-shutter" onClick={shoot}
            disabled={state !== "live" || busy} aria-label="Take photo"
          />
        )}
        <div className="camera-side">
          <button type="button" className="camera-done" onClick={onClose}>{count > 0 ? "Done" : "Cancel"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
