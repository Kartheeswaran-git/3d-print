import type { Metadata } from "next";
import { LithophaneStudio } from "@/features/lithophane/components/lithophane-studio";

export const metadata: Metadata = {
  title: "Moon lamp",
  description: "Turn a photo into a printable moon globe or a flat lithophane that glows when lit from behind.",
};

export default function MoonLampPage() {
  return <LithophaneStudio />;
}
