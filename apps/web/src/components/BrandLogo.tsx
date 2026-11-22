import Image from 'next/image';

const ASSETS = {
  wordmark: {
    src: '/brand/latchops-wordmark.png',
    width: 960,
    height: 284,
    alt: 'LatchOps',
  },
  light: {
    src: '/brand/latchops-wordmark-light.png',
    width: 1280,
    height: 377,
    alt: 'LatchOps',
  },
  lockup: {
    src: '/brand/latchops-lockup.png',
    width: 1280,
    height: 439,
    alt: 'LatchOps. Evidence-backed Git recovery.',
  },
  app: {
    src: '/brand/latchops-app.png',
    width: 512,
    height: 512,
    alt: 'LatchOps',
  },
} as const;

export function BrandLogo({
  variant = 'wordmark',
  className = 'h-8 w-auto',
  priority = false,
}: {
  variant?: keyof typeof ASSETS;
  className?: string;
  priority?: boolean;
}) {
  const asset = ASSETS[variant];
  return (
    <Image
      src={asset.src}
      alt={asset.alt}
      width={asset.width}
      height={asset.height}
      priority={priority}
      className={className}
    />
  );
}
