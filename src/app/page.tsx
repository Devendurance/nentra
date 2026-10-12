import { Hero } from "@/components/landing/Hero";
import { Intro } from "@/components/landing/Intro";
import { RecoveryLoop } from "@/components/landing/RecoveryLoop";
import { SiteNav } from "@/components/landing/SiteNav";

export default function Home() {
  return (
    <>
      <SiteNav />
      <main id="main" tabIndex={-1}>
        <Hero />
        <RecoveryLoop />
      </main>
      <Intro />
    </>
  );
}
