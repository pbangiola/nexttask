/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  // Keep this commented out unless your live page URL ends in /nexttask
  // basePath: '/nexttask', 
};

export default nextConfig;
