"use client";

import {
  Circle,
  Globe,
  Heart,
  Link,
  Moon,
  RectangleHorizontal,
  Replace,
  Shapes,
  Spline,
  Square,
  Squircle,
  Trash2,
  Unlink,
} from "lucide-react";
import type { ShapeKind } from "@/lib/geometry/types";
import { Button, FileDrop, IconButton, InlineAlert, InspectorSection, NumberField, Skeleton, TilePicker, type TileOption } from "@/components/ui";
import { MASK_ACCEPT } from "@/lib/image";
import { formSummary, SHAPE_LABELS } from "../model";
import { useLithophaneSession } from "../session";
import { NUMERIC } from "../settings";
import { useLithophaneStore } from "../store";
import { useInspectorMode } from "../use-inspector-mode";
import { CanvasSnapshot } from "./canvas-snapshot";
import { SectionReset, SettingSlider } from "./setting-controls";

const SHAPE_ICONS: Record<ShapeKind, React.ReactNode> = {
  sphere: <Globe />,
  crescent: <Moon />,
  circle: <Circle />,
  heart: <Heart />,
  rounded: <Squircle />,
  rectangle: <RectangleHorizontal />,
  square: <Square />,
  custom: <Spline />,
};

const SHAPE_OPTIONS: TileOption<ShapeKind>[] = (Object.keys(SHAPE_ICONS) as ShapeKind[]).map((shape) => ({
  value: shape,
  label: SHAPE_LABELS[shape],
  icon: SHAPE_ICONS[shape],
}));

/**
 * Form: shape tiles, then the size and shape controls that apply to it. Simple mode keeps the primary
 * size (plus depth and rotation for the crescent); Advanced shows every control.
 */
export function FormSection({ onChooseMask, advanced }: { onChooseMask: () => void; advanced: boolean }) {
  const shape = useLithophaneStore((state) => state.settings.shape);
  const summary = useLithophaneStore((state) => formSummary(state.settings));
  const set = useLithophaneStore((state) => state.set);
  const mode = useLithophaneSession((state) => state.mode);

  return (
    <InspectorSection id="lamp-form" title="Form" icon={Shapes} tint="plan" defaultOpen summary={summary}>
      {mode === "moon-lamp" ? (
        <>
          <SettingSlider setting="sphereDiameter" label="Globe diameter" />
          <SettingSlider setting="sphereOpening" label="Bottom hole size" hint="Hole at the bottom for an LED base." />
          <p className="text-[13px] leading-5 text-secondary">A hollow globe with a closed top — print it opening-down.</p>
        </>
      ) : (
        <>
          <SizeFields />
          {advanced && <SettingSlider setting="base" label="Back thickness" hint="Solid layer behind the relief." />}
          
          <FrameStyleSelect />
        </>
      )}

      <SectionReset section="form" />
    </InspectorSection>
  );
}

function FrameStyleSelect() {
  const frameStyle = useLithophaneStore((state) => state.settings.frameStyle);
  const set = useLithophaneStore((state) => state.set);
  const advanced = useInspectorMode()[0] === "advanced";
  
  return (
    <>
      <div className="pt-2 border-t border-line mt-2 space-y-4">
        <div className="space-y-2">
          <label className="text-[13px] font-medium leading-4 text-ink" htmlFor="frame-style-select">
            Frame style
          </label>
          <select
            id="frame-style-select"
            className="w-full rounded-control border border-line bg-surface px-3 py-1.5 text-[14px] text-ink shadow-e1 outline-none focus-visible:border-brand"
            value={frameStyle}
            onChange={(e) => set("frameStyle", e.target.value as any)}
          >
            <option value="none">None (lithophane only)</option>
            <option value="border">Solid frame border</option>
            <option value="frame-only">Empty frame (border only)</option>
          </select>
        </div>
        
        {frameStyle !== "none" && (
          <div className="space-y-3">
            <SettingSlider setting="frameDepth" label="Frame depth" hint="Total thickness of the outer frame." />
            <SettingSlider setting="frameWidth" label="Border width" hint="Thickness of the frame edge." />
            {advanced && (
              <SettingSlider setting="frameOverhang" label="Overhang angle" hint="Chamfer angle down to the photo to print without supports." />
            )}
          </div>
        )}
      </div>
    </>
  );
}

/** Width / height with an aspect lock between them (FIXES L1, L5). */
function SizeFields() {
  const width = useLithophaneStore((state) => state.settings.width);
  const height = useLithophaneStore((state) => state.settings.height);
  const lockRatio = useLithophaneStore((state) => state.settings.lockRatio);
  const resize = useLithophaneStore((state) => state.resize);
  const set = useLithophaneStore((state) => state.set);
  const w = NUMERIC.width;
  const h = NUMERIC.height;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2">
      <NumberField
        id="litho-width"
        label="Width"
        value={width}
        min={w.min}
        max={w.max}
        step={w.step}
        unit="mm"
        onChange={(v) => resize("width", v)}
      />
      {/* Label row (20px) + gap (6px) aligns the button with the inputs. */}
      <div className="pt-[26px]">
        <IconButton
          label="Lock aspect ratio"
          icon={lockRatio ? <Link /> : <Unlink />}
          pressed={lockRatio}
          onClick={() => set("lockRatio", !lockRatio)}
        />
      </div>
      <NumberField
        id="litho-height"
        label="Height"
        value={height}
        min={h.min}
        max={h.max}
        step={h.step}
        unit="mm"
        onChange={(v) => resize("height", v)}
      />
    </div>
  );
}

/** Custom shape mask: compact drop zone, or the loaded mask with Replace / Remove. */
function MaskPicker({ onChooseMask }: { onChooseMask: () => void }) {
  const mask = useLithophaneSession((state) => state.mask);
  const status = useLithophaneSession((state) => state.maskStatus);
  const error = useLithophaneSession((state) => state.maskError);
  const loadMask = useLithophaneSession((state) => state.loadMask);
  const removeMask = useLithophaneSession((state) => state.removeMask);

  return (
    <div className="space-y-2">
      {status === "loading" ? (
        <div role="status" className="flex items-center gap-3 rounded-control border border-line px-3 py-2.5">
          <Skeleton className="size-10 shrink-0 rounded-control" />
          <Skeleton className="h-2 flex-1" />
          <span className="sr-only">Opening mask…</span>
        </div>
      ) : mask ? (
        <div className="flex items-center gap-3 rounded-control border border-line px-3 py-2.5">
          <CanvasSnapshot
            source={mask.preview}
            maxSize={80}
            label={`Mask ${mask.name}`}
            className="size-10 shrink-0 rounded-chip border border-line object-contain"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium leading-5 text-ink" title={mask.name}>
              {mask.name}
            </p>
            <div className="-ml-2.5 flex flex-wrap gap-1">
              <Button variant="ghost" size="xs" icon={<Replace aria-hidden="true" />} onClick={onChooseMask}>
                Replace
              </Button>
              <Button variant="danger-ghost" size="xs" icon={<Trash2 aria-hidden="true" />} onClick={removeMask}>
                Remove
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <FileDrop
          compact
          accept={MASK_ACCEPT}
          onFile={(file) => void loadMask(file)}
          title="Add a mask"
          description="SVG or PNG — white areas become the lamp."
          icon={<Spline />}
        />
      )}
      {status === "error" && error && (
        <InlineAlert
          tone="danger"
          action={
            <Button variant="ghost" size="xs" className="-ml-2.5" onClick={onChooseMask}>
              Choose another file
            </Button>
          }
        >
          {error}
        </InlineAlert>
      )}
    </div>
  );
}
