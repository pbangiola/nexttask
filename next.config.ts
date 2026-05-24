/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export', // Forces Next.js to compile to a static bundle
  images: {
    unoptimized: true, // Required for static exports
  },
  // If your GitHub Pages URL looks like https://pbangiola.github.io/nexttask/, 
  // uncomment the line below and put your repository name here:
  // basePath: '/nexttask', 
};

export default nextConfig;