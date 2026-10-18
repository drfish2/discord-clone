/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    config.externals.push({
      "utf-8-validate": "commonjs utf-8-validate",
      bufferutil: "commonjs bufferutil"
    });

    return config;
  },
  // Starship Sus self-hosted build (among-us-game, `node tools/build.mjs --selfhost`)
  async rewrites() {
    return [{ source: "/among-us", destination: "/among-us/index.html" }];
  },
  images: {
    domains: [
      "uploadthing.com",
      "utfs.io"
    ]
  }
}

module.exports = nextConfig
