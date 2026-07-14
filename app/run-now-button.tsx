"use client";

import { useState } from "react";

export function RunNowButton({
  userUpn,
  capability,
  disabled,
}: {
  userUpn: string;
  capability: string;
  disabled: boolean;
}) {
  const [state, setState] = useState<"idle" | "queueing" | "queued" | "denied">("idle");

  async function queueRun() {
    setState("queueing");
    const response = await fetch("/api/run-now", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userUpn, capability }),
    });
    setState(response.ok ? "queued" : "denied");
  }

  return (
    <button
      className="button button-primary"
      type="button"
      onClick={queueRun}
      disabled={disabled || capability !== "ReportAdmin" || state === "queueing"}
      aria-live="polite"
      title={capability !== "ReportAdmin" ? "ต้องใช้ ReportAdmin" : undefined}
    >
      {state === "queueing" ? "กำลังเข้าคิว…" : state === "queued" ? "✓ Queued" : state === "denied" ? "ไม่ได้รับอนุญาต" : "↻ Run now"}
    </button>
  );
}
