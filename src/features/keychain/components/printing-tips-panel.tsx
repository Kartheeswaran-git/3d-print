import { InlineAlert } from "@/components/ui";
import { Panel, SpecList } from "@/components/studio";

/** Aside panel: slicer settings plus the filament-change height for single-nozzle printers. */
export function PrintingTipsPanel({ baseThickness }: { baseThickness: number }) {
  return (
    <Panel title="Printing tips">
      <SpecList
        items={[
          { label: "Layer height", value: "0.2 mm" },
          { label: "Infill", value: "20–30%" },
          { label: "Supports", value: "None" },
          { label: "Orientation", value: "Flat, letters up" },
        ]}
      />
      <InlineAlert tone="info" className="mt-3">
        Single-nozzle printer? Add a filament change at{" "}
        <span className="font-medium text-ink tabular-nums">{baseThickness.toFixed(1)} mm</span> to switch to the text colour.
      </InlineAlert>
    </Panel>
  );
}
