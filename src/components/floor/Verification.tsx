import { Check, X } from "lucide-react";

import { type PublicCaseSnapshot, type PublicEvidence, formatNgn } from "./types";

const CHECK_LABELS: Record<string, string> = {
  bookingIdentity: "Booking identity",
  order: "Order",
  status: "Booked status",
  courier: "Courier and service",
  price: "Price",
  uniqueness: "Uniqueness",
};

export function Verification({ evidence, snapshot }: { evidence: PublicEvidence[]; snapshot: PublicCaseSnapshot }) {
  return (
    <section id="verification" className="panel" aria-labelledby="verification-title">
      <div className="panel-head">
        <h2 id="verification-title" className="panel-title">
          Verification receipt
        </h2>
        <p className="panel-note">Read back from GET /api/cases/…/evidence. Delivery is not claimed.</p>
      </div>
      {evidence.length === 0 ? (
        <p className="empty-note">No verification receipt has been recorded for this case.</p>
      ) : (
        evidence.map((receipt) => (
          <article key={receipt.id} className={`receipt tone-${receipt.result === "PASS" ? "verified" : "failed"}`}>
            <header className="receipt-head">
              <p className="receipt-result">
                {receipt.result === "PASS" ? <Check size={18} aria-hidden="true" /> : <X size={18} aria-hidden="true" />}
                {receipt.result}
              </p>
              <span className="badge">{receipt.adapterMode}</span>
            </header>
            <dl className="receipt-grid">
              <div>
                <dt>Verified amount</dt>
                <dd className="receipt-amount">{formatNgn(receipt.amountNgn)}</dd>
              </div>
              <div>
                <dt>Merchant ceiling</dt>
                <dd>{formatNgn(snapshot.merchant.maxShippingNgn)}</dd>
              </div>
              <div>
                <dt>Courier · service</dt>
                <dd>
                  {receipt.provider} · {receipt.service}
                </dd>
              </div>
              <div>
                <dt>Verified at</dt>
                <dd className="tabular">{new Date(receipt.verifiedAt).toISOString().replace("T", " ").slice(0, 19)} UTC</dd>
              </div>
              <div className="span-2">
                <dt>Sandbox booking reference</dt>
                <dd className="mono break">{receipt.providerBookingId}</dd>
              </div>
              <div className="span-2">
                <dt>Receipt</dt>
                <dd className="mono break">{receipt.id}</dd>
              </div>
            </dl>
            <ul className="checks" aria-label="Independent checks">
              {Object.entries(receipt.checks).map(([key, ok]) => (
                <li key={key} className={ok ? "is-ok" : "is-bad"}>
                  {ok ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
                  {CHECK_LABELS[key] ?? key}
                  <span className="sr-only">{ok ? "passed" : "failed"}</span>
                </li>
              ))}
            </ul>
            <p className="receipt-note">
              RESOLVED means this sandbox booking passed an independent database readback. It is a {receipt.adapterMode}{" "}
              record, not a real courier booking, and it does not mean the parcel was collected or delivered.
            </p>
          </article>
        ))
      )}
    </section>
  );
}
