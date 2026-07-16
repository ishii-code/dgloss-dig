/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@dig/core", "@dig/contracts"],
};

export default nextConfig;
