import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth.config';

// Use auth.config which doesn't include Node.js-only dependencies like bcrypt and Prisma
export default NextAuth(authConfig).auth;

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc.)
     * - api routes (they handle their own auth)
     */
    '/((?!_next/static|_next/image|favicon.ico|api/|.*\\..*$).*)',
  ],
};
