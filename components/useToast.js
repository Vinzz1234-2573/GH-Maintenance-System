"use client";

import { useState, useCallback } from "react";

export function useToast() {
  const [msg, setMsg] = useState("");

  const showToast = useCallback((text) => {
    setMsg(text);
    setTimeout(() => setMsg(""), 2400);
  }, []);

  const ToastHost = () => (msg ? <div className="toast">{msg}</div> : null);

  return { showToast, ToastHost };
}
