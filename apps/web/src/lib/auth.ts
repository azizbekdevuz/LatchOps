import NextAuth from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import Kakao from 'next-auth/providers/kakao';
import type { Provider } from 'next-auth/providers';
import bcrypt from 'bcryptjs';
import prisma from './prisma';
import { createAuthLog } from './db';

// Build providers array dynamically with actual implementations
const providers: Provider[] = [
  // Credentials Provider (username/password)
  Credentials({
    name: 'credentials',
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' },
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) {
        return null;
      }

      const user = await prisma.user.findUnique({
        where: { email: credentials.email as string },
      });

      if (!user || !user.password) {
        // Log failed login attempt - user not found
        // Use same error to prevent user enumeration
        await createAuthLog({
          userId: null,
          action: 'LOGIN_FAILED',
          success: false,
          failureReason: 'Invalid credentials',
        }).catch(console.error);
        return null;
      }

      const isValid = await bcrypt.compare(
        credentials.password as string,
        user.password
      );

      if (!isValid) {
        // Log failed login attempt - wrong password
        await createAuthLog({
          userId: user.id,
          action: 'LOGIN_FAILED',
          success: false,
          failureReason: 'Invalid password',
        }).catch(console.error);
        return null;
      }

      // Log successful login
      await createAuthLog({
        userId: user.id,
        action: 'LOGIN',
        success: true,
      }).catch(console.error);

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
      };
    },
  }),
];

// Add Google provider if configured
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    })
  );
}

// Add Kakao provider if configured
if (process.env.KAKAO_CLIENT_ID && process.env.KAKAO_CLIENT_SECRET) {
  providers.push(
    Kakao({
      clientId: process.env.KAKAO_CLIENT_ID,
      clientSecret: process.env.KAKAO_CLIENT_SECRET,
    })
  );
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers,
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  callbacks: {
    async session({ session, token }) {
      if (token.sub && session.user) {
        session.user.id = token.sub;
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
      }
      return token;
    },
  },
});

/**
 * Helper to hash passwords for user registration
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

/**
 * Get current session on the server
 */
export async function getServerSession() {
  return auth();
}
