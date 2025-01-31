import * as fs from "fs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { dev }) => {
    const rules = config.module.rules
      .find((rule) => typeof rule.oneOf === "object")
      .oneOf.filter((rule) => Array.isArray(rule.use));
    rules.forEach((rule) => {
      rule.use.forEach((moduleLoader) => {
        if (
          moduleLoader.loader !== undefined &&
          moduleLoader.loader.includes("css-loader") &&
          typeof moduleLoader.options.modules === "object"
        ) {
          moduleLoader.options = {
            ...moduleLoader.options,
            modules: {
              ...moduleLoader.options.modules,
              // This is where we allow camelCase class names
              exportLocalsConvention: "camelCase",
            },
          };
        }
      });
    });

    if (dev) {
      config.devServer = {
        https: {
          key: fs.readFileSync("./local/local.requireganizer.com.key"),
          cert: fs.readFileSync("./local/local.requireganizer.com.crt"),
        },
      };
    }

    return config;
  },
};

export default nextConfig;
