import { useBranding } from './BrandingProvider';
import styles from './SchoolLogo.module.css';

/**
 * The official school crest. The file is the unaltered official logo (resized only). It is shown
 * as a circle because the crest is circular and fills its square image — the clip only hides the
 * white corners of the image, never part of the crest.
 *
 * `decorative` hides it from screen readers when the school name is printed right next to it.
 */
export function SchoolLogo({
  size,
  decorative = false,
  className,
}: {
  size: number;
  decorative?: boolean;
  className?: string;
}) {
  const { logoUrl, fullName } = useBranding();
  if (!logoUrl) return null;
  return (
    <img
      src={logoUrl}
      width={size}
      height={size}
      alt={decorative ? '' : `${fullName} crest`}
      className={[styles.logo, className ?? ''].join(' ')}
      decoding="async"
      draggable={false}
    />
  );
}
