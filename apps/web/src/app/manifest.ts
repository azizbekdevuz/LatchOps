import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'LatchOps',
    short_name: 'LatchOps',
    description: 'Evidence-backed Git recovery.',
    start_url: '/',
    display: 'standalone',
    background_color: '#06080b',
    theme_color: '#06080b',
    icons: [
      { src: '/brand/latchops-app-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/latchops-app.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
