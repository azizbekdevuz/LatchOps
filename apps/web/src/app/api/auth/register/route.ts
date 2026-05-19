import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';
import { createAuthLog, extractClientIp } from '@/lib/db';

export async function POST(request: NextRequest) {
  const ipAddress = extractClientIp(request.headers);
  const userAgent = request.headers.get('user-agent');

  try {
    const { name, email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      await createAuthLog({
        userId: null,
        action: 'REGISTER_FAILED',
        ipAddress,
        userAgent,
        success: false,
        failureReason: 'Email already exists',
      }).catch(console.error);

      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      );
    }

    // Hash password and create user
    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    // Log successful registration
    await createAuthLog({
      userId: user.id,
      action: 'REGISTER',
      ipAddress,
      userAgent,
      success: true,
    }).catch(console.error);

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: 'Failed to create account' },
      { status: 500 }
    );
  }
}
