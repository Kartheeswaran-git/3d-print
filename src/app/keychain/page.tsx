import type { Metadata } from "next";
import { KeychainStudio } from "@/features/keychain/components/keychain-studio";

export const metadata: Metadata = {
  title: "Keychain",
  description: "Type a name, pick a font and download a two-colour keychain as a multi-colour AMF or STL — made on your device.",
};

/** Name keychain studio. The studio is a client component; this route only supplies metadata. */
export default function KeychainPage() {
  return <KeychainStudio />;
}
