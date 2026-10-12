import { Suspense } from "react";

import { FloorApp } from "@/components/floor/FloorApp";

async function CaseFloor({ params }: { params: PageProps<"/app/cases/[caseId]">["params"] }) {
  const { caseId } = await params;
  return <FloorApp caseId={caseId} />;
}

export default function CasePage({ params }: PageProps<"/app/cases/[caseId]">) {
  return (
    <Suspense fallback={null}>
      <CaseFloor params={params} />
    </Suspense>
  );
}
