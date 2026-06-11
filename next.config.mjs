/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath: '/nexttask', // <-- Add your exact repository name here
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
