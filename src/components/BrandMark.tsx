import markUrl from "../assets/brand-mark.png";
import { BRAND_NAME } from "../lib/brand";

/** Kliniğin logosundan kesilmiş küçük marka simgesi (üst başlıklar için). */
export default function BrandMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={markUrl}
      alt={BRAND_NAME}
      width={size}
      height={size}
      className={`shrink-0 rounded-lg object-cover ${className}`}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}
