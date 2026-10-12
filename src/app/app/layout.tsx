import type { Metadata } from "next";

import "./floor.css";

export const metadata: Metadata = {
  title: "Nentra Floor | Watch a recorded order recovery",
  description:
    "Watch the persisted NG-2048 recovery: every agent handoff, the recorded quote failure, the merchant approval and the independent verification receipt.",
};

export default function FloorLayout({ children }: LayoutProps<"/app">) {
  return children;
}
