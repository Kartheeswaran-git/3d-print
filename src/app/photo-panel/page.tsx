import type { Metadata } from "next";
import { LithophaneStudio } from "@/features/lithophane/components/lithophane-studio";

export const metadata: Metadata = {
  title: "Photo panel",
  description: "Turn a photo into a flat rectangular lithophane that glows when lit from behind.",
};

export default function PhotoPanelPage() {
  return <LithophaneStudio mode="photo-panel" />;
}
