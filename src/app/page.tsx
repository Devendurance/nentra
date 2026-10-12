import { ClosingCta, SiteFooter } from "@/components/landing/Closing";
import { HashNavigation } from "@/components/landing/HashNavigation";
import { Hero } from "@/components/landing/Hero";
import { Intro } from "@/components/landing/Intro";
import { ProofBento } from "@/components/landing/ProofBento";
import { RecordedCaseProvider } from "@/components/landing/recorded/RecordedCase";
import { RecoveryLoop } from "@/components/landing/RecoveryLoop";
import { SiteNav } from "@/components/landing/SiteNav";
import { StoryStack } from "@/components/landing/StoryStack";
import { Walkthrough } from "@/components/landing/Walkthrough";

export default function Home() {
  return (
    <>
      <SiteNav />
      <RecordedCaseProvider>
        <main id="main" tabIndex={-1}>
          <Hero />
          <Walkthrough />
          <StoryStack />
          <ProofBento />
          <RecoveryLoop />
          <ClosingCta />
        </main>
      </RecordedCaseProvider>
      <SiteFooter />
      <Intro />
      <HashNavigation />
    </>
  );
}
