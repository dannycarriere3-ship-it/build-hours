import type { Metadata } from "next";
import ValuemaxxingLab from "./ValuemaxxingLab";

export const metadata: Metadata = {
  description:
    "Compare model and reasoning choices by artifact quality, latency, tokens, estimated cost, and the intelligence-cost-speed frontier.",
};

export default function Home() {
  return <ValuemaxxingLab />;
}
