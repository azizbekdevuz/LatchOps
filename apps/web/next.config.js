/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@daytona/sdk', '@prisma/review-client'],
};

module.exports = nextConfig;
