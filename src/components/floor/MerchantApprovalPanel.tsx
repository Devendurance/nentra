"use client";

import { useState, useSyncExternalStore } from "react";

import "./MerchantApprovalPanel.css";
import { formatNgn, type PublicCaseSnapshot } from "./types";

type PanelAction = "approve" | "reject" | "refresh";

let mountedAt: number | null = null;
function subscribeClock(): () => void {
  if (mountedAt === null) mountedAt = Date.now();
  return () => {};
}
function clockSnapshot(): number {
  return mountedAt ?? 0;
}
function useMountedAt(): number {
  return useSyncExternalStore(subscribeClock, clockSnapshot, () => 0);
}

function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const details = (payload as { error?: { code?: unknown; message?: unknown } }).error;
    if (typeof details?.message === "string" && details.message) return details.message;
    if (typeof details?.code === "string" && details.code) return `Request failed (${details.code}).`;
  }
  return `Request failed with status ${status}.`;
}

function successMessage(action: PanelAction): string {
  if (action === "refresh") return "A fresh exact quote is ready for approval.";
  if (action === "approve") return "The quote was approved. Booking preparation follows.";
  return "The quote was declined and the case escalated.";
}

/**
 * Merchant approval checkpoint for WAITING_APPROVAL cases. Handles the
 * operator secret in memory only: it is never stored, never placed in a
 * URL, and cleared after every attempt.
 */
export function MerchantApprovalPanel({
  snapshot,
  onChanged,
}: {
  snapshot: PublicCaseSnapshot;
  onChanged: () => void;
}) {
  const approval = snapshot.pendingApproval;
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState<PanelAction | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const mounted = useMountedAt();

  if (snapshot.status !== "WAITING_APPROVAL" || !approval) return null;

  // Unknown clock defaults to expired: the server re-validates expiry on every action.
  const expired = approval.expiresAt !== null
    && (mounted === 0 || Date.parse(approval.expiresAt) <= mounted);
  const difference = approval.requestedCostNgn - approval.merchantCeilingNgn;

  async function act(action: PanelAction): Promise<void> {
    if (busy) return;
    setBusy(action);
    setFeedback(null);
    try {
      const url = action === "refresh"
        ? `/api/cases/${snapshot.id}/approvals/refresh`
        : `/api/cases/${snapshot.id}/approvals/${approval!.id}`;
      const body = action === "refresh"
        ? { expectedVersion: snapshot.version }
        : { decision: action, expectedVersion: snapshot.version };
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-nentra-operator-secret": secret,
        },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(payload, response.status));
      setFeedback({ ok: true, message: successMessage(action) });
      onChanged();
    } catch (failure) {
      setFeedback({
        ok: false,
        message: failure instanceof Error ? failure.message : "The request could not be completed.",
      });
    } finally {
      setSecret("");
      setBusy(null);
    }
  }

  return (
    <section className="panel approval-panel" aria-labelledby="approval-title">
      <div className="panel-head">
        <h2 id="approval-title" className="panel-title">Merchant approval</h2>
        <p className="panel-note">
          {approval.status === "PENDING" ? "Awaiting decision" : `Approval ${approval.status.toLowerCase()}`}
        </p>
      </div>
      <dl className="receipt-grid">
        <div>
          <dt>Provider</dt>
          <dd>{approval.provider ?? "Unknown courier"}</dd>
        </div>
        <div>
          <dt>Service</dt>
          <dd>{approval.service ?? "Standard"}</dd>
        </div>
        <div>
          <dt>Quote amount</dt>
          <dd className="tabular">{formatNgn(approval.requestedCostNgn)}</dd>
        </div>
        <div>
          <dt>Merchant ceiling</dt>
          <dd className="tabular">{formatNgn(approval.merchantCeilingNgn)}</dd>
        </div>
        <div>
          <dt>Above ceiling</dt>
          <dd className="tabular">+{formatNgn(Math.max(0, difference))}</dd>
        </div>
        <div>
          <dt>Quote expires</dt>
          <dd className="tabular">
            {approval.expiresAt
              ? new Date(approval.expiresAt).toUTCString().slice(5, 22).concat(" UTC")
              : "No expiry recorded"}
            {expired ? " · expired" : ""}
          </dd>
        </div>
      </dl>
      {expired ? (
        <p className="receipt-note" role="status">
          This quote expired, so approval is disabled. Refresh the quote for a new exact-quote approval.
        </p>
      ) : null}
      <form
        className="approval-secret"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="approval-secret-label" htmlFor="approval-operator-secret">
          Operator secret
        </label>
        <input
          id="approval-operator-secret"
          type="password"
          autoComplete="off"
          className="approval-secret-input"
          placeholder="Paste the staging operator secret"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
        />
      </form>
      <div className="approval-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={expired || busy !== null || secret.trim() === ""}
          onClick={() => void act("approve")}
        >
          {busy === "approve" ? "Approving…" : "Approve"}
        </button>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={expired || busy !== null || secret.trim() === ""}
          onClick={() => void act("reject")}
        >
          {busy === "reject" ? "Declining…" : "Reject"}
        </button>
        {expired ? (
          <button
            type="button"
            className="btn btn-cream btn-sm"
            disabled={busy !== null || secret.trim() === ""}
            onClick={() => void act("refresh")}
          >
            {busy === "refresh" ? "Refreshing…" : "Refresh quote"}
          </button>
        ) : null}
      </div>
      {feedback ? (
        <p className={`approval-feedback is-${feedback.ok ? "ok" : "error"}`} role="status">
          {feedback.message}
        </p>
      ) : null}
    </section>
  );
}
