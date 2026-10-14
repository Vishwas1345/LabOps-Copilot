// Tailwind v4 runs as a PostCSS plugin during `next build` only; the runtime
// image ships the compiled CSS, not this file.
const config = { plugins: { '@tailwindcss/postcss': {} } };

export default config;
