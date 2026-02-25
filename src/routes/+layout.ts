// Tauri apps are SPAs — disable SSR and enable full prerender so
// adapter-static can emit a single index.html without complaining
// about dynamic routes.
export const ssr = false;
export const prerender = true;
